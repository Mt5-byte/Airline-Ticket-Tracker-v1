import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { airportLabel, lookupAirport } from "./airports";
import { hasRealProvider, type DealSignal, type PriceQuote } from "./sources";

// A deal surfaces when the current price is materially below the route's
// rolling 30-day median (default 20% for "notable", 30%+ for "significant").
export const DEAL_THRESHOLD_PCT = 20;
export const SIGNIFICANT_THRESHOLD_PCT = 30;

// Re-fire semantics for an open baseline deal (all enforced by the re-arm
// guard in evaluateQuote):
//   - materially deeper (≥5% below the deepest open deal) → fire
//   - fare recovered above ~15%-below-median since the open deal, then dipped
//     again → a NEW dip event → fire
//   - anything else (jitter, band edges, UTC-midnight rollover, worse price
//     in the same dip) → suppress
// The guard window must cover the full dedupe-key horizon (day bucket keeps a
// key live up to 24h) with margin, or deals re-fire when the window lapses.
const REFIRE_WINDOW_MS = 36 * 3_600_000;
const REFIRE_DEEPER_FACTOR = 0.95;
const RECOVERY_FRACTION = 1 - (DEAL_THRESHOLD_PCT - 5) / 100; // fare "recovered" above 85% of median

export type ScoredDeal = {
  origin: string;
  destination: string;
  priceCents?: number;
  baselineCents?: number;
  discountPct?: number;
  score: number;
  cabin: string;
  carrier?: string;
  departAt?: Date;
  returnAt?: Date;
  source: "baseline" | "curated" | "user-target" | "twitter";
  sourceLabel?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  dedupeKey: string;
  expiresAt?: Date;
  routeId?: string;
  userId?: string; // set for private user-target deals
  isDemo?: boolean; // minted from demo-generator data
  seenAt?: Date; // original publication time for feed/tweet signals
};

export type RouteBaseline = { median: number | null; samples: number };

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

// 5%-logarithmic price band: any ≥5% move lands in a different band, so the
// dedupe key can never silently veto a re-fire the guard approved. (A fixed
// $25 band blocked legitimate ≥5%-deeper re-fires on fares under ~$500.)
function priceBand(priceCents: number): number {
  return Math.round(Math.log(Math.max(1, priceCents)) / Math.log(1.05));
}

/**
 * Rolling 30-day median + sample count, computed in SQL so the worker never
 * loads raw per-minute rows into memory. USD-only (mixed currencies would
 * poison the distribution) and demo samples are excluded whenever a real
 * provider is configured. Median is rounded: percentile_cont interpolates
 * between samples and a fractional value would crash Int-column writes.
 */
export async function routeBaseline(routeId: string): Promise<RouteBaseline> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const demoFilter = hasRealProvider() ? Prisma.sql`AND "source" <> 'demo'` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ median: number | null; n: number }>>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "priceCents") AS median,
           count(*)::int AS n
    FROM "PriceSample"
    WHERE "routeId" = ${routeId} AND "sampledAt" >= ${since}
      AND "currency" = 'USD' ${demoFilter}
  `;
  const row = rows[0];
  return {
    median: row?.median != null ? Math.round(row.median) : null,
    samples: row?.n ?? 0,
  };
}

export async function evaluateQuote(
  routeId: string,
  quote: PriceQuote,
  baseline: RouteBaseline,
): Promise<ScoredDeal | null> {
  // Need at least ~10 samples before trusting the baseline (~2 hours of polling).
  if (!baseline.median || baseline.samples < 10) return null;
  if (quote.priceCents >= baseline.median) return null;

  const discountPct = ((baseline.median - quote.priceCents) / baseline.median) * 100;
  if (discountPct < DEAL_THRESHOLD_PCT) return null;

  // Re-arm guard. Anchor on the DEEPEST open deal in the window (not the most
  // recent — a shallow re-fire must not erase the guard's memory of a deeper
  // price), and ignore demo-era deals once real providers are configured.
  const windowStart = new Date(Date.now() - REFIRE_WINDOW_MS);
  const anchor = await prisma.deal.findFirst({
    where: {
      routeId,
      source: "baseline",
      seenAt: { gte: windowStart },
      ...(hasRealProvider() ? { isDemo: false } : {}),
    },
    orderBy: { priceCents: "asc" },
    select: { priceCents: true, seenAt: true },
  });
  if (anchor?.priceCents != null && quote.priceCents > anchor.priceCents * REFIRE_DEEPER_FACTOR) {
    // Not materially deeper than the open deal. Re-fire only if the fare
    // recovered (dip ended) since that deal — i.e. this is a new dip event.
    const recovered = await prisma.priceSample.findFirst({
      where: {
        routeId,
        sampledAt: { gt: anchor.seenAt },
        priceCents: { gte: Math.round(baseline.median * RECOVERY_FRACTION) },
        currency: "USD",
        ...(hasRealProvider() ? { source: { not: "demo" } } : {}),
      },
      select: { id: true },
    });
    if (!recovered) return null;
  }

  // Score: saturating curve that values big drops heavily and decays modestly
  // by absolute price (a $50 drop on $200 matters more than on $2,000 in relative terms,
  // but a low absolute price is a bonus).
  const base = Math.min(70, discountPct * 1.5);
  const priceBonus = clamp(30 - quote.priceCents / 4000, 0, 30); // $0 → +30, $1200 → 0
  const score = Math.round(base + priceBonus);

  const dedupeKey = createHash("sha1")
    .update(`baseline:${routeId}:${dayBucket()}:${priceBand(quote.priceCents)}`)
    .digest("hex");

  return {
    origin: quote.origin,
    destination: quote.destination,
    priceCents: quote.priceCents,
    baselineCents: baseline.median,
    discountPct,
    score,
    cabin: quote.cabin,
    carrier: quote.carrier,
    departAt: quote.departAt,
    returnAt: quote.returnAt,
    source: "baseline",
    sourceLabel: `Baseline −${Math.round(discountPct)}%`,
    dedupeKey,
    routeId,
    isDemo: quote.source === "demo",
  };
}

function safeExternalUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function evaluateSignal(signal: DealSignal): ScoredDeal {
  // Curated / Twitter signal → accept as deal with a heuristic score.
  const base = 55;
  const priceBonus = signal.priceCents ? clamp(30 - signal.priceCents / 4000, 0, 30) : 10;
  const sourceBonus = signal.source === "twitter" ? 5 : 10;
  const score = Math.round(base + priceBonus + sourceBonus);

  return {
    origin: signal.origin,
    destination: signal.destination,
    priceCents: signal.priceCents,
    score,
    cabin: signal.cabin || "economy",
    carrier: signal.carrier,
    source: signal.source === "twitter" ? "twitter" : "curated",
    sourceLabel: signal.sourceLabel,
    sourceUrl: safeExternalUrl(signal.sourceUrl), // block javascript:/data: from feeds
    headline: signal.headline,
    body: signal.body,
    dedupeKey: signal.dedupeKey,
    // Preserve the original publication time so old feed items don't surface
    // as if they broke "just now".
    seenAt: signal.seenAt,
    expiresAt: signal.expiresAt ?? new Date(Date.now() + 14 * 86_400_000),
  };
}

export async function evaluateUserTarget(
  routeId: string,
  quote: PriceQuote,
  baseline: RouteBaseline,
): Promise<ScoredDeal[]> {
  const trackers = await prisma.trackedRoute.findMany({
    where: {
      routeId,
      OR: [
        { targetCents: { not: null } },
        { targetDropPct: { not: null } },
      ],
    },
  });
  if (!trackers.length) return [];
  const results: ScoredDeal[] = [];

  for (const tr of trackers) {
    let hit = false;
    let reason = "";
    if (tr.targetCents && quote.priceCents <= tr.targetCents) {
      hit = true;
      reason = `Target $${(tr.targetCents / 100).toFixed(0)} hit`;
    }
    // The drop-percentage branch needs the same minimum-sample gate as
    // evaluateQuote: a "median" of 1-3 quotes is noise, and firing a score-95
    // alert off it emails users about phantom drops on freshly added routes.
    if (!hit && tr.targetDropPct && baseline.median && baseline.samples >= 10) {
      const drop = ((baseline.median - quote.priceCents) / baseline.median) * 100;
      if (drop >= tr.targetDropPct) {
        hit = true;
        reason = `−${Math.round(drop)}% vs baseline`;
      }
    }
    if (!hit) continue;
    // One alert per tracker per UTC day PER TARGET — the target values are in
    // the key so a target edited mid-day re-arms immediately (otherwise a user
    // who lowers their target after a morning alert silently misses the hit
    // on the new target until midnight).
    const dedupeKey = createHash("sha1")
      .update(`user:${tr.id}:${dayBucket()}:${tr.targetCents ?? ""}:${tr.targetDropPct ?? ""}`)
      .digest("hex");
    results.push({
      origin: quote.origin,
      destination: quote.destination,
      priceCents: quote.priceCents,
      baselineCents: baseline.median ?? undefined,
      discountPct: baseline.median
        ? ((baseline.median - quote.priceCents) / baseline.median) * 100
        : undefined,
      score: 95,
      cabin: quote.cabin,
      carrier: quote.carrier,
      source: "user-target",
      sourceLabel: reason,
      dedupeKey,
      routeId,
      userId: tr.userId,
      isDemo: quote.source === "demo",
      departAt: quote.departAt,
      returnAt: quote.returnAt,
    });
  }
  return results;
}

export async function persistDeal(d: ScoredDeal): Promise<{ created: boolean; id: string } | null> {
  const origin = lookupAirport(d.origin);
  const destination = lookupAirport(d.destination);
  // createMany({ skipDuplicates: true }) compiles to an atomic
  // `INSERT ... ON CONFLICT DO NOTHING` on PostgreSQL. Unlike `upsert`, which
  // Prisma implements as SELECT-then-INSERT (and therefore can race under
  // concurrent workers, emitting noisy stderr `prisma:error` lines even when
  // caught), this is race-free and silent on conflict. The returned `count`
  // tells us whether we inserted (1) or lost the race (0).
  const data = {
    routeId: d.routeId,
    userId: d.userId,
    originCode: d.origin,
    destinationCode: d.destination,
    originName: origin ? `${origin.city}, ${origin.country}` : airportLabel(d.origin),
    destinationName: destination ? `${destination.city}, ${destination.country}` : airportLabel(d.destination),
    priceCents: d.priceCents,
    baselineCents: d.baselineCents,
    discountPct: d.discountPct,
    cabin: d.cabin,
    carrier: d.carrier,
    departAt: d.departAt,
    returnAt: d.returnAt,
    source: d.source,
    isDemo: d.isDemo ?? false,
    sourceLabel: d.sourceLabel,
    sourceUrl: d.sourceUrl,
    headline: d.headline,
    body: d.body,
    score: d.score,
    dedupeKey: d.dedupeKey,
    expiresAt: d.expiresAt,
    ...(d.seenAt ? { seenAt: d.seenAt } : {}),
  };
  const result = await prisma.deal.createMany({ data: [data], skipDuplicates: true });
  const row = await prisma.deal.findUnique({
    where: { dedupeKey: d.dedupeKey },
    select: { id: true },
  });
  if (!row) return null;
  return { created: result.count === 1, id: row.id };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
