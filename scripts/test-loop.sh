#!/usr/bin/env bash
# Expanded regression harness. Each iteration runs a full reset, seed, worker
# polling, server boot, then ~25 HTTP and data-integrity assertions across:
#   - endpoint matrix (auth gates, cron gates, content types, static files)
#   - authenticated flows (session seeded directly via Prisma)
#   - concurrent cron ticks (dedupe race)
#   - empty-DB homepage render
#   - API JSON shape
#   - process leak check (no stray servers between iterations)
# Exits non-zero if any iteration fails.

set -u
N="${1:-10}"
PORT="${PORT:-3012}"
DATABASE_URL="${DATABASE_URL:-postgresql://skybird:skybird@localhost:5432/skybird?schema=public}"
export DATABASE_URL

LOG_DIR=/tmp/skybird-loop
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log "$LOG_DIR"/*.html "$LOG_DIR"/*.json "$LOG_DIR"/*.pid 2>/dev/null

# Stage public/ and .next/static/ into .next/standalone/ so the standalone
# server (which resolves these relative to its __dirname = .next/standalone/)
# can serve them. The Dockerfile copies them to /app/ for the same reason at
# deploy time; this mirrors that behavior locally.
if [ -d .next/standalone ]; then
  rm -rf .next/standalone/public .next/standalone/.next/static
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
  cp -r public .next/standalone/public 2>/dev/null || true
fi

psql_run() { PGPASSWORD=skybird psql -q -h localhost -U skybird -d skybird -tA "$@"; }

pass_count=0
fail_count=0
declare -a FAILURES

assert() {
  # assert <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf "    \033[32mok\033[0m  %-45s %s\n" "$1" "$2"
    return 0
  else
    printf "    \033[31mFAIL\033[0m %-45s want %s got %s\n" "$1" "$2" "$3"
    return 1
  fi
}

run_once() {
  local i="$1"
  local log="$LOG_DIR/iter-$i.log"
  local errors=0
  local note=""

  {
    echo "=== iteration $i ==="
    date -Is

    # ========== stray-process leak check (before) ==========
    if pgrep -af "standalone/server.js|tsx src/worker" | grep -v "test-loop\|grep" > "$LOG_DIR/procs-pre-$i.txt"; then
      if [ -s "$LOG_DIR/procs-pre-$i.txt" ]; then
        echo "STRAY PROCESSES BEFORE ITER $i:"
        cat "$LOG_DIR/procs-pre-$i.txt"
        errors=$((errors+1))
        note="${note:+$note,}stray-before"
      fi
    fi

    # ========== reset ==========
    psql_run -c 'TRUNCATE "Deal","PriceSample","WorkerRun","Route","TrackedRoute","Alert","User","Account","Session","VerificationToken" RESTART IDENTITY CASCADE;' >/dev/null 2>&1 \
      || { echo "FAIL reset"; errors=$((errors+1)); note="${note:+$note,}db-reset"; }

    # ========== empty-DB homepage render ==========
    # Ensure the port is free — a zombie server on this port from a prior
    # aborted run silently hijacks test traffic otherwise.
    local holders
    holders=$(fuser -n tcp "$PORT" 2>/dev/null | tr -s ' ' || true)
    if [ -n "$holders" ]; then
      echo "  port $PORT held by: $holders — killing"
      fuser -k -n tcp "$PORT" 2>/dev/null || true
      sleep 1
    fi

    CRON_SECRET="abc123" NEXTAUTH_SECRET="t" NEXTAUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" \
      PORT=$PORT node .next/standalone/server.js >"$LOG_DIR/server-$i.log" 2>&1 &
    local spid=$!
    echo "$spid" > "$LOG_DIR/server-$i.pid"
    # Wait for health to respond (with longer patience)
    local waited=0
    while ! curl -sS --max-time 2 -o /dev/null "http://localhost:$PORT/api/health" 2>/dev/null; do
      waited=$((waited+1))
      if grep -q "EADDRINUSE" "$LOG_DIR/server-$i.log" 2>/dev/null; then
        echo "FAIL server EADDRINUSE on port $PORT"
        errors=$((errors+1)); note="${note:+$note,}port-in-use"
        break
      fi
      [ "$waited" -gt 15 ] && { echo "FAIL boot timeout"; errors=$((errors+1)); note="${note:+$note,}boot-timeout"; break; }
      sleep 1
    done

    echo "  --- empty-DB render ---"
    local code ok_empty=0
    code=$(curl -sS -o "$LOG_DIR/home-empty-$i.html" -w "%{http_code}" "http://localhost:$PORT/")
    assert "home/200 when empty" 200 "$code" || ok_empty=1
    if ! grep -q "No significant deals right now" "$LOG_DIR/home-empty-$i.html"; then
      echo "    FAIL empty-state copy missing"
      ok_empty=1
    else
      echo "    ok  empty-state renders"
    fi
    [ "$ok_empty" -ne 0 ] && { errors=$((errors+1)); note="${note:+$note,}empty-render"; }

    # ========== seed routes ==========
    npm run seed --silent 2>&1 | tail -1

    # ========== worker: 15 ticks ==========
    local tick_ok=0 tick_err=0 deal_total=0 worker_stderr_fail=0
    for t in $(seq 1 15); do
      out=$(npm run worker:once --silent 2>"$LOG_DIR/worker-$i-$t.err" | grep -E "^\[tick\]" | tail -1)
      [ -z "$out" ] && tick_err=$((tick_err+1)) && continue
      tick_ok=$((tick_ok+1))
      d=$(echo "$out" | grep -oE "newDeals=[0-9]+" | grep -oE "[0-9]+")
      e=$(echo "$out" | grep -oE "errors=[0-9]+" | grep -oE "[0-9]+")
      deal_total=$((deal_total + ${d:-0}))
      [ "${e:-0}" -ne 0 ] && tick_err=$((tick_err + ${e:-0}))
      # Worker stderr should only contain expected prisma warnings, not real errors
      if [ -s "$LOG_DIR/worker-$i-$t.err" ] && grep -qiE "error|unhandled|rejection" "$LOG_DIR/worker-$i-$t.err"; then
        worker_stderr_fail=$((worker_stderr_fail+1))
      fi
      sleep 1
    done
    echo "  tick_ok=$tick_ok tick_err=$tick_err deals=$deal_total worker_stderr_fail=$worker_stderr_fail"
    [ "$tick_err" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}worker-errors"; }
    [ "$tick_ok" -lt 15 ] && { errors=$((errors+1)); note="${note:+$note,}worker-ticks-missed"; }
    [ "$worker_stderr_fail" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}worker-stderr"; }

    # ========== endpoint matrix ==========
    echo "  --- endpoint matrix ---"
    local endpoint_fails=0
    while IFS='|' read -r name expected method url_path body hdr; do
      [ -z "$name" ] && continue
      local url="http://localhost:$PORT$url_path"
      local actual
      if [ -z "$body" ]; then
        actual=$(curl -sS -o /dev/null -w "%{http_code}" ${method:+-X "$method"} ${hdr:+-H "$hdr"} --max-time 6 "$url")
      else
        actual=$(curl -sS -o /dev/null -w "%{http_code}" ${method:+-X "$method"} -H 'content-type: application/json' -d "$body" --max-time 6 "$url")
      fi
      assert "$name" "$expected" "$actual" || endpoint_fails=$((endpoint_fails+1))
    done <<EOF
health|200|GET|/api/health||
sources|200|GET|/api/sources||
deals|200|GET|/api/deals||
deals-filtered-source|200|GET|/api/deals?source=baseline||
deals-min-score|200|GET|/api/deals?minScore=80||
deals-limit-bound|200|GET|/api/deals?limit=9999||
homepage|200|GET|/||
homepage-filter|200|GET|/?source=baseline||
sign-in|200|GET|/sign-in||
check-email|200|GET|/sign-in/check-email||
routes-unauth|307|GET|/routes||
deals-404|404|GET|/deals/fake-id||
favicon|200|GET|/favicon.svg||
robots|200|GET|/robots.txt||
cron-no-secret|403|POST|/api/cron/tick||
cron-wrong|403|POST|/api/cron/tick?key=nope||
cron-right-hdr|200|POST|/api/cron/tick||x-cron-secret: abc123
cron-right-qs|200|POST|/api/cron/tick?key=abc123||
routes-post-unauth|401|POST|/api/routes|{"origin":"JFK","destination":"LHR"}|
routes-post-bad-body|401|POST|/api/routes|not-json|
routes-delete-unauth|401|DELETE|/api/routes/any-id||
EOF

    # ========== deal detail ==========
    DEAL_ID=$(curl -sS "http://localhost:$PORT/api/deals?limit=1" | python3 -c 'import sys,json;d=json.load(sys.stdin)["deals"];print(d[0]["id"] if d else "")' 2>/dev/null)
    if [ -n "$DEAL_ID" ]; then
      code=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/deals/$DEAL_ID")
      assert "deal-detail" 200 "$code" || endpoint_fails=$((endpoint_fails+1))
    else
      echo "    FAIL deal-detail no id"
      endpoint_fails=$((endpoint_fails+1))
    fi

    # ========== JSON shape ==========
    echo "  --- JSON shape ---"
    curl -sS "http://localhost:$PORT/api/deals?limit=1" > "$LOG_DIR/deals-$i.json"
    python3 - <<'PY' "$LOG_DIR/deals-$i.json" >> "$log" 2>&1 || endpoint_fails=$((endpoint_fails+1))
import json, sys
p = json.load(open(sys.argv[1]))
assert "deals" in p, "missing deals key"
if p["deals"]:
  d = p["deals"][0]
  required = {"id","originCode","destinationCode","score","source","seenAt"}
  missing = required - set(d.keys())
  assert not missing, f"missing fields: {missing}"
  assert isinstance(d["score"], (int,float)), "score not numeric"
  assert len(d["originCode"]) == 3, "bad origin"
  assert len(d["destinationCode"]) == 3, "bad destination"
print("    ok  /api/deals JSON shape")
PY

    curl -sS "http://localhost:$PORT/api/health" > "$LOG_DIR/health-$i.json"
    python3 - <<'PY' "$LOG_DIR/health-$i.json" >> "$log" 2>&1 || endpoint_fails=$((endpoint_fails+1))
import json, sys
p = json.load(open(sys.argv[1]))
assert p["status"] == "ok", f"bad status: {p}"
assert p["routes"] >= 32, f"too few routes: {p}"
print("    ok  /api/health JSON shape")
PY

    curl -sS "http://localhost:$PORT/api/sources" > "$LOG_DIR/sources-$i.json"
    python3 - <<'PY' "$LOG_DIR/sources-$i.json" >> "$log" 2>&1 || endpoint_fails=$((endpoint_fails+1))
import json, sys
p = json.load(open(sys.argv[1]))
assert "sources" in p, "missing sources"
for k in ("duffel","amadeus","twitter","demoMode"):
  assert k in p["sources"], f"missing sources.{k}"
assert p["sources"]["demoMode"] is True, "expected demoMode in test env"
print("    ok  /api/sources JSON shape")
PY

    # ========== authenticated flow ==========
    echo "  --- authenticated flow (direct DB session) ---"
    # Seed user + session with known IDs (avoid psql status-line capture)
    local USER_ID="test-user-$i"
    local SESSION_TOKEN="test-token-$i-$(date +%s%N)"
    psql_run -c "INSERT INTO \"User\" (id, email, \"createdAt\") VALUES ('$USER_ID', 'test-$i@example.com', NOW());" >/dev/null
    psql_run -c "INSERT INTO \"Session\" (id, \"sessionToken\", \"userId\", expires) VALUES ('sess-$i', '$SESSION_TOKEN', '$USER_ID', NOW() + INTERVAL '1 day');" >/dev/null
    local COOKIE="next-auth.session-token=$SESSION_TOKEN"

    # POST /api/routes with valid auth+body
    resp=$(curl -sS -w "\n%{http_code}" -X POST \
      -H "Cookie: $COOKIE" -H "content-type: application/json" \
      -d '{"origin":"JFK","destination":"LHR","targetCents":50000}' \
      "http://localhost:$PORT/api/routes")
    code=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | head -n -1)
    assert "authed POST /api/routes" 200 "$code" || endpoint_fails=$((endpoint_fails+1))
    tracked_id=$(echo "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tracked"]["id"])' 2>/dev/null || echo "")

    # GET /api/routes as auth'd user
    code=$(curl -sS -o /dev/null -w "%{http_code}" -H "Cookie: $COOKIE" "http://localhost:$PORT/api/routes")
    assert "authed GET /api/routes" 200 "$code" || endpoint_fails=$((endpoint_fails+1))

    # Invalid IATA
    code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
      -H "Cookie: $COOKIE" -H "content-type: application/json" \
      -d '{"origin":"XYZ","destination":"XYZ"}' \
      "http://localhost:$PORT/api/routes")
    assert "authed same-origin rejected" 400 "$code" || endpoint_fails=$((endpoint_fails+1))

    # Malformed body
    code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
      -H "Cookie: $COOKIE" -H "content-type: application/json" \
      -d 'not-json-at-all' \
      "http://localhost:$PORT/api/routes")
    assert "authed bad json" 400 "$code" || endpoint_fails=$((endpoint_fails+1))

    # DELETE
    if [ -n "$tracked_id" ]; then
      code=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE -H "Cookie: $COOKIE" "http://localhost:$PORT/api/routes/$tracked_id")
      assert "authed DELETE /api/routes/[id]" 200 "$code" || endpoint_fails=$((endpoint_fails+1))
      # Second delete should 404
      code=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE -H "Cookie: $COOKIE" "http://localhost:$PORT/api/routes/$tracked_id")
      assert "delete-already-gone 404" 404 "$code" || endpoint_fails=$((endpoint_fails+1))
    fi

    # /routes page as auth'd user
    code=$(curl -sS -o /dev/null -w "%{http_code}" -H "Cookie: $COOKIE" "http://localhost:$PORT/routes")
    assert "authed GET /routes" 200 "$code" || endpoint_fails=$((endpoint_fails+1))

    # ========== concurrent cron ticks (dedupe race) ==========
    echo "  --- concurrent cron ticks x3 ---"
    local tids=()
    for k in 1 2 3; do
      curl -sS -o /dev/null -w "  ticker $k -> %{http_code}\n" -X POST -H "x-cron-secret: abc123" "http://localhost:$PORT/api/cron/tick" &
      tids+=("$!")
    done
    # Wait only for the curl jobs — `wait` with no args would also wait for the
    # Next server (a child of this block) and hang forever.
    for tid in "${tids[@]}"; do wait "$tid" 2>/dev/null; done
    # Check there were no serialized errors in server log for these.
    # grep -c returns non-zero when zero matches; `|| true` swallows that so the
    # numeric test below doesn't see "0\n0".
    recent_errs=$(grep -c -iE "unhandled|rejection|prisma.*failed" "$LOG_DIR/server-$i.log" 2>/dev/null || true)
    recent_errs=${recent_errs:-0}
    if [ "$recent_errs" -gt 0 ]; then
      echo "    FAIL concurrent ticks produced $recent_errs errors"
      endpoint_fails=$((endpoint_fails+1))
    else
      echo "    ok  no server errors during concurrent ticks"
    fi

    # ========== content assertions ==========
    echo "  --- content ---"
    curl -sS --max-time 6 "http://localhost:$PORT/" > "$LOG_DIR/home-$i.html"
    local content_fails=0
    for needle in "Significantly discounted air travel" "Live deal feed" "polling every 60 seconds"; do
      grep -q "$needle" "$LOG_DIR/home-$i.html" || { echo "    FAIL content: '$needle'"; content_fails=$((content_fails+1)); }
    done
    n_cards=$(grep -oE 'href="/deals/cmo[a-z0-9]+"' "$LOG_DIR/home-$i.html" | wc -l)
    [ "$n_cards" -lt 1 ] && { echo "    FAIL no deal cards"; content_fails=$((content_fails+1)); } \
                       || echo "    ok  $n_cards deal cards rendered"

    # favicon body should be SVG (write to file first to avoid SIGPIPE noise)
    curl -sS -o "$LOG_DIR/fav-$i.svg" "http://localhost:$PORT/favicon.svg"
    if head -c 50 "$LOG_DIR/fav-$i.svg" | grep -q "<svg"; then
      echo "    ok  favicon serves SVG content"
    else
      echo "    FAIL favicon body: $(head -c 80 "$LOG_DIR/fav-$i.svg")"
      content_fails=$((content_fails+1))
    fi

    [ "$content_fails" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}content($content_fails)"; }
    [ "$endpoint_fails" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}endpoints($endpoint_fails)"; }

    # ========== server-log scan ==========
    srv_errs=$(grep -c -iE "unhandled|rejection|ECONNREFUSED|prisma.*error" "$LOG_DIR/server-$i.log" 2>/dev/null || true)
    srv_errs=${srv_errs:-0}
    if [ "$srv_errs" -gt 0 ]; then
      echo "  server log errors: $srv_errs"
      echo "    sample:"
      grep -iE "unhandled|rejection|ECONNREFUSED|prisma.*error" "$LOG_DIR/server-$i.log" | head -3
      errors=$((errors+1))
      note="${note:+$note,}server-log-errors"
    fi

    # ========== teardown ==========
    # SIGTERM first, then SIGKILL if it's still alive after 3s — Next's
    # standalone server doesn't always shut down fast on SIGTERM and `wait`
    # would block indefinitely.
    kill "$spid" 2>/dev/null
    local waited=0
    while kill -0 "$spid" 2>/dev/null && [ "$waited" -lt 3 ]; do
      sleep 1
      waited=$((waited+1))
    done
    kill -9 "$spid" 2>/dev/null
    wait "$spid" 2>/dev/null
    fuser -k -n tcp "$PORT" 2>/dev/null || true
    sleep 1

    # Check no stray procs after kill
    if pgrep -af "standalone/server.js|tsx src/worker" | grep -v "test-loop\|grep" > "$LOG_DIR/procs-post-$i.txt"; then
      if [ -s "$LOG_DIR/procs-post-$i.txt" ]; then
        echo "STRAY AFTER KILL:"
        cat "$LOG_DIR/procs-post-$i.txt"
        errors=$((errors+1))
        note="${note:+$note,}stray-after"
      fi
    fi
  } >"$log" 2>&1

  if [ "$errors" -eq 0 ]; then
    pass_count=$((pass_count+1))
    printf "[%02d/%02d] \033[32mPASS\033[0m  (tick/deal in log %s)\n" "$i" "$N" "$log"
  else
    fail_count=$((fail_count+1))
    FAILURES+=("iter $i: $note")
    printf "[%02d/%02d] \033[31mFAIL\033[0m  %s  (log: %s)\n" "$i" "$N" "$note" "$log"
    echo "--- tail of failing iter log ---"
    tail -40 "$log"
    echo "--- end ---"
  fi
}

for i in $(seq 1 "$N"); do
  run_once "$i"
done

echo
echo "================ summary ================"
echo "passed: $pass_count / $N"
echo "failed: $fail_count / $N"
if [ "$fail_count" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}"
  exit 1
fi
