import { createHash } from "crypto";
import type { DealSignal } from "./types";

const DEFAULT_ACCOUNTS = "SecretFlying,TheFlightDeal,airfarewatchdog,going,Scottscheapflt";

type CachedUser = { id: string; username: string };
let userCache: CachedUser[] | null = null;
let lastFetch = 0;

function extractRoute(text: string): { origin?: string; destination?: string } {
  const matches = text.match(/\b[A-Z]{3}\b/g);
  if (!matches) return {};
  const bad = new Set(["USA", "USD", "GBP", "EUR", "NYC", "RT", "OW", "NEW", "DEAL", "OFF", "NOW", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN"]);
  const clean = matches.filter((m) => !bad.has(m));
  return { origin: clean[0], destination: clean[1] };
}

function extractPriceCents(text: string): number | undefined {
  const m = text.match(/\$\s?(\d{2,4})/);
  if (!m) return undefined;
  return parseInt(m[1], 10) * 100;
}

async function getUserIds(token: string, usernames: string[]): Promise<CachedUser[]> {
  if (userCache && Date.now() - lastFetch < 24 * 3600 * 1000) return userCache;
  const res = await fetch(`https://api.x.com/2/users/by?usernames=${usernames.join(",")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`[x-api] user lookup ${res.status}`);
    return userCache ?? [];
  }
  const json: any = await res.json();
  const users = (json?.data ?? []) as CachedUser[];
  userCache = users;
  lastFetch = Date.now();
  return users;
}

/**
 * Poll X for recent tweets from curated deal accounts.
 * Requires a v2 Bearer token. Returns [] when no token is configured.
 */
export async function fetchXDeals(signal?: AbortSignal): Promise<DealSignal[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  const accountsEnv = (process.env.X_DEAL_ACCOUNTS || DEFAULT_ACCOUNTS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!accountsEnv.length) return [];

  const users = await getUserIds(token, accountsEnv);
  if (!users.length) return [];

  const out: DealSignal[] = [];
  // Poll per-user recent tweets. At 5 accounts this is ~5 req/min — well within
  // the Basic tier (10K reads/mo) for a single-instance deployment.
  await Promise.all(
    users.map(async (u) => {
      const params = new URLSearchParams({
        "max_results": "10",
        "tweet.fields": "created_at,entities,public_metrics",
        "exclude": "retweets,replies",
      });
      const res = await fetch(`https://api.x.com/2/users/${u.id}/tweets?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) {
        console.warn(`[x-api] ${u.username} tweets ${res.status}`);
        return;
      }
      const json: any = await res.json();
      const tweets: any[] = json?.data ?? [];
      for (const t of tweets) {
        const text: string = t.text ?? "";
        const { origin, destination } = extractRoute(text);
        if (!origin || !destination) continue;
        const priceCents = extractPriceCents(text);
        const url = `https://x.com/${u.username}/status/${t.id}`;
        out.push({
          origin,
          destination,
          priceCents,
          currency: "USD",
          headline: text.slice(0, 140),
          body: text,
          sourceLabel: `@${u.username}`,
          sourceUrl: url,
          source: "twitter",
          seenAt: t.created_at ? new Date(t.created_at) : new Date(),
          dedupeKey: createHash("sha1").update(`x:${t.id}`).digest("hex"),
        });
      }
    }),
  );
  return out;
}
