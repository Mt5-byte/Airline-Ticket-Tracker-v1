import { createHash } from "crypto";
import type { DealSignal } from "./types";
import { extractPriceCents, extractRoute } from "./extract";

const DEFAULT_ACCOUNTS = "SecretFlying,TheFlightDeal,airfarewatchdog,going,Scottscheapflt";

// Per-minute polling of 5 accounts would burn ~216k reads/month — 20x over
// the X API Basic tier (10k/mo), going dark for most of each month. Default
// to one poll per 30 minutes (~7.2k/mo), tunable via X_POLL_MINUTES.
const DEFAULT_POLL_MINUTES = 30;
let lastPollAt = 0;

type CachedUser = { id: string; username: string };
let userCache: CachedUser[] | null = null;
let lastFetch = 0;

async function getUserIds(
  token: string,
  usernames: string[],
  signal?: AbortSignal,
): Promise<CachedUser[]> {
  if (userCache && Date.now() - lastFetch < 24 * 3600 * 1000) return userCache;
  // Pass the tick's AbortSignal — a stalled api.x.com connection must not be
  // able to hold the worker past its per-minute budget.
  const res = await fetch(`https://api.x.com/2/users/by?usernames=${usernames.join(",")}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
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
  const pollMinutes = Number(process.env.X_POLL_MINUTES) || DEFAULT_POLL_MINUTES;
  if (Date.now() - lastPollAt < pollMinutes * 60_000) return [];
  lastPollAt = Date.now(); // set before fetching so errors don't cause hammering
  const accountsEnv = (process.env.X_DEAL_ACCOUNTS || DEFAULT_ACCOUNTS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!accountsEnv.length) return [];

  const users = await getUserIds(token, accountsEnv, signal);
  if (!users.length) return [];

  const out: DealSignal[] = [];
  // Poll per-user recent tweets. With the 30-minute gate above, 5 accounts
  // cost ~7.2k reads/month — inside the Basic tier's 10k/mo.
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
