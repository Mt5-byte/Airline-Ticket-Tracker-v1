// Curated top ~30 routes polled by the worker. Tuned for global coverage across
// US domestic, transatlantic, transpacific, and a few hub-to-hub corridors.

export const CURATED_ROUTES: Array<[string, string]> = [
  // US domestic
  ["JFK", "LAX"],
  ["JFK", "SFO"],
  ["SFO", "JFK"],
  ["ORD", "LAX"],
  ["DFW", "LAX"],
  ["ATL", "LAX"],
  ["SEA", "JFK"],
  ["BOS", "LAX"],
  ["LAX", "HNL"],
  ["JFK", "MIA"],

  // Transatlantic
  ["JFK", "LHR"],
  ["JFK", "CDG"],
  ["JFK", "AMS"],
  ["BOS", "LHR"],
  ["SFO", "LHR"],
  ["LAX", "LHR"],
  ["JFK", "FCO"],
  ["JFK", "MAD"],
  ["JFK", "BCN"],
  ["ORD", "FRA"],

  // Transpacific + Asia
  ["LAX", "NRT"],
  ["SFO", "HND"],
  ["SFO", "ICN"],
  ["LAX", "SIN"],
  ["LAX", "SYD"],
  ["SFO", "HKG"],
  ["JFK", "DXB"],

  // Latin America
  ["MIA", "GRU"],
  ["LAX", "MEX"],
  ["JFK", "CUN"],

  // Hub-to-hub
  ["LHR", "DXB"],
  ["LHR", "SIN"],
];
