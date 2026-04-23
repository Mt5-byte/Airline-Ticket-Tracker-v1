// Small curated IATA airport dictionary. Expand freely — used for display labels
// and for validating user-entered routes.

export type Airport = {
  iata: string;
  city: string;
  country: string;
  name: string;
};

export const AIRPORTS: Record<string, Airport> = {
  JFK: { iata: "JFK", city: "New York", country: "USA", name: "John F. Kennedy Intl" },
  EWR: { iata: "EWR", city: "Newark", country: "USA", name: "Newark Liberty Intl" },
  LGA: { iata: "LGA", city: "New York", country: "USA", name: "LaGuardia" },
  BOS: { iata: "BOS", city: "Boston", country: "USA", name: "Logan Intl" },
  IAD: { iata: "IAD", city: "Washington", country: "USA", name: "Dulles Intl" },
  DCA: { iata: "DCA", city: "Washington", country: "USA", name: "Reagan National" },
  MIA: { iata: "MIA", city: "Miami", country: "USA", name: "Miami Intl" },
  MCO: { iata: "MCO", city: "Orlando", country: "USA", name: "Orlando Intl" },
  ATL: { iata: "ATL", city: "Atlanta", country: "USA", name: "Hartsfield-Jackson" },
  ORD: { iata: "ORD", city: "Chicago", country: "USA", name: "O'Hare Intl" },
  DFW: { iata: "DFW", city: "Dallas", country: "USA", name: "Dallas/Fort Worth" },
  DEN: { iata: "DEN", city: "Denver", country: "USA", name: "Denver Intl" },
  SEA: { iata: "SEA", city: "Seattle", country: "USA", name: "Seattle-Tacoma" },
  SFO: { iata: "SFO", city: "San Francisco", country: "USA", name: "San Francisco Intl" },
  LAX: { iata: "LAX", city: "Los Angeles", country: "USA", name: "Los Angeles Intl" },
  SAN: { iata: "SAN", city: "San Diego", country: "USA", name: "San Diego Intl" },
  LAS: { iata: "LAS", city: "Las Vegas", country: "USA", name: "Harry Reid Intl" },
  PHX: { iata: "PHX", city: "Phoenix", country: "USA", name: "Sky Harbor" },
  HNL: { iata: "HNL", city: "Honolulu", country: "USA", name: "Daniel K. Inouye" },
  YYZ: { iata: "YYZ", city: "Toronto", country: "Canada", name: "Pearson Intl" },
  YVR: { iata: "YVR", city: "Vancouver", country: "Canada", name: "Vancouver Intl" },
  MEX: { iata: "MEX", city: "Mexico City", country: "Mexico", name: "Benito Juárez Intl" },
  CUN: { iata: "CUN", city: "Cancún", country: "Mexico", name: "Cancún Intl" },
  GRU: { iata: "GRU", city: "São Paulo", country: "Brazil", name: "Guarulhos Intl" },
  EZE: { iata: "EZE", city: "Buenos Aires", country: "Argentina", name: "Ministro Pistarini" },
  BOG: { iata: "BOG", city: "Bogotá", country: "Colombia", name: "El Dorado" },
  LIM: { iata: "LIM", city: "Lima", country: "Peru", name: "Jorge Chávez" },
  LHR: { iata: "LHR", city: "London", country: "UK", name: "Heathrow" },
  LGW: { iata: "LGW", city: "London", country: "UK", name: "Gatwick" },
  CDG: { iata: "CDG", city: "Paris", country: "France", name: "Charles de Gaulle" },
  ORY: { iata: "ORY", city: "Paris", country: "France", name: "Orly" },
  AMS: { iata: "AMS", city: "Amsterdam", country: "Netherlands", name: "Schiphol" },
  FRA: { iata: "FRA", city: "Frankfurt", country: "Germany", name: "Frankfurt Main" },
  MUC: { iata: "MUC", city: "Munich", country: "Germany", name: "Munich Intl" },
  MAD: { iata: "MAD", city: "Madrid", country: "Spain", name: "Barajas" },
  BCN: { iata: "BCN", city: "Barcelona", country: "Spain", name: "El Prat" },
  FCO: { iata: "FCO", city: "Rome", country: "Italy", name: "Fiumicino" },
  MXP: { iata: "MXP", city: "Milan", country: "Italy", name: "Malpensa" },
  ZRH: { iata: "ZRH", city: "Zurich", country: "Switzerland", name: "Zurich" },
  VIE: { iata: "VIE", city: "Vienna", country: "Austria", name: "Schwechat" },
  CPH: { iata: "CPH", city: "Copenhagen", country: "Denmark", name: "Kastrup" },
  ARN: { iata: "ARN", city: "Stockholm", country: "Sweden", name: "Arlanda" },
  IST: { iata: "IST", city: "Istanbul", country: "Turkey", name: "Istanbul" },
  DXB: { iata: "DXB", city: "Dubai", country: "UAE", name: "Dubai Intl" },
  DOH: { iata: "DOH", city: "Doha", country: "Qatar", name: "Hamad Intl" },
  CAI: { iata: "CAI", city: "Cairo", country: "Egypt", name: "Cairo Intl" },
  JNB: { iata: "JNB", city: "Johannesburg", country: "South Africa", name: "O.R. Tambo" },
  CPT: { iata: "CPT", city: "Cape Town", country: "South Africa", name: "Cape Town Intl" },
  DEL: { iata: "DEL", city: "Delhi", country: "India", name: "Indira Gandhi Intl" },
  BOM: { iata: "BOM", city: "Mumbai", country: "India", name: "Chhatrapati Shivaji" },
  BKK: { iata: "BKK", city: "Bangkok", country: "Thailand", name: "Suvarnabhumi" },
  SIN: { iata: "SIN", city: "Singapore", country: "Singapore", name: "Changi" },
  KUL: { iata: "KUL", city: "Kuala Lumpur", country: "Malaysia", name: "KLIA" },
  HKG: { iata: "HKG", city: "Hong Kong", country: "Hong Kong", name: "Chek Lap Kok" },
  TPE: { iata: "TPE", city: "Taipei", country: "Taiwan", name: "Taoyuan" },
  NRT: { iata: "NRT", city: "Tokyo", country: "Japan", name: "Narita" },
  HND: { iata: "HND", city: "Tokyo", country: "Japan", name: "Haneda" },
  ICN: { iata: "ICN", city: "Seoul", country: "South Korea", name: "Incheon" },
  PEK: { iata: "PEK", city: "Beijing", country: "China", name: "Capital Intl" },
  PVG: { iata: "PVG", city: "Shanghai", country: "China", name: "Pudong Intl" },
  SYD: { iata: "SYD", city: "Sydney", country: "Australia", name: "Kingsford Smith" },
  MEL: { iata: "MEL", city: "Melbourne", country: "Australia", name: "Tullamarine" },
  AKL: { iata: "AKL", city: "Auckland", country: "New Zealand", name: "Auckland Intl" },
};

export function lookupAirport(iata: string): Airport | null {
  return AIRPORTS[iata.toUpperCase()] ?? null;
}

export function airportLabel(iata: string): string {
  const a = AIRPORTS[iata.toUpperCase()];
  return a ? `${a.city} (${a.iata})` : iata.toUpperCase();
}

export function isValidIata(code: string): boolean {
  return /^[A-Z]{3}$/.test(code.toUpperCase());
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<[number, Airport]> = [];
  for (const a of Object.values(AIRPORTS)) {
    const hay = `${a.iata} ${a.city} ${a.country} ${a.name}`.toLowerCase();
    if (!hay.includes(q)) continue;
    let score = 0;
    if (a.iata.toLowerCase() === q) score += 100;
    if (a.iata.toLowerCase().startsWith(q)) score += 40;
    if (a.city.toLowerCase().startsWith(q)) score += 30;
    if (hay.startsWith(q)) score += 10;
    score += 10 - Math.min(10, hay.indexOf(q));
    scored.push([score, a]);
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([, a]) => a);
}
