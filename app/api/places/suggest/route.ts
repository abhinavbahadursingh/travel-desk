import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withApi } from "@/lib/api";
import type { PlaceSuggestion } from "@/lib/places";

// Real place suggestions for the origin/destination inputs.
//
// Data comes from Open-Meteo's public geocoding API, which serves GeoNames
// records. Nothing here is generated or seeded: if the upstream lookup fails,
// the response carries an error and an empty list so the UI can stay honest.
//
// Contract:
//   GET /api/places/suggest?q=ber
//   200 { results: PlaceSuggestion[], source: "open-meteo", retrievedAt }
//   400 { results: [], error } when the query is too long
//   502/503 { results: [], error } when the upstream lookup fails

const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 6;

const CITY_FEATURE_CODES = new Set([
  "PPLC", // capital
  "PPLA", // admin seat
  "PPLA2",
  "PPLA3",
  "PPLA4",
  "PPLA5",
  "PPL",
  "PPLL",
  "PPLX",
]);
const AIRPORT_FEATURE_CODES = new Set(["AIRP"]);

type OpenMeteoResult = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  feature_code?: string;
  country_code?: string;
  country?: string;
  admin1?: string;
  population?: number;
};

function labelFor(name: string, admin1: string | null, country: string | null): string {
  const parts = [name];
  // Avoid "Berlin, State of Berlin, Germany".
  if (admin1 && !admin1.toLowerCase().includes(name.toLowerCase())) parts.push(admin1);
  if (country) parts.push(country);
  return parts.join(", ");
}

function toSuggestion(raw: OpenMeteoResult): PlaceSuggestion | null {
  const name = raw.name?.trim();
  const latitude = raw.latitude;
  const longitude = raw.longitude;
  if (!name || typeof latitude !== "number" || typeof longitude !== "number") return null;

  const feature = raw.feature_code ?? "";
  const kind = AIRPORT_FEATURE_CODES.has(feature)
    ? "airport"
    : CITY_FEATURE_CODES.has(feature)
      ? "city"
      : null;
  if (!kind) return null;

  const admin1 = raw.admin1?.trim() || null;
  const country = raw.country?.trim() || null;
  return {
    id: String(raw.id ?? `${latitude},${longitude},${name}`),
    name,
    label: labelFor(name, admin1, country),
    kind,
    country,
    countryCode: raw.country_code?.trim() || null,
    admin1,
    latitude,
    longitude,
    population: typeof raw.population === "number" ? raw.population : null,
  };
}

export const GET = withApi(async (req: NextRequest) => {
  await getCurrentUser();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [], source: "open-meteo" });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { results: [], error: "query is too long" },
      { status: 400 },
    );
  }

  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", q);
  url.searchParams.set("count", "20");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { results: [], error: "place lookup unavailable" },
        { status: 502 },
      );
    }

    const json = (await res.json()) as { results?: OpenMeteoResult[] };
    const seen = new Set<string>();
    const all: PlaceSuggestion[] = [];

    for (const raw of json.results ?? []) {
      const suggestion = toSuggestion(raw);
      if (!suggestion || seen.has(suggestion.id)) continue;
      seen.add(suggestion.id);
      all.push(suggestion);
    }

    // Fuzzy matches surface tiny villages for airport-code queries ("SFO" →
    // Sfodea, Sforzin). When the lookup already found a real city or airport,
    // keep only places that are plausible travel destinations.
    const hasStrongMatch = all.some(
      (place) => place.kind === "airport" || (place.population ?? 0) >= 50_000,
    );
    const ranked = hasStrongMatch
      ? all.filter(
          (place) => place.kind === "airport" || (place.population ?? 0) >= 10_000,
        )
      : all;

    return NextResponse.json({
      results: ranked.slice(0, MAX_RESULTS),
      source: "open-meteo",
      retrievedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { results: [], error: "place lookup unavailable" },
      { status: 503 },
    );
  }
});
