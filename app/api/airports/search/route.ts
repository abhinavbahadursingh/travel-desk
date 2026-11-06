import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withApi } from "@/lib/api";
import { searchAirports } from "@/lib/airports";

// GET /api/airports/search?q=del
// Returns airports whose IATA / name / city / country match the query. Pure
// local search over the bundled dataset — no external calls, no fabrication.

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

// Simple in-memory response cache. The underlying dataset never changes at
// runtime, so normalized queries can be memoized across requests.
const RESPONSE_CACHE = new Map<string, unknown>();
const CACHE_MAX_ENTRIES = 500;

export const GET = withApi(async (req: NextRequest) => {
  await getCurrentUser();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [], source: "ourairports-mwgg" });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { results: [], error: "query is too long" },
      { status: 400 },
    );
  }

  const key = q.toLowerCase();
  const cached = RESPONSE_CACHE.get(key);
  if (cached) return NextResponse.json(cached);

  const hits = searchAirports(q, 8);
  const body = {
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
    })),
    source: "ourairports-mwgg" as const,
    retrievedAt: new Date().toISOString(),
  };

  if (RESPONSE_CACHE.size >= CACHE_MAX_ENTRIES) {
    const firstKey = RESPONSE_CACHE.keys().next().value;
    if (firstKey !== undefined) RESPONSE_CACHE.delete(firstKey);
  }
  RESPONSE_CACHE.set(key, body);
  return NextResponse.json(body);
});
