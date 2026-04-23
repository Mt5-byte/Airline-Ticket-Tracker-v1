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

export async function fetchPriceQuote(
  origin: string,
  destination: string,
  signal?: AbortSignal,
): Promise<PriceQuote> {
  // Try real providers in order. First hit wins; otherwise fall back to demo.
  if (hasDuffel()) {
    const q = await fetchDuffelQuote(origin, destination, signal).catch(() => null);
    if (q) return q;
  }
  if (hasAmadeus()) {
    const q = await fetchAmadeusQuote(origin, destination, signal).catch(() => null);
    if (q) return q;
  }
  return generateDemoQuote(origin, destination);
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
    demoMode: !hasDuffel() && !hasAmadeus(),
  };
}
