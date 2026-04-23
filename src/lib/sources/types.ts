export type PriceQuote = {
  origin: string;
  destination: string;
  priceCents: number;
  currency: string;
  cabin: "economy" | "premium_economy" | "business" | "first";
  carrier?: string;
  departAt?: Date;
  returnAt?: Date;
  source: "duffel" | "amadeus" | "demo";
  deepLink?: string;
};

export type DealSignal = {
  origin: string;
  destination: string;
  priceCents?: number;
  currency?: string;
  cabin?: string;
  headline: string;
  body?: string;
  sourceLabel: string; // display name (e.g. "@SecretFlying", "The Flight Deal")
  sourceUrl?: string;
  source: "curated" | "twitter";
  carrier?: string;
  seenAt?: Date;
  expiresAt?: Date;
  dedupeKey: string; // stable hash to prevent dupes
};
