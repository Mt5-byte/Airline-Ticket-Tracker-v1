# Skybird — real-time airline deal hunter

Skybird polls commercial flight APIs, curated deal feeds, and X (Twitter)
**every 60 seconds**, scores each fare against its own rolling 30-day baseline,
and surfaces the outliers in a fast, minimal UI.

- **Sources:** Duffel, Amadeus, Secret Flying / The Flight Deal / Thrifty
  Traveler / Airfare Watchdog (RSS), X API v2 for curated deal accounts.
  Gracefully falls back to a realistic demo-data generator when no keys are set
  — so the app runs out of the box.
- **Deal logic:** combines three signals — baseline-drop (≥20% below rolling
  30-day median), curated feed hits, and user-defined targets — ranked 0–100.
- **Stack:** Next.js 15 · TypeScript · Tailwind · Postgres + Prisma ·
  NextAuth (magic link + Google) · `croner` per-minute worker.
- **Designed to deploy:** Fly.io (`fly.toml`), Railway (`railway.json`), or any
  Docker host (`docker-compose.yml`).

## Quick start (local, zero keys)

```bash
# 1) Install deps
npm install

# 2) Start Postgres (and the full stack if you want)
docker compose up -d db
cp .env.example .env   # DATABASE_URL already points at the compose DB

# 3) Push schema + seed curated routes
npx prisma db push
npm run seed

# 4) In one terminal, start the web app
npm run dev

# 5) In another terminal, start the worker (runs every minute)
npm run worker
```

Open http://localhost:3000 — you'll see the Live Deal Feed in demo mode
within ~2 minutes (it needs a few samples per route before the baseline
trusts a deal).

## Adding real data sources

Set these in `.env` (any subset; missing keys just disable that source):

```bash
DUFFEL_ACCESS_TOKEN=...       # https://duffel.com
AMADEUS_CLIENT_ID=...         # https://developers.amadeus.com
AMADEUS_CLIENT_SECRET=...
X_BEARER_TOKEN=...            # https://developer.x.com (Basic tier+)
X_DEAL_ACCOUNTS=SecretFlying,TheFlightDeal,airfarewatchdog,going,Scottscheapflt

# Email alerts (any SMTP: Resend, SendGrid, Mailgun, Postmark, ...)
EMAIL_SERVER_HOST=smtp.resend.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=resend
EMAIL_SERVER_PASSWORD=...
EMAIL_FROM="Skybird <alerts@yourdomain.com>"

GOOGLE_CLIENT_ID=...          # https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=$(openssl rand -base64 32)
```

Restart the worker and new deals will start flowing from the real APIs.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ worker (per-minute tick)                                         │
│  ├─ fetchPriceQuote()  →  Duffel → Amadeus → demo fallback       │
│  ├─ fetchDealSignals() →  curated RSS + X API v2                 │
│  └─ deal-engine        →  baseline | curated | user-target       │
│                             ↓                                    │
│                          Postgres (Prisma)                       │
│                             ↓                                    │
│ web (Next.js)           ←──┘                                     │
│  ├─ /              Live deal feed                                │
│  ├─ /deals/[id]    Deal detail + 30-day sparkline                │
│  ├─ /routes        User-tracked routes + targets                 │
│  └─ /api/cron/tick HTTP trigger (optional; CRON_SECRET gated)    │
└──────────────────────────────────────────────────────────────────┘
```

### How a deal is born

1. **Sample.** Every minute the worker calls the cheapest-offer endpoint for
   every curated route plus every user-tracked route, and stores a
   `PriceSample`.
2. **Baseline.** After ≥10 samples exist for a route, the engine computes the
   rolling-30-day median and flags a new `Deal` if the fresh price is
   ≥20% below it.
3. **Signal.** In parallel it pulls RSS feeds and X timelines for well-known
   deal accounts, extracts origin/destination IATA codes, and persists those
   as `curated` or `twitter` deals.
4. **Target.** Every tracked route checks the user's `targetCents` /
   `targetDropPct`; hits fire `user-target` deals at score 95.
5. **Alert.** Deals matching a user's tracked route trigger an email via
   nodemailer (once per deal per user).
6. **Rank.** The feed sorts by score desc, seenAt desc.

## Deploy

### Fly.io (recommended)

```bash
fly launch --copy-config --no-deploy          # uses the included fly.toml
fly postgres create                           # or any external Postgres
fly secrets set \
  DATABASE_URL="postgres://..." \
  NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  NEXTAUTH_URL="https://<your-app>.fly.dev" \
  APP_URL="https://<your-app>.fly.dev"
fly deploy
fly scale count web=1 worker=1
```

The `fly.toml` declares two process groups — `web` and `worker` — so the
per-minute loop runs in a dedicated machine and never competes with HTTP
handlers.

### Railway

Push this repo to GitHub, create a Railway project, add a Postgres plugin,
then **two** services from the same repo:

- **web** — Start command `node server.js` (uses the Dockerfile)
- **worker** — Start command `npx tsx src/worker/index.ts`

Set the same env vars as above. Done.

**Gotchas:**
- After creating each service, open **Settings → Build** and confirm
  **Builder = Dockerfile** (Railway's default is Nixpacks; the repo's
  `railway.json` requests Dockerfile but the dashboard setting wins). If you
  want to stay on Nixpacks, a fallback `nixpacks.toml` is included — it mirrors
  the Dockerfile build.
- The worker service must override its **Start Command** to
  `npx tsx src/worker/index.ts` (the default start command comes from the
  Dockerfile's `CMD`, which is the web server).
- Set `NEXTAUTH_URL` and `APP_URL` to the public Railway URL **after** the
  first deploy gives you one, then redeploy once.

### Docker Compose (self-host)

```bash
cp .env.example .env
# edit provider keys, then:
docker compose up --build -d
```

This brings up Postgres + web + worker with the schema migrated automatically.

### Vercel + external worker

Skybird runs fine on Vercel for the web half; call the
`POST /api/cron/tick?key=$CRON_SECRET` endpoint on a per-minute schedule from
any external cron (Vercel Cron Jobs on Pro plan, Upstash QStash, GitHub
Actions, etc.).

## Scripts

| command              | what it does                                   |
|----------------------|------------------------------------------------|
| `npm run dev`        | Next.js dev server                             |
| `npm run build`      | Production build (runs `prisma generate`)      |
| `npm run start`      | Production server                              |
| `npm run worker`     | Per-minute tick scheduler (long-running)       |
| `npm run worker:once`| Single tick — for external cron invocations    |
| `npm run seed`       | Seed ~30 curated top routes                    |
| `npm run prisma:migrate` | `prisma migrate deploy` (production)       |

## Notes

- **Rate limits.** With ~30 curated routes the worker makes ~30 provider calls
  per minute — well inside Duffel's and Amadeus's test-tier caps. Add more
  routes judiciously.
- **Twitter/X.** Costs $200/mo minimum (Basic tier). If you skip it, the
  curated RSS feeds still cover most public mistake-fare chatter.
- **ToS.** Duffel and Amadeus are legit commercial APIs; scraping airline sites
  directly is not wired up on purpose.
- **Standalone server + `.env`.** Next.js's standalone server (`node server.js`)
  does not auto-load `.env` at runtime. For `npm run start` / Docker / Fly /
  Railway, pass env vars directly (Fly secrets, Railway variables, or
  `docker compose` `env_file`) — not via a local `.env`.
