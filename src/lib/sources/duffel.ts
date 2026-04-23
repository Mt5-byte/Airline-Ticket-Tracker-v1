import type { PriceQuote } from "./types";

const BASE = "https://api.duffel.com";
const VERSION = "v2";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Query Duffel for the cheapest one-way offer ~30 days out.
 * Duffel docs: https://duffel.com/docs/api/offer-requests
 */
export async function fetchDuffelQuote(
  origin: string,
  destination: string,
  signal?: AbortSignal,
): Promise<PriceQuote | null> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return null;

  const body = {
    data: {
      slices: [
        { origin, destination, departure_date: daysFromNow(30) },
      ],
      passengers: [{ type: "adult" }],
      cabin_class: "economy",
    },
  };

  const res = await fetch(`${BASE}/air/offer_requests?return_offers=true&supplier_timeout=10000`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Duffel-Version": VERSION,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    console.warn(`[duffel] ${origin}->${destination} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  const offers: any[] = json?.data?.offers ?? [];
  if (!offers.length) return null;

  const cheapest = offers.reduce((a, b) =>
    Number(a.total_amount) <= Number(b.total_amount) ? a : b,
  );
  const amount = Number(cheapest.total_amount);
  const currency: string = cheapest.total_currency ?? "USD";
  const carrier = cheapest?.owner?.iata_code ?? cheapest?.owner?.name;
  const segment = cheapest?.slices?.[0]?.segments?.[0];
  const departAt = segment?.departing_at ? new Date(segment.departing_at) : undefined;

  return {
    origin,
    destination,
    priceCents: Math.round(amount * 100),
    currency,
    cabin: "economy",
    carrier,
    departAt,
    source: "duffel",
  };
}
