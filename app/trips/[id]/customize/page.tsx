import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, canViewAllTrips } from "@/lib/auth";
import type { Candidate } from "@/lib/search";
import { findNearbyAirports } from "@/lib/airports";
import { tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import {
  computeBudget,
  emptySelections,
  parseStoredSelections,
  splitFlightsByEligibility,
  type TripSelections,
} from "@/lib/selections";
import { CustomizeWizard } from "./CustomizeWizard";

type Itinerary = {
  flights?: { candidates?: Candidate[] };
  trains?: { candidates?: Candidate[] };
  hotels?: { candidates?: Candidate[] };
  cabs?: { candidates?: Candidate[] };
};

export default async function CustomizePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const trip = await db.tripRequest.findUnique({ where: { id } });
  if (!trip) return notFound();
  if (trip.requesterId !== user.id && !canViewAllTrips(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Forbidden</p>
        <p className="mt-1 text-sm text-slate-500">
          You don&apos;t have access to this trip request.
        </p>
      </div>
    );
  }
  if (trip.status !== "draft") {
    // Customization is draft-only. Anything further and we send the user
    // back to the detail page where the trip's current state is explained.
    redirect(`/trips/${trip.id}`);
  }
  if (!trip.itinerary) {
    redirect(`/trips/${trip.id}`);
  }

  const itinerary = JSON.parse(trip.itinerary) as Itinerary;
  const currency = trip.currency || tripCurrency(trip.origin, trip.destination);
  const nights = tripNights(trip.departDate, trip.returnDate);
  const selections: TripSelections =
    parseStoredSelections(trip.selections) ?? emptySelections();
  const budget = computeBudget(selections, trip.itinerary, { currency, nights });

  // Only flights with a real identity + route go into the Flight Selection
  // list. Everything else (missing route, missing airline, wrong origin
  // or destination, completeness=insufficient) is kept as source evidence
  // behind a disclosure, never as a selectable option.
  const { selectable: selectableFlights, sourceOnly: sourceOnlyFlights } =
    splitFlightsByEligibility(
      itinerary.flights?.candidates ?? [],
      trip.originAirportCode,
      trip.destinationAirportCode,
      { isRoundTrip: trip.returnDate != null },
    );

  // When no selectable flight exists for the exact route, surface nearby
  // alternatives from the bundled dataset so the user can see which airports
  // might work instead. We never swap the user's trip — the wizard just
  // shows the suggestion with name + IATA + distance. Changing the airport
  // is explicit and done elsewhere.
  const nearbyAlts =
    selectableFlights.length === 0
      ? {
          origin: trip.originAirportCode
            ? findNearbyAirports(trip.originAirportCode, {
                limit: 4,
                commercialOnly: true,
              }).map((a) => ({
                iata: a.iata,
                name: a.name,
                city: a.city,
                country: a.country,
                distanceKm: a.distanceKm ?? null,
              }))
            : [],
          destination: trip.destinationAirportCode
            ? findNearbyAirports(trip.destinationAirportCode, {
                limit: 4,
                commercialOnly: true,
              }).map((a) => ({
                iata: a.iata,
                name: a.name,
                city: a.city,
                country: a.country,
                distanceKm: a.distanceKm ?? null,
              }))
            : [],
        }
      : { origin: [], destination: [] };

  // Freshness: how long ago the planner last fetched the itinerary. The
  // wizard shows a "stale" chip past 6h; it does not block selection.
  const retrievedAtIso = trip.itineraryRetrievedAt
    ? trip.itineraryRetrievedAt.toISOString()
    : null;

  return (
    <CustomizeWizard
      tripId={trip.id}
      tripSummary={{
        origin: trip.origin,
        destination: trip.destination,
        originIata: trip.originAirportCode,
        destinationIata: trip.destinationAirportCode,
        departDate: trip.departDate.toISOString(),
        returnDate: trip.returnDate ? trip.returnDate.toISOString() : null,
        currency,
        nights,
        itineraryRetrievedAt: retrievedAtIso,
      }}
      itinerary={{
        flights: selectableFlights,
        flightsSourceOnly: sourceOnlyFlights,
        flightNearbyAlternatives: nearbyAlts,
        trains: itinerary.trains?.candidates ?? [],
        hotels: itinerary.hotels?.candidates ?? [],
        cabs: itinerary.cabs?.candidates ?? [],
      }}
      initialSelections={selections}
      initialBudget={budget}
    />
  );
}
