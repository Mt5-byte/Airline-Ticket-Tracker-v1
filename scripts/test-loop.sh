#!/usr/bin/env bash
# Runs the Skybird test harness N times, each iteration doing a full reset,
# seed, worker polling, server boot, endpoint probing, and content checks.
# Exits non-zero if any iteration fails.

set -u
N="${1:-10}"
PORT="${PORT:-3011}"
DATABASE_URL="${DATABASE_URL:-postgresql://skybird:skybird@localhost:5432/skybird?schema=public}"
export DATABASE_URL

LOG_DIR=/tmp/skybird-loop
mkdir -p "$LOG_DIR"

psql_run() { PGPASSWORD=skybird psql -h localhost -U skybird -d skybird "$@"; }

pass_count=0
fail_count=0
declare -a FAILURES

run_once() {
  local i="$1"
  local log="$LOG_DIR/iter-$i.log"
  local errors=0
  local note=""

  {
    echo "=== iteration $i ==="
    date -Is

    # --- reset + seed ---
    psql_run -c 'TRUNCATE "Deal","PriceSample","WorkerRun","Route","TrackedRoute","Alert" RESTART IDENTITY CASCADE;' >/dev/null 2>&1 \
      || { echo "FAIL reset"; errors=$((errors+1)); note="db-reset"; }
    npm run seed --silent 2>&1 | tail -1

    # --- worker: 15 ticks spaced 1s ---
    local tick_ok=0 tick_err=0 deal_total=0
    for t in $(seq 1 15); do
      out=$(npm run worker:once --silent 2>&1 | grep -E "^\[tick\]" | tail -1)
      if [ -z "$out" ]; then
        tick_err=$((tick_err+1))
      else
        tick_ok=$((tick_ok+1))
        d=$(echo "$out" | grep -oE "newDeals=[0-9]+" | grep -oE "[0-9]+")
        deal_total=$((deal_total + ${d:-0}))
        e=$(echo "$out" | grep -oE "errors=[0-9]+" | grep -oE "[0-9]+")
        if [ "${e:-0}" -ne 0 ]; then
          tick_err=$((tick_err + ${e:-0}))
        fi
      fi
      sleep 1
    done
    echo "tick_ok=$tick_ok tick_err=$tick_err deals=$deal_total"
    [ "$tick_err" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}worker-errors"; }
    [ "$tick_ok" -lt 15 ] && { errors=$((errors+1)); note="${note:+$note,}worker-ticks-missed"; }

    # --- server ---
    CRON_SECRET="abc123" NEXTAUTH_SECRET="t" NEXTAUTH_URL="http://localhost:$PORT" APP_URL="http://localhost:$PORT" \
      PORT=$PORT node .next/standalone/server.js >"$LOG_DIR/server-$i.log" 2>&1 &
    local spid=$!
    echo "$spid" > "$LOG_DIR/server-$i.pid"
    sleep 2

    # Prove the server actually responds
    local attempts=0
    while ! curl -sS --max-time 2 -o /dev/null "http://localhost:$PORT/api/health" 2>/dev/null; do
      attempts=$((attempts+1))
      [ "$attempts" -gt 10 ] && { echo "FAIL server start"; errors=$((errors+1)); note="${note:+$note,}boot-timeout"; break; }
      sleep 1
    done

    # --- endpoint matrix ---
    local endpoint_fails=0
    while IFS='|' read -r name expected method url_path body hdr; do
      [ -z "$name" ] && continue
      local url="http://localhost:$PORT$url_path"
      if [ -z "$body" ]; then
        actual=$(curl -sS -o /dev/null -w "%{http_code}" ${method:+-X "$method"} ${hdr:+-H "$hdr"} --max-time 6 "$url")
      else
        actual=$(curl -sS -o /dev/null -w "%{http_code}" ${method:+-X "$method"} -H 'content-type: application/json' -d "$body" --max-time 6 "$url")
      fi
      if [ "$actual" = "$expected" ]; then
        printf "  ok  %-40s %s\n" "$name" "$actual"
      else
        printf "  FAIL %-40s want %s got %s\n" "$name" "$expected" "$actual"
        endpoint_fails=$((endpoint_fails+1))
      fi
    done <<EOF
health|200|GET|/api/health||
sources|200|GET|/api/sources||
deals|200|GET|/api/deals||
homepage|200|GET|/||
homepage-filter|200|GET|/?source=baseline||
sign-in|200|GET|/sign-in||
check-email|200|GET|/sign-in/check-email||
routes-unauth|307|GET|/routes||
deals-404|404|GET|/deals/fake-id||
cron-no-secret|403|POST|/api/cron/tick||
cron-wrong|403|POST|/api/cron/tick?key=nope||
cron-right-hdr|200|POST|/api/cron/tick||x-cron-secret: abc123
cron-right-qs|200|POST|/api/cron/tick?key=abc123||
routes-post-unauth|401|POST|/api/routes|{"origin":"JFK","destination":"LHR"}|
EOF

    # Deal detail endpoint — needs live id
    DEAL_ID=$(curl -sS "http://localhost:$PORT/api/deals?limit=1" | python3 -c 'import sys,json;d=json.load(sys.stdin)["deals"];print(d[0]["id"] if d else "")' 2>/dev/null)
    if [ -n "$DEAL_ID" ]; then
      actual=$(curl -sS -o /dev/null -w "%{http_code}" "http://localhost:$PORT/deals/$DEAL_ID")
      if [ "$actual" = "200" ]; then
        printf "  ok  %-40s %s\n" "deal-detail" "$actual"
      else
        printf "  FAIL %-40s want 200 got %s\n" "deal-detail" "$actual"
        endpoint_fails=$((endpoint_fails+1))
      fi
    else
      printf "  FAIL %-40s no deal id returned\n" "deal-detail"
      endpoint_fails=$((endpoint_fails+1))
    fi

    [ "$endpoint_fails" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}endpoints($endpoint_fails)"; }

    # --- content assertions ---
    curl -sS --max-time 6 "http://localhost:$PORT/" > "$LOG_DIR/home-$i.html"
    local content_fails=0
    for needle in "Significantly discounted air travel" "Live deal feed" "polling every 60 seconds"; do
      if ! grep -q "$needle" "$LOG_DIR/home-$i.html"; then
        echo "  FAIL content: missing '$needle'"
        content_fails=$((content_fails+1))
      fi
    done
    n_cards=$(grep -oE 'href="/deals/cmo[a-z0-9]+"' "$LOG_DIR/home-$i.html" | wc -l)
    if [ "$n_cards" -lt 1 ]; then
      echo "  FAIL content: no deal cards in homepage"
      content_fails=$((content_fails+1))
    else
      echo "  ok  homepage has $n_cards deal cards"
    fi
    [ "$content_fails" -gt 0 ] && { errors=$((errors+1)); note="${note:+$note,}content($content_fails)"; }

    # --- teardown ---
    kill "$spid" 2>/dev/null
    sleep 1
  } >"$log" 2>&1

  if [ "$errors" -eq 0 ]; then
    pass_count=$((pass_count+1))
    printf "[%02d/%02d] \033[32mPASS\033[0m\n" "$i" "$N"
  else
    fail_count=$((fail_count+1))
    FAILURES+=("iter $i: $note")
    printf "[%02d/%02d] \033[31mFAIL\033[0m  %s  (log: %s)\n" "$i" "$N" "$note" "$log"
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
