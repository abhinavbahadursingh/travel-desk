import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildOperationalReport } from "@/lib/reports";
import { freshDb, loadSeededUsers, resetTripData, createTrip } from "../setup/test-db";

const db = freshDb();

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetTripData(db);
});

describe("reports.buildOperationalReport cost integrity", () => {
  it("excludes trips with unknown costs from numerical totals, counts them separately", async () => {
    const { employee } = await loadSeededUsers(db);

    // Three trips past submission: two known, one unknown.
    await createTrip(db, {
      requesterId: employee.id,
      status: "approved",
      estimatedCost: 10_000,
      estimateIsComplete: true,
    });
    await createTrip(db, {
      requesterId: employee.id,
      status: "booked",
      estimatedCost: 7_500,
      estimateIsComplete: true,
    });
    await createTrip(db, {
      requesterId: employee.id,
      status: "approved",
      estimatedCost: null,
      estimateIsComplete: false,
    });

    const report = await buildOperationalReport();
    expect(report.totals.trips).toBe(3);
    expect(report.totals.estimatedSpend).toBe(17_500);
    expect(report.totals.missingCosts).toBe(1);
    expect(report.totals.incompleteEstimates).toBe(1);
    expect(report.spendByCurrency["INR"]).toBe(17_500);
    expect(report.missingCostsByCurrency["INR"]).toBe(1);
  });

  it("treats a legacy zero-with-incomplete row as unknown, not zero", async () => {
    const { employee } = await loadSeededUsers(db);
    await createTrip(db, {
      requesterId: employee.id,
      status: "approved",
      estimatedCost: 0,
      estimateIsComplete: false,
    });
    const report = await buildOperationalReport();
    expect(report.totals.estimatedSpend).toBe(0);
    expect(report.totals.missingCosts).toBe(1);
  });

  it("keeps a real zero when estimateIsComplete is true", async () => {
    const { employee } = await loadSeededUsers(db);
    await createTrip(db, {
      requesterId: employee.id,
      status: "approved",
      estimatedCost: 0,
      estimateIsComplete: true,
    });
    const report = await buildOperationalReport();
    expect(report.totals.estimatedSpend).toBe(0);
    expect(report.totals.missingCosts).toBe(0);
  });

  it("ignores draft + rejected rows when building spend", async () => {
    const { employee } = await loadSeededUsers(db);
    await createTrip(db, {
      requesterId: employee.id,
      status: "draft",
      estimatedCost: 123,
      estimateIsComplete: true,
    });
    await createTrip(db, {
      requesterId: employee.id,
      status: "rejected",
      estimatedCost: 456,
      estimateIsComplete: true,
    });
    const report = await buildOperationalReport();
    expect(report.totals.estimatedSpend).toBe(0);
  });
});
