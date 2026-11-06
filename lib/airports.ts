// In-memory airport search over the bundled OurAirports-derived dataset.
//
// The JSON at data/airports.json is built from the public-domain mwgg/Airports
// snapshot (see scripts/fetch-airports.ts). It is loaded once per server
// process and indexed by IATA code and by lowercase tokens drawn from airport
// name, city, country and IATA. Every result that leaves this module is a real
// row from that dataset — no synthesis.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Airport = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  type: "international" | "domestic" | "regional";
};

export type AirportHit = Airport & {
  distanceKm?: number;
  score: number;
};

let cache: {
  rows: Airport[];
  byIata: Map<string, Airport>;
  byCityKey: Map<string, Airport[]>; // "newdelhi" → list
  tokenIndex: Map<string, Set<number>>; // token → row indices
} | null = null;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(airport: Airport): string[] {
  const source = `${airport.name} ${airport.city} ${airport.country} ${airport.iata}`;
  return normalize(source).split(" ").filter(Boolean);
}

function loadDataset(): typeof cache {
  const file = resolve(process.cwd(), "data/airports.json");
  const rows = JSON.parse(readFileSync(file, "utf-8")) as Airport[];
  const byIata = new Map<string, Airport>();
  const byCityKey = new Map<string, Airport[]>();
  const tokenIndex = new Map<string, Set<number>>();

  rows.forEach((row, i) => {
    byIata.set(row.iata, row);
    const cityKey = normalize(row.city).replace(/\s+/g, "");
    const existing = byCityKey.get(cityKey) ?? [];
    existing.push(row);
    byCityKey.set(cityKey, existing);
    for (const token of tokensOf(row)) {
      let bucket = tokenIndex.get(token);
      if (!bucket) {
        bucket = new Set();
        tokenIndex.set(token, bucket);
      }
      bucket.add(i);
    }
  });
  return { rows, byIata, byCityKey, tokenIndex };
}

function ensure() {
  if (!cache) cache = loadDataset();
  return cache!;
}

export function getByIata(code: string): Airport | null {
  return ensure().byIata.get(code.toUpperCase()) ?? null;
}

// ─────────────────────────── Haversine ───────────────────────────
const EARTH_RADIUS_KM = 6371;
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// ─────────────────────── commercial relevance ───────────────────────
// Larger international hubs should rank above regional airstrips when both
// match a query. The dataset doesn't carry schedule data, so we derive a
// rough prior from the airport type (name-heuristic) and a short list of
// high-traffic city keys that survives independent of that heuristic.

const MAJOR_HUB_CITY_KEYS = new Set<string>([
  "newdelhi", "delhi", "mumbai", "bengaluru", "bangalore", "chennai", "kolkata",
  "hyderabad", "london", "paris", "frankfurt", "amsterdam", "madrid", "rome",
  "istanbul", "dubai", "doha", "singapore", "hongkong", "tokyo", "seoul",
  "beijing", "shanghai", "bangkok", "kualalumpur", "sydney", "melbourne",
  "losangeles", "sanfrancisco", "newyork", "chicago", "atlanta", "dallas",
  "miami", "toronto", "vancouver", "mexicocity", "saopaulo", "buenosaires",
  "johannesburg", "cairo", "riyadh", "jeddah", "zurich", "munich", "vienna",
  "copenhagen", "stockholm", "oslo", "helsinki", "moscow",
]);

function commercialPrior(airport: Airport): number {
  let score = 0;
  if (airport.type === "international") score += 2;
  else if (airport.type === "domestic") score += 1;
  const cityKey = normalize(airport.city).replace(/\s+/g, "");
  if (MAJOR_HUB_CITY_KEYS.has(cityKey)) score += 3;
  return score;
}

// ───────────────────────── search by query ─────────────────────────

const STOPWORDS = new Set(["international", "airport", "intl", "the"]);

function tokenSearch(q: string, limit: number): AirportHit[] {
  const { rows, tokenIndex } = ensure();
  const tokens = q.split(" ").filter((t) => t && !STOPWORDS.has(t));
  if (tokens.length === 0) return [];

  // Candidate set = union of rows matching any token prefix. Prefix scan the
  // token index instead of linearly scanning every airport, since the index
  // keys are already lowercase tokens.
  const candidateCounts = new Map<number, number>();
  const prefixTokens = new Set<string>();

  for (const token of tokens) {
    for (const key of tokenIndex.keys()) {
      if (key.startsWith(token)) {
        prefixTokens.add(key);
      }
    }
  }

  for (const key of prefixTokens) {
    const bucket = tokenIndex.get(key);
    if (!bucket) continue;
    for (const idx of bucket) {
      candidateCounts.set(idx, (candidateCounts.get(idx) ?? 0) + 1);
    }
  }

  const hits: AirportHit[] = [];
  for (const [idx, count] of candidateCounts) {
    const airport = rows[idx];
    let score = count * 10;
    // Exact IATA match in multi-token query (e.g. "DEL Delhi").
    if (tokens.includes(airport.iata.toLowerCase())) score += 50;
    // Full-string match in a field.
    const nameN = normalize(airport.name);
    const cityN = normalize(airport.city);
    if (nameN.startsWith(q)) score += 40;
    if (cityN === q) score += 60;
    if (cityN.startsWith(q)) score += 30;
    score += commercialPrior(airport);
    hits.push({ ...airport, score });
  }

  hits.sort((a, b) => b.score - a.score || a.iata.localeCompare(b.iata));
  return hits.slice(0, limit);
}

export function searchAirports(query: string, limit = 8): AirportHit[] {
  const { byIata } = ensure();
  const q = normalize(query);
  if (!q) return [];

  // IATA exact match: short-circuit to the top, then pad with token hits.
  if (q.length === 3) {
    const direct = byIata.get(q.toUpperCase());
    if (direct) {
      const rest = tokenSearch(q, Math.max(0, limit - 1)).filter(
        (hit) => hit.iata !== direct.iata,
      );
      return [{ ...direct, score: 1000 }, ...rest.slice(0, limit - 1)];
    }
  }

  return tokenSearch(q, limit);
}

// ─────────────────── nearest airports to a coordinate ───────────────────

export function airportsNear(
  lat: number,
  lon: number,
  limit = 8,
  maxKm = 400,
): AirportHit[] {
  const { rows } = ensure();
  const hits: AirportHit[] = [];
  for (const airport of rows) {
    const d = distanceKm({ lat, lon }, airport);
    if (d > maxKm) continue;
    const score = -d + commercialPrior(airport) * 5;
    hits.push({ ...airport, distanceKm: d, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
      a.iata.localeCompare(b.iata),
  );
  return hits.slice(0, limit);
}

// Nearest airports for a city name. Returns null if the city cannot be
// resolved from the dataset alone; callers should then geocode the city via
// an upstream provider and pass the coordinates to airportsNear.
export function airportsForCity(cityName: string, limit = 8): AirportHit[] | null {
  const { byCityKey } = ensure();
  const key = normalize(cityName).replace(/\s+/g, "");
  const seedList = byCityKey.get(key);
  if (!seedList || seedList.length === 0) return null;
  // Use the busiest-looking airport in that city as the anchor coordinate,
  // then widen to nearby airports so multi-airport cities (London, NYC) are
  // all represented.
  seedList.sort((a, b) => commercialPrior(b) - commercialPrior(a));
  const anchor = seedList[0];
  const nearby = airportsNear(anchor.lat, anchor.lon, limit, 120);
  // Include every airport physically within the anchor's metro (≤120km) that
  // shares the city name, even if a token-noise filter dropped it earlier.
  // Same-named cities on other continents (London, KY vs London, UK) must stay
  // out — they have real, large distances and shouldn't be treated as nearby.
  const seen = new Set(nearby.map((h) => h.iata));
  for (const row of seedList) {
    if (seen.has(row.iata)) continue;
    const d = distanceKm(anchor, row);
    if (d > 120) continue;
    nearby.push({
      ...row,
      distanceKm: d,
      score: 500 + commercialPrior(row) - d,
    });
  }
  nearby.sort(
    (a, b) =>
      b.score - a.score ||
      (a.distanceKm ?? 0) - (b.distanceKm ?? 0) ||
      a.iata.localeCompare(b.iata),
  );
  return nearby.slice(0, limit);
}

// Nearby commercial airports given an IATA anchor. Resolves the IATA to its
// coordinates, delegates to airportsNear, and drops the self IATA from the
// result. Returns an empty array when the IATA is unknown — never falls back
// to a guess. Use this to offer alternatives in UIs like the Flight empty
// state without mutating the user's selected airport.
export function findNearbyAirports(
  iata: string,
  opts: { limit?: number; maxKm?: number; commercialOnly?: boolean } = {},
): AirportHit[] {
  const anchor = getByIata(iata);
  if (!anchor) return [];
  const limit = opts.limit ?? 5;
  // Fetch a widened list so we can drop the self entry and still return
  // `limit` neighbours, then apply the optional commercial-only filter.
  const candidates = airportsNear(
    anchor.lat,
    anchor.lon,
    limit + 4,
    opts.maxKm ?? 400,
  ).filter((h) => h.iata !== anchor.iata);
  const filtered = opts.commercialOnly
    ? candidates.filter((h) => h.type === "international" || h.type === "domestic")
    : candidates;
  return filtered.slice(0, limit);
}

export function datasetSize(): number {
  return ensure().rows.length;
}
