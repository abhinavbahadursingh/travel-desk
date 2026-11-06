import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withApi } from "@/lib/api";
import { airportsForCity, airportsNear } from "@/lib/airports";

// GET /api/airports/nearby?city=Ghaziabad
// GET /api/airports/nearby?lat=28.6&lon=77.2
//
// Falls back to Open-Meteo geocoding when a city name is not found inside the
// bundled airport dataset's own city column, so places like "Ghaziabad" that
// have no local airport can still return nearby airports via lat/lon.

const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const MAX_QUERY_LENGTH = 100;

async function geocodeCity(
  name: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{ latitude?: number; longitude?: number }>;
    };
    const first = json.results?.[0];
    if (
      !first ||
      typeof first.latitude !== "number" ||
      typeof first.longitude !== "number"
    ) {
      return null;
    }
    return { latitude: first.latitude, longitude: first.longitude };
  } catch {
    return null;
  }
}

export const GET = withApi(async (req: NextRequest) => {
  await getCurrentUser();
  const params = req.nextUrl.searchParams;
  const city = (params.get("city") ?? "").trim().replace(/\s+/g, " ");
  const latParam = params.get("lat");
  const lonParam = params.get("lon");

  // Coordinate path.
  if (latParam && lonParam) {
    const lat = Number(latParam);
    const lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { results: [], error: "invalid coordinates" },
        { status: 400 },
      );
    }
    const hits = airportsNear(lat, lon, 8);
    return NextResponse.json({
      results: hits.map((h) => ({
        iata: h.iata,
        icao: h.icao,
        name: h.name,
        city: h.city,
        country: h.country,
        countryCode: h.countryCode,
        latitude: h.lat,
        longitude: h.lon,
        type: h.type,
        distanceKm: h.distanceKm != null ? Math.round(h.distanceKm) : null,
      })),
      source: "ourairports-mwgg",
      retrievedAt: new Date().toISOString(),
    });
  }

  // City path.
  if (!city) {
    return NextResponse.json(
      { results: [], error: "missing city or lat/lon" },
      { status: 400 },
    );
  }
  if (city.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { results: [], error: "query is too long" },
      { status: 400 },
    );
  }

  let hits = airportsForCity(city, 8);
  if (!hits) {
    const geocoded = await geocodeCity(city);
    if (!geocoded) {
      return NextResponse.json({
        results: [],
        source: "ourairports-mwgg",
        note: "city not found",
      });
    }
    hits = airportsNear(geocoded.latitude, geocoded.longitude, 8);
  }

  return NextResponse.json({
    results: hits.map((h) => ({
      iata: h.iata,
      icao: h.icao,
      name: h.name,
      city: h.city,
      country: h.country,
      countryCode: h.countryCode,
      latitude: h.lat,
      longitude: h.lon,
      type: h.type,
      distanceKm: h.distanceKm != null ? Math.round(h.distanceKm) : null,
    })),
    source: "ourairports-mwgg",
    retrievedAt: new Date().toISOString(),
  });
});
