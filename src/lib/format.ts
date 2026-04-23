export function formatPriceCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatPct(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "" : ""}${n.toFixed(digits)}%`;
}

export function formatDateRange(from?: Date | null, to?: Date | null) {
  if (!from) return "—";
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return to ? `${fmt(from)} → ${fmt(to)}` : fmt(from);
}

export function timeAgo(d: Date | string | number): string {
  const t = typeof d === "object" ? d.getTime() : new Date(d).getTime();
  const seconds = Math.max(1, Math.floor((Date.now() - t) / 1000));
  const units: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Infinity, "y"],
  ];
  let val = seconds;
  let unit = "s";
  for (let i = 0; i < units.length; i++) {
    const [step, label] = units[i];
    if (val < step) {
      unit = label;
      break;
    }
    val = val / step;
    unit = units[i + 1]?.[1] ?? label;
  }
  return `${Math.floor(val)}${unit} ago`;
}
