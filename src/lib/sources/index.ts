import { fetchDuffelQuote } from "./duffel";
import { fetchAmadeusQuote } from "./amadeus";
import { generateDemoQuote } from "./demo";
import { fetchCuratedFeeds } from "./curated-feeds";
import { fetchXDeals } from "./x-api";
import type { DealSignal, PriceQuote } from "./types";

export type { DealSignal, PriceQuote };

const hasDuffel = () => Boolean(process.env.DUFFEL_ACCESS_TOKEN);
const hasAmadeus = () =>
  Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);

/** True when at least one real fare provider is configured. */
export function hasRealProvider(): boolean {
  return hasDuffel() || hasAmadeus();
}

/**
 * Fetch the current cheapest fare for a route.
 *
 * When a real provider is configured, a provider failure returns null — the
 * caller skips that sample. It must NOT silently fall back to the demo
 * generator: demo prices come from a different distribution, so one bad
 * minute at the provider would poison the route's real 30-day baseline and
 * mint bogus "discount" deals. Demo data is used only when no provider is
 * configured at all.
 */
export async function fetchPriceQuote(
  origin: string,
  destination: string,
  signal?: AbortSignal,
): Promise<PriceQuote | null> {
  if (!hasRealProvider()) {
    return generateDemoQuote(origin, destination);
  }
  if (hasDuffel()) {
    const q = await fetchDuffelQuote(origin, destination, signal).catch(() => null);
    if (q) return q;
  }
  if (hasAmadeus()) {
    const q = await fetchAmadeusQuote(origin, destination, signal).catch(() => null);
    if (q) return q;
  }
  return null;
}

export async function fetchDealSignals(signal?: AbortSignal): Promise<DealSignal[]> {
  const [curated, twitter] = await Promise.all([
    fetchCuratedFeeds(signal).catch((e) => {
      console.warn("[sources] curated feeds failed:", e.message);
      return [];
    }),
    fetchXDeals(signal).catch((e) => {
      console.warn("[sources] x api failed:", e.message);
      return [];
    }),
  ]);
  return [...curated, ...twitter];
}

export function sourcesStatus() {
  return {
    duffel: hasDuffel(),
    amadeus: hasAmadeus(),
    twitter: Boolean(process.env.X_BEARER_TOKEN),
    demoMode: !hasRealProvider(),
  };
}
