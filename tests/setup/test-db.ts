// Per-test DB helpers. Each test file calls `freshDb()` to get a short-lived
// PrismaClient bound to the isolated `prisma/test.db` file, and `resetTrips()`
// (or a specific `wipe*` helper) in a `beforeEach` to keep tests independent
// without destroying the seeded users / policy.

import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { TEST_USERS } from "./global-setup";

export { TEST_USERS };

const TEST_DB_URL = `file:${path.resolve(__dirname, "../../prisma/test.db")}`;

// Guard: if someone imports this module before global-setup set DATABASE_URL
// for their worker, we set it ourselves rather than silently binding Prisma
// to the dev DB.
if (!process.env.DATABASE_URL?.endsWith("test.db")) {
  process.env.DATABASE_URL = TEST_DB_URL;
}

export function freshDb(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
}

// Delete every row that a test can create. Users and policy are seeded by
// global-setup and must survive.
export async function resetTripData(db: PrismaClient): Promise<void> {
  // Order matters — children first because of onDelete: Restrict.
  await db.approvalEvent.deleteMany();
  await db.approval.deleteMany();
  await db.cancellationRequest.deleteMany();
  await db.booking.deleteMany();
  await db.tripRequest.deleteMany();
  await db.notification.deleteMany();
  await db.notificationDelivery.deleteMany();
  await db.auditLog.deleteMany();
  await db.session.deleteMany();
}

export type SeededUsers = {
  employee: Awaited<ReturnType<PrismaClient["user"]["findUniqueOrThrow"]>>;
  manager: Awaited<ReturnType<PrismaClient["user"]["findUniqueOrThrow"]>>;
  travelAdmin: Awaited<ReturnType<PrismaClient["user"]["findUniqueOrThrow"]>>;
  superAdmin: Awaited<ReturnType<PrismaClient["user"]["findUniqueOrThrow"]>>;
};

export async function loadSeededUsers(db: PrismaClient): Promise<SeededUsers> {
  const [employee, manager, travelAdmin, superAdmin] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: TEST_USERS.employee.email } }),
    db.user.findUniqueOrThrow({ where: { email: TEST_USERS.manager.email } }),
    db.user.findUniqueOrThrow({ where: { email: TEST_USERS.travelAdmin.email } }),
    db.user.findUniqueOrThrow({ where: { email: TEST_USERS.superAdmin.email } }),
  ]);
  return { employee, manager, travelAdmin, superAdmin };
}

export async function createTrip(
  db: PrismaClient,
  overrides: Partial<Parameters<PrismaClient["tripRequest"]["create"]>[0]["data"]> & {
    requesterId: string;
  },
) {
  const { requesterId, ...rest } = overrides;
  return db.tripRequest.create({
    data: {
      purpose: "Conference in Bengaluru",
      origin: "Mumbai",
      destination: "Bengaluru",
      departDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      returnDate: new Date(Date.now() + 33 * 24 * 60 * 60 * 1000),
      cabin: "economy",
      status: "draft",
      currency: "INR",
      estimatedCost: null,
      estimateIsComplete: false,
      ...rest,
      requesterId,
    },
  });
}
