import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";
import type { DealSignal } from "./types";

const FEEDS: Array<{ url: string; label: string }> = [
  { url: "https://www.secretflying.com/feed/", label: "Secret Flying" },
  { url: "https://www.theflightdeal.com/feed/", label: "The Flight Deal" },
  { url: "https://thriftytraveler.com/feed/", label: "Thrifty Traveler" },
  { url: "https://www.airfarewatchdog.com/blog/feed/", label: "Airfare Watchdog" },
];

const parser = new XMLParser({ ignoreAttributes: false });

// Light IATA extractor. Pulls the first two distinct 3-letter airport codes from
// title + description. Good enough for "XYZ -> ABC" and "ATL to LAX" patterns.
function extractRoute(text: string): { origin?: string; destination?: string } {
  const matches = text.match(/\b[A-Z]{3}\b/g);
  if (!matches) return {};
  const seen: string[] = [];
  for (const m of matches) {
    // Filter common English all-caps noise.
    if (["USA", "USD", "GBP", "EUR", "RT", "OW", "CAD", "NYC", "LAX", "NEW", "DEAL", "OFF", "NOW", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN"].includes(m) && seen.length) continue;
    if (!seen.includes(m)) seen.push(m);
    if (seen.length === 2) break;
  }
  return { origin: seen[0], destination: seen[1] };
}

function extractPriceCents(text: string): number | undefined {
  const m = text.match(/\$\s?(\d{2,4})(?:\s?-\s?\$?\d{2,4})?/);
  if (!m) return undefined;
  return parseInt(m[1], 10) * 100;
}

function dedupe(url: string, title: string): string {
  return createHash("sha1").update(`${url}\n${title}`).digest("hex");
}

async function fetchFeed(feed: { url: string; label: string }, signal?: AbortSignal): Promise<DealSignal[]> {
  try {
    const res = await fetch(feed.url, {
      signal,
      headers: { "User-Agent": "SkybirdBot/1.0 (+https://skybird.app)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const items: any[] = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
    return items.slice(0, 15).flatMap((it): DealSignal[] => {
      const title: string = typeof it.title === "string" ? it.title : it.title?.["#text"] ?? "";
      const link: string = typeof it.link === "string" ? it.link : it.link?.["@_href"] ?? it.link?.["#text"] ?? "";
      const desc: string = (it.description ?? it["content:encoded"] ?? it.summary ?? "") + "";
      const { origin, destination } = extractRoute(`${title} ${desc}`);
      if (!origin || !destination) return [];
      const priceCents = extractPriceCents(`${title} ${desc}`);
      const pubDate = it.pubDate ?? it.published ?? it.updated;
      const seenAt = pubDate ? new Date(pubDate) : new Date();
      return [{
        origin,
        destination,
        priceCents,
        currency: "USD",
        headline: title.trim(),
        body: desc.replace(/<[^>]*>/g, "").slice(0, 500),
        sourceLabel: feed.label,
        sourceUrl: link,
        source: "curated",
        seenAt,
        dedupeKey: dedupe(link || feed.url, title),
      }];
    });
  } catch (e) {
    console.warn(`[curated] ${feed.label} failed:`, (e as Error).message);
    return [];
  }
}

export async function fetchCuratedFeeds(signal?: AbortSignal): Promise<DealSignal[]> {
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f, signal)));
  return results.flat();
}
