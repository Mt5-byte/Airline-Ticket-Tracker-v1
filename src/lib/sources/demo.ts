import type { PriceQuote } from "./types";

// Deterministic per-route baseline so the demo behaves like a real market:
// stable median with small wobble, and occasional "mistake fares" that dip hard.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function baselineCentsFor(origin: string, destination: string): number {
  const h = hash(`${origin}-${destination}`);
  // Rough distance-ish tiers
  const transatlantic = ["LHR", "CDG", "AMS", "FRA", "FCO", "MAD", "BCN", "MUC", "ZRH", "VIE", "CPH", "ARN", "IST", "MXP", "LGW", "ORY"];
  const transpacific = ["NRT", "HND", "ICN", "HKG", "SIN", "BKK", "SYD", "MEL", "AKL", "TPE", "PVG", "PEK", "KUL", "BOM", "DEL", "DXB", "DOH"];
  const latin = ["GRU", "EZE", "LIM", "BOG", "MEX", "CUN"];

  let base: number;
  if (transatlantic.includes(destination) || transatlantic.includes(origin)) base = 52000; // $520
  else if (transpacific.includes(destination) || transpacific.includes(origin)) base = 84000; // $840
  else if (latin.includes(destination) || latin.includes(origin)) base = 38000; // $380
  else base = 24000; // $240 domestic
  // Deterministic spread: ±20%
  const drift = ((h % 40) - 20) / 100; // -0.20..+0.20
  return Math.round(base * (1 + drift));
}

export function generateDemoQuote(origin: string, destination: string): PriceQuote {
  const base = baselineCentsFor(origin, destination);
  const now = Date.now();
  const seed = hash(`${origin}${destination}`);
  const phase = (seed % 1000) / 1000;

  // Smooth 30-minute wobble (±6%) + per-second noise (±8%) so that rapid-fire
  // polling and real-time polling both produce a realistic time series.
  const tSec = now / 1000;
  const wobble = Math.sin(tSec / 1800 + phase * Math.PI * 2) * 0.06;
  const noise = ((hash(`${seed}-${Math.floor(tSec)}`) % 200) - 100) / 1250;
  let price = base * (1 + wobble + noise);

  // ~5% chance per tick of a mistake fare (−35% to −55% off baseline).
  const roll = hash(`${seed}-dip-${Math.floor(tSec)}`) % 1000;
  if (roll < 50) {
    const drop = 0.35 + ((roll / 50) * 0.2);
    price = base * (1 - drop);
  }

  const departDays = 20 + (seed % 80);
  const departAt = new Date(now + departDays * 86_400_000);
  const carriers = ["AA", "DL", "UA", "BA", "AF", "LH", "KL", "JL", "NH", "EK", "QR", "SQ"];
  const carrier = carriers[seed % carriers.length];

  return {
    origin,
    destination,
    priceCents: Math.max(5000, Math.round(price)),
    currency: "USD",
    cabin: "economy",
    carrier,
    departAt,
    source: "demo",
  };
}
