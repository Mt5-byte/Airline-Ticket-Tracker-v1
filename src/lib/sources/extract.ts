import { AIRPORTS } from "../airports";

/**
 * Pull an origin/destination pair out of free text (feed titles, tweets).
 * Candidate 3-letter tokens are validated against the airport dictionary —
 * that removes noise words ("USA", "NEW", "OCT") without maintaining a
 * blacklist that inevitably drifts and swallows real airports (an earlier
 * version blacklisted LAX and silently dropped every Los Angeles deal).
 */
export function extractRoute(text: string): { origin?: string; destination?: string } {
  const matches = text.match(/\b[A-Z]{3}\b/g);
  if (!matches) return {};
  const seen: string[] = [];
  for (const m of matches) {
    if (!AIRPORTS[m]) continue;
    if (!seen.includes(m)) seen.push(m);
    if (seen.length === 2) break;
  }
  if (seen.length === 2 && seen[0] !== seen[1]) {
    return { origin: seen[0], destination: seen[1] };
  }
  return {};
}

/**
 * Extract a USD price. Handles thousands separators: "$1,088" → 108800,
 * not a miss; "$12,345" → 1234500, not $12. Values outside a sane airfare
 * range are rejected rather than fed into deal scoring.
 */
export function extractPriceCents(text: string): number | undefined {
  const m = text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?!\d)/);
  if (!m) return undefined;
  const dollars = parseInt(m[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(dollars) || dollars < 20 || dollars > 20000) return undefined;
  return dollars * 100;
}
