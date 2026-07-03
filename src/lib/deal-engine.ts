import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { airportLabel, lookupAirport } from "./airports";
import { hasRealProvider, type DealSignal, type PriceQuote } from "./sources";

// A deal surfaces when the current price is materially below the route's
// rolling 30-day median (default 20% for "notable", 30%+ for "significant").
export const DEAL_THRESHOLD_PCT = 20;
export const SIGNIFICANT_THRESHOLD_PCT = 30;

// A route re-fires a baseline deal within this window only if the fare has
// dropped materially deeper than the already-open deal. Prevents a fare that
// jitters around a dip from minting a new deal (and emails) every poll.
const REFIRE_WINDOW_MS = 12 * 3_600_000;
const REFIRE_DEEPER_FACTOR = 0.95; // must be ≥5% cheaper than the open deal

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
};

export type RouteBaseline = { median: number | null; samples: number };

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/**
 * Rolling 30-day median + sample count, computed in SQL so the worker never
 * loads the raw per-minute sample rows into memory (43k rows/route/month).
 * Demo-generated samples are excluded whenever a real provider is configured,
 * so a transient real-provider outage can't poison the baseline.
 */
export async function routeBaseline(routeId: string): Promise<RouteBaseline> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const demoFilter = hasRealProvider() ? Prisma.sql`AND "source" <> 'demo'` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ median: number | null; n: number }>>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "priceCents") AS median,
           count(*)::int AS n
    FROM "PriceSample"
    WHERE "routeId" = ${routeId} AND "sampledAt" >= ${since} ${demoFilter}
  `;
  const row = rows[0];
  return { median: row?.median ?? null, samples: row?.n ?? 0 };
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

  // Re-arm guard: if a baseline deal is already open for this route, only fire
  // again when the fare has dropped materially below that deal's price.
  const open = await prisma.deal.findFirst({
    where: {
      routeId,
      source: "baseline",
      seenAt: { gte: new Date(Date.now() - REFIRE_WINDOW_MS) },
    },
    orderBy: { seenAt: "desc" },
    select: { priceCents: true },
  });
  if (open?.priceCents != null && quote.priceCents > open.priceCents * REFIRE_DEEPER_FACTOR) {
    return null;
  }

  // Score: saturating curve that values big drops heavily and decays modestly
  // by absolute price (a $50 drop on $200 matters more than on $2,000 in relative terms,
  // but a low absolute price is a bonus).
  const base = Math.min(70, discountPct * 1.5);
  const priceBonus = clamp(30 - quote.priceCents / 4000, 0, 30); // $0 → +30, $1200 → 0
  const score = Math.round(base + priceBonus);

  // Key on route + UTC day + a $25 price band — NOT the raw cent price, which
  // changes every poll and would re-fire (and re-email) once a minute.
  const dedupeKey = createHash("sha1")
    .update(`baseline:${routeId}:${dayBucket()}:${Math.floor(quote.priceCents / 2500)}`)
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
    if (!hit && tr.targetDropPct && baseline.median) {
      const drop = ((baseline.median - quote.priceCents) / baseline.median) * 100;
      if (drop >= tr.targetDropPct) {
        hit = true;
        reason = `−${Math.round(drop)}% vs baseline`;
      }
    }
    if (!hit) continue;
    // One target alert per tracker per UTC day. A fare hovering below the
    // target must not email the user every minute.
    const dedupeKey = createHash("sha1")
      .update(`user:${tr.id}:${dayBucket()}`)
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
    sourceLabel: d.sourceLabel,
    sourceUrl: d.sourceUrl,
    headline: d.headline,
    body: d.body,
    score: d.score,
    dedupeKey: d.dedupeKey,
    expiresAt: d.expiresAt,
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
