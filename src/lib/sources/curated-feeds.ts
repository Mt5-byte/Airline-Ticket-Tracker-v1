import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";
import type { DealSignal } from "./types";
import { extractPriceCents, extractRoute } from "./extract";

const FEEDS: Array<{ url: string; label: string }> = [
  { url: "https://www.secretflying.com/feed/", label: "Secret Flying" },
  { url: "https://www.theflightdeal.com/feed/", label: "The Flight Deal" },
  { url: "https://thriftytraveler.com/feed/", label: "Thrifty Traveler" },
  { url: "https://www.airfarewatchdog.com/blog/feed/", label: "Airfare Watchdog" },
];

const parser = new XMLParser({ ignoreAttributes: false });

function dedupe(url: string, title: string): string {
  return createHash("sha1").update(`${url}\n${title}`).digest("hex");
}

// fast-xml-parser returns a bare object (not a 1-element array) when a feed
// has exactly one <item>; normalize so .slice/.flatMap don't drop the feed.
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Atom/RSS fields arrive as strings, {"#text": ...} objects, or (for links)
// arrays of rel-tagged objects. Coerce defensively — naive `+ ""` turns
// object-valued summaries into the literal string "[object Object]".
function textOf(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v["#text"] === "string") return v["#text"];
  if (typeof v === "object") return "";
  return String(v);
}

function linkOf(l: any): string {
  if (!l) return "";
  if (typeof l === "string") return l;
  if (Array.isArray(l)) {
    const alt = l.find((x) => x?.["@_rel"] === "alternate") ?? l.find((x) => x?.["@_href"]) ?? l[0];
    return linkOf(alt);
  }
  return l["@_href"] ?? textOf(l);
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
    const items = asArray<any>(parsed?.rss?.channel?.item ?? parsed?.feed?.entry);
    return items.slice(0, 15).flatMap((it): DealSignal[] => {
      const title = textOf(it.title);
      const link = linkOf(it.link);
      const desc = textOf(it.description) || textOf(it["content:encoded"]) || textOf(it.summary);
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
