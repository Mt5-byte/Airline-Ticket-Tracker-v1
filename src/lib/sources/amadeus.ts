import type { PriceQuote } from "./types";

type TokenCache = { token: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;
// In-flight dedup: the first tick fires one quote request per route
// concurrently; without this, every one of them would kick off its own OAuth
// token request (thundering herd against the auth endpoint).
let tokenInFlight: Promise<string | null> | null = null;

function baseUrl() {
  return process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
}

async function requestToken(signal?: AbortSignal): Promise<string | null> {
  const id = process.env.AMADEUS_CLIENT_ID;
  const secret = process.env.AMADEUS_CLIENT_SECRET;
  if (!id || !secret) return null;

  const res = await fetch(`${baseUrl()}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
    signal,
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000,
  };
  return tokenCache.token;
}

async function getToken(signal?: AbortSignal): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  if (!tokenInFlight) {
    tokenInFlight = requestToken(signal).finally(() => {
      tokenInFlight = null;
    });
  }
  return tokenInFlight;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Amadeus Flight Offers Search (v2).
 * https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search
 */
export async function fetchAmadeusQuote(
  origin: string,
  destination: string,
  signal?: AbortSignal,
): Promise<PriceQuote | null> {
  const token = await getToken(signal);
  if (!token) return null;

  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate: daysFromNow(30),
    adults: "1",
    currencyCode: "USD",
    max: "5",
    nonStop: "false",
  });

  const res = await fetch(`${baseUrl()}/v2/shopping/flight-offers?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    console.warn(`[amadeus] ${origin}->${destination} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  const offers: any[] = json?.data ?? [];
  if (!offers.length) return null;

  const cheapest = offers.reduce((a, b) =>
    Number(a.price.total) <= Number(b.price.total) ? a : b,
  );
  const amount = Number(cheapest.price.total);
  const currency: string = cheapest.price.currency ?? "USD";
  const segment = cheapest.itineraries?.[0]?.segments?.[0];
  const carrier = segment?.carrierCode;
  const departAt = segment?.departure?.at ? new Date(segment.departure.at) : undefined;

  return {
    origin,
    destination,
    priceCents: Math.round(amount * 100),
    currency,
    cabin: "economy",
    carrier,
    departAt,
    source: "amadeus",
  };
}
