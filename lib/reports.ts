import { db } from "./db";

export type CurrencySpend = Record<string, number>;

export type OperationalReport = {
  generatedAt: string;
  totals: {
    trips: number;
    // Unknown-cost trips are EXCLUDED from numerical totals; see `missingCosts`
    // for the count of trips without a known estimate.
    estimatedSpend: number;
    // Count of trips whose estimated cost is unknown (NULL in storage OR an
    // historical 0 with estimateIsComplete=false). Kept separate so the UI can
    // disclose "N trips missing a total" without poisoning the sum.
    missingCosts: number;
    incompleteEstimates: number;
    rejected: number;
    pendingCancellations: number;
    pendingApprovals: number;
  };
  // Spend is broken out per currency on every grouping so the UI can display
  // an amount next to its own currency — never a mixed-currency sum, never a
  // slot where "unknown" has been quietly folded into "zero".
  spendByCurrency: CurrencySpend;
  missingCostsByCurrency: CurrencySpend;
  statusCounts: Record<string, number>;
  bookingStatusCounts: Record<string, number>;
  flagCounts: Record<string, number>;
  destinations: Array<{
    destination: string;
    trips: number;
    spendByCurrency: CurrencySpend;
    missingCosts: number;
  }>;
  employees: Array<{
    name: string;
    trips: number;
    spendByCurrency: CurrencySpend;
    missingCosts: number;
  }>;
  months: Array<{
    month: string;
    trips: number;
    spendByCurrency: CurrencySpend;
    missingCosts: number;
  }>;
};

// Aggregates live records only. No estimates are invented: a trip with an
// incomplete estimate still contributes its stored estimatedCost.
export async function buildOperationalReport(): Promise<OperationalReport> {
  const trips = await db.tripRequest.findMany({
    select: {
      id: true,
      requesterId: true,
      destination: true,
      status: true,
      departDate: true,
      estimatedCost: true,
      currency: true,
      estimateIsComplete: true,
      policyFlags: true,
      createdAt: true,
      requester: { select: { name: true } },
      bookings: { select: { status: true, kind: true } },
      approvals: { select: { decision: true } },
      cancellationRequests: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const statusCounts: Record<string, number> = {};
  const bookingStatusCounts: Record<string, number> = {};
  const flagCounts: Record<string, number> = {};
  type Bucket = { trips: number; spendByCurrency: CurrencySpend; missingCosts: number };
  const destinationCounts = new Map<string, Bucket>();
  const employeeCounts = new Map<string, Bucket>();
  const monthCounts = new Map<string, Bucket>();
  const spendByCurrency: CurrencySpend = {};
  const missingCostsByCurrency: CurrencySpend = {};
  let estimatedSpend = 0;
  let incompleteEstimates = 0;
  let missingCosts = 0;
  let rejected = 0;

  const addSpend = (bucket: Bucket, currency: string, amount: number) => {
    bucket.spendByCurrency[currency] =
      (bucket.spendByCurrency[currency] ?? 0) + amount;
  };

  // A trip's cost is "known" when the estimate is marked complete AND the
  // stored value is a finite non-null number. This catches both new NULL rows
  // and historical rows where `estimatedCost` was coerced to 0 while
  // `estimateIsComplete` was false — both represent "we don't know" and MUST
  // be excluded from numerical totals.
  const costOf = (t: (typeof trips)[number]): number | null => {
    if (!t.estimateIsComplete) return null;
    if (t.estimatedCost == null) return null;
    if (!Number.isFinite(t.estimatedCost)) return null;
    return t.estimatedCost;
  };

  for (const trip of trips) {
    statusCounts[trip.status] = (statusCounts[trip.status] ?? 0) + 1;
    if (!trip.estimateIsComplete) incompleteEstimates += 1;
    if (trip.status === "rejected") rejected += 1;

    const spendApplies = !["draft", "rejected"].includes(trip.status);
    const currency = trip.currency || "USD";
    const known = costOf(trip);
    const isMissing = spendApplies && known == null;
    if (isMissing) {
      missingCosts += 1;
      missingCostsByCurrency[currency] =
        (missingCostsByCurrency[currency] ?? 0) + 1;
    }
    if (spendApplies && known != null) {
      estimatedSpend += known;
      spendByCurrency[currency] = (spendByCurrency[currency] ?? 0) + known;
    }

    const destination =
      destinationCounts.get(trip.destination) ??
      { trips: 0, spendByCurrency: {}, missingCosts: 0 };
    destination.trips += 1;
    if (spendApplies && known != null) addSpend(destination, currency, known);
    if (isMissing) destination.missingCosts += 1;
    destinationCounts.set(trip.destination, destination);

    const employee =
      employeeCounts.get(trip.requester.name) ??
      { trips: 0, spendByCurrency: {}, missingCosts: 0 };
    employee.trips += 1;
    if (spendApplies && known != null) addSpend(employee, currency, known);
    if (isMissing) employee.missingCosts += 1;
    employeeCounts.set(trip.requester.name, employee);

    const month = trip.departDate.toISOString().slice(0, 7);
    const monthEntry =
      monthCounts.get(month) ?? { trips: 0, spendByCurrency: {}, missingCosts: 0 };
    monthEntry.trips += 1;
    if (spendApplies && known != null) addSpend(monthEntry, currency, known);
    if (isMissing) monthEntry.missingCosts += 1;
    monthCounts.set(month, monthEntry);

    for (const booking of trip.bookings) {
      bookingStatusCounts[booking.status] = (bookingStatusCounts[booking.status] ?? 0) + 1;
    }
    try {
      const flags = JSON.parse(trip.policyFlags) as string[];
      for (const flag of flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
    } catch {
      // Ignore malformed legacy flags in the aggregate.
    }
  }

  const pendingCancellations = await db.cancellationRequest.count({
    where: { status: "pending" },
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      trips: trips.length,
      estimatedSpend,
      missingCosts,
      incompleteEstimates,
      rejected,
      pendingCancellations,
      pendingApprovals: trips.filter((t) =>
        t.approvals.some((a) => a.decision === "pending"),
      ).length,
    },
    statusCounts,
    bookingStatusCounts,
    flagCounts,
    spendByCurrency,
    missingCostsByCurrency,
    destinations: [...destinationCounts.entries()]
      .map(([destination, value]) => ({ destination, ...value }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 20),
    employees: [...employeeCounts.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 50),
    months: [...monthCounts.entries()]
      .map(([month, value]) => ({ month, ...value }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
