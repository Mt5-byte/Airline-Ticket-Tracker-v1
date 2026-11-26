import { AIRPORTS } from "../airports";

function valid(code: string | undefined): string | undefined {
  return code && AIRPORTS[code] ? code : undefined;
}

/**
 * Pull an origin/destination pair out of free text (feed titles, tweets).
 *
 * Preference order — directional cues beat positional guessing, because feed
 * headlines routinely mention a third airport first ("LAX fans: NYC to Paris
 * CDG from $340") and naive first-two pairing inverts or fabricates routes:
 *   1. explicit adjacency:  "JFK to LHR", "JFK → LHR", "JFK-LHR"
 *   2. from/to keywords:    "from Boston BOS ... to Paris CDG"
 *   3. fallback:            first two distinct dictionary-valid codes
 * All candidates are validated against the airport dictionary, which removes
 * noise words ("USA", "NEW", "OCT") and metro codes ("NYC") without a
 * blacklist that drifts and swallows real airports.
 */
export function extractRoute(text: string): { origin?: string; destination?: string } {
  // 1) Adjacent pair joined by a direction word or arrow/dash.
  for (const m of text.matchAll(/\b([A-Z]{3})\s*(?:\s[tT][oO]\s|→|›|»|>|[-–—])\s*([A-Z]{3})\b/g)) {
    const o = valid(m[1]);
    const d = valid(m[2]);
    if (o && d && o !== d) return { origin: o, destination: d };
  }

  // 2) "from <City> XXX" / "to <City> YYY" keywords, allowing a few
  // capitalized city words between the keyword and the code.
  const fromM = text.match(/\b[Ff]rom[:\s]+(?:[A-Z][a-z.'-]+ ){0,3}([A-Z]{3})\b/);
  const toM = text.match(/\b[Tt]o[:\s]+(?:[A-Z][a-z.'-]+ ){0,3}([A-Z]{3})\b/);
  const fromCode = valid(fromM?.[1]);
  const toCode = valid(toM?.[1]);
  if (fromCode && toCode && fromCode !== toCode) return { origin: fromCode, destination: toCode };

  // 3) Positional fallback over dictionary-valid codes, honoring a single
  // resolved keyword side when we have one.
  const seen: string[] = [];
  for (const m of text.match(/\b[A-Z]{3}\b/g) ?? []) {
    if (!AIRPORTS[m] || seen.includes(m)) continue;
    seen.push(m);
  }
  if (toCode) {
    // Only trust an origin that appears BEFORE the "to ..." phrase — a code
    // after it is usually a second destination option or a bystander mention
    // ("to Rome FCO or Milan MXP" must not fabricate MXP→FCO).
    const toIdx = toM?.index ?? 0;
    const origin = seen.find((c) => c !== toCode && text.indexOf(c) < toIdx);
    return origin ? { origin, destination: toCode } : {};
  }
  if (fromCode) {
    // Mirror image: a destination must appear AFTER the "from ..." phrase.
    const fromIdx = fromM?.index ?? 0;
    const destination = seen.find((c) => c !== fromCode && text.indexOf(c) > fromIdx);
    return destination ? { origin: fromCode, destination } : {};
  }
  if (seen.length >= 2) return { origin: seen[0], destination: seen[1] };
  return {};
}

/**
 * Extract the fare from text that may contain several dollar amounts
 * (promo credits, fee callouts, price ranges). Strategy:
 *   - collect all amounts in a plausible-fare window ($80–$20,000; the floor
 *     excludes "$50 off"-style promo amounts)
 *   - prefer an amount announced by a fare keyword ("from $299", "only $340",
 *     "now $500")
 *   - otherwise take the lowest candidate (ranges like "$300-$400" quote the
 *     lead fare first/lowest)
 * Handles thousands separators: "$1,088" → 108800, "$12,345" → 1234500.
 */
export function extractPriceCents(text: string): number | undefined {
  const candidates: Array<{ dollars: number; keyworded: boolean }> = [];
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?!\d)/g)) {
    const dollars = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(dollars) || dollars < 80 || dollars > 20000) continue;
    // The keyword must start a word: without the boundary, "seat $800",
    // "Great $1,500" and "that $1,100" keyword-qualified via their 'at'
    // tails and beat the real fare. When the lookback window is truncated
    // mid-word its first characters can't be trusted as a word start, so ^
    // only counts when the window really begins at the text start.
    const start = Math.max(0, (m.index ?? 0) - 14);
    const before = text.slice(start, m.index ?? 0);
    const kw = start === 0
      ? /(?:^|\s)(from|for|only|at|just|now)\s*$/i
      : /\s(from|for|only|at|just|now)\s*$/i;
    candidates.push({ dollars, keyworded: kw.test(before) });
  }
  if (!candidates.length) return undefined;
  // Among keyworded candidates prefer the LOWEST (a promo amount that still
  // sneaks a keyword must not beat a cheaper genuine fare), falling back to
  // the lowest candidate overall.
  const keyworded = candidates.filter((c) => c.keyworded);
  const pool = keyworded.length ? keyworded : candidates;
  const pick = pool.reduce((a, b) => (a.dollars <= b.dollars ? a : b));
  return pick.dollars * 100;
}
