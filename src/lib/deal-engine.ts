import { createHash } from "crypto";
import { prisma } from "./db";
import { airportLabel, lookupAirport } from "./airports";
import type { DealSignal, PriceQuote } from "./sources";

// A deal surfaces when the current price is materially below the route's
// rolling 30-day median (default 20% for "notable", 30%+ for "significant").
export const DEAL_THRESHOLD_PCT = 20;
export const SIGNIFICANT_THRESHOLD_PCT = 30;

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
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pull 30d price history for a route. */
async function routeBaseline(routeId: string): Promise<number | null> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.priceSample.findMany({
    where: { routeId, sampledAt: { gte: since } },
    select: { priceCents: true },
  });
  return median(rows.map((r) => r.priceCents));
}

export async function evaluateQuote(
  routeId: string,
  quote: PriceQuote,
): Promise<ScoredDeal | null> {
  const baseline = await routeBaseline(routeId);
  // Need at least ~10 samples before trusting the baseline (~2 hours of polling).
  const samples = await prisma.priceSample.count({ where: { routeId } });
  if (!baseline || samples < 10) return null;
  if (quote.priceCents >= baseline) return null;

  const discountPct = ((baseline - quote.priceCents) / baseline) * 100;
  if (discountPct < DEAL_THRESHOLD_PCT) return null;

  // Score: saturating curve that values big drops heavily and decays modestly
  // by absolute price (a $50 drop on $200 matters more than on $2,000 in relative terms,
  // but a low absolute price is a bonus).
  const base = Math.min(70, discountPct * 1.5);
  const priceBonus = clamp(30 - quote.priceCents / 4000, 0, 30); // $0 → +30, $1200 → 0
  const score = Math.round(base + priceBonus);

  const dedupeKey = createHash("sha1")
    .update(`baseline:${routeId}:${quote.priceCents}:${Math.floor(Date.now() / 3_600_000)}`)
    .digest("hex");

  return {
    origin: quote.origin,
    destination: quote.destination,
    priceCents: quote.priceCents,
    baselineCents: baseline,
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
    sourceUrl: signal.sourceUrl,
    headline: signal.headline,
    body: signal.body,
    dedupeKey: signal.dedupeKey,
    expiresAt: signal.expiresAt ?? new Date(Date.now() + 14 * 86_400_000),
  };
}

export async function evaluateUserTarget(
  routeId: string,
  quote: PriceQuote,
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
  const baseline = await routeBaseline(routeId);
  const results: ScoredDeal[] = [];

  for (const tr of trackers) {
    let hit = false;
    let reason = "";
    if (tr.targetCents && quote.priceCents <= tr.targetCents) {
      hit = true;
      reason = `Target $${(tr.targetCents / 100).toFixed(0)} hit`;
    }
    if (!hit && tr.targetDropPct && baseline) {
      const drop = ((baseline - quote.priceCents) / baseline) * 100;
      if (drop >= tr.targetDropPct) {
        hit = true;
        reason = `−${Math.round(drop)}% vs baseline`;
      }
    }
    if (!hit) continue;
    const dedupeKey = createHash("sha1")
      .update(`user:${tr.id}:${quote.priceCents}:${Math.floor(Date.now() / 3_600_000)}`)
      .digest("hex");
    results.push({
      origin: quote.origin,
      destination: quote.destination,
      priceCents: quote.priceCents,
      baselineCents: baseline ?? undefined,
      discountPct: baseline ? ((baseline - quote.priceCents) / baseline) * 100 : undefined,
      score: 95,
      cabin: quote.cabin,
      carrier: quote.carrier,
      source: "user-target",
      sourceLabel: reason,
      dedupeKey,
      routeId,
      departAt: quote.departAt,
      returnAt: quote.returnAt,
    });
  }
  return results;
}

export async function persistDeal(d: ScoredDeal): Promise<{ created: boolean; id: string } | null> {
  const origin = lookupAirport(d.origin);
  const destination = lookupAirport(d.destination);
  try {
    const existing = await prisma.deal.findUnique({ where: { dedupeKey: d.dedupeKey } });
    if (existing) return { created: false, id: existing.id };
    const row = await prisma.deal.create({
      data: {
        routeId: d.routeId,
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
      },
    });
    return { created: true, id: row.id };
  } catch (e) {
    // Unique-constraint collision under race — treat as no-op.
    return null;
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}
