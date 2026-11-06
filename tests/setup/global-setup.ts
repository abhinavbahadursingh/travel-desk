// One-shot test-DB provisioner. Runs once per `vitest run` (and per Playwright
// webServer start when `TEST_E2E=1`). Creates an isolated SQLite file at
// `prisma/test.db`, applies the real Prisma schema with `prisma db push`, and
// seeds the minimum rows every test suite expects:
//   - the "default" travel policy (same shape as `prisma/seed.ts`),
//   - one active user per role (employee, manager, travel_admin, super_admin),
//     with the employee reporting into the manager.
//
// The real `prisma/dev.db` is NEVER touched — this script explicitly checks the
// resolved `DATABASE_URL` points at `test.db` before opening the client.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const REPO_ROOT = path.resolve(__dirname, "../..");
const TEST_DB_PATH = path.join(REPO_ROOT, "prisma", "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Tests that resolve the current user via the auth helpers need
// ALLOW_DEV_IDENTITY=1 + DEV_USER_EMAIL=<address>. Tests set the email per
// scenario; this is the default so getCurrentUser can locate a row during
// setup.
export const TEST_USERS = {
  employee: {
    email: "employee@test.local",
    name: "Eva Employee",
    role: "employee" as const,
    department: "Engineering",
  },
  manager: {
    email: "manager@test.local",
    name: "Mia Manager",
    role: "manager" as const,
    department: "Engineering",
  },
  travelAdmin: {
    email: "ops@test.local",
    name: "Oliver Ops",
    role: "travel_admin" as const,
    department: "Travel",
  },
  superAdmin: {
    email: "root@test.local",
    name: "Sam Super",
    role: "super_admin" as const,
    department: "Travel",
  },
};

export async function setup() {
  // Hard guard: never operate on the real dev DB.
  if (!TEST_DB_URL.endsWith("test.db")) {
    throw new Error(
      `Refusing to run test setup against a non-test DB: ${TEST_DB_URL}`,
    );
  }
  process.env.DATABASE_URL = TEST_DB_URL;
  // Exposed so tests can opt in to the dev-identity fallback without faking
  // cookies. Individual tests still set DEV_USER_EMAIL per scenario.
  process.env.ALLOW_DEV_IDENTITY = "1";
  // The AI, Slack and search layers must never hit the network during tests.
  process.env.GROQ_API_KEY = "";
  process.env.TAVILY_API_KEY = "";
  process.env.GOOGLE_MAPS_API_KEY = "";
  process.env.SLACK_SIGNING_SECRET = "";

  mkdirSync(path.join(REPO_ROOT, "prisma"), { recursive: true });
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH, { force: true });
  }
  if (existsSync(TEST_DB_PATH + "-journal")) {
    rmSync(TEST_DB_PATH + "-journal", { force: true });
  }

  // Apply the real schema to the fresh test file. Prisma reads DATABASE_URL
  // from the environment we set above; --skip-generate avoids rebuilding the
  // client (already built for the main app).
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });

  const db = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  try {
    await db.travelPolicy.upsert({
      where: { name: "default" },
      update: {},
      create: {
        name: "default",
        currency: "INR",
        maxFlightEconomy: 100_000,
        maxHotelPerNight: 25_000,
        maxTotalPerTrip: 332_000,
        requireApprovalAbove: 124_500,
        advancePurchaseDays: 7,
        allowedCabins: JSON.stringify(["economy", "premium_economy"]),
      },
    });

    // Create manager first so the employee can reference it.
    const manager = await db.user.upsert({
      where: { email: TEST_USERS.manager.email },
      update: { active: true },
      create: {
        email: TEST_USERS.manager.email,
        name: TEST_USERS.manager.name,
        role: TEST_USERS.manager.role,
        department: TEST_USERS.manager.department,
        active: true,
        mustSetPassword: false,
      },
    });
    await db.user.upsert({
      where: { email: TEST_USERS.employee.email },
      update: { active: true, managerId: manager.id },
      create: {
        email: TEST_USERS.employee.email,
        name: TEST_USERS.employee.name,
        role: TEST_USERS.employee.role,
        department: TEST_USERS.employee.department,
        active: true,
        mustSetPassword: false,
        managerId: manager.id,
      },
    });
    await db.user.upsert({
      where: { email: TEST_USERS.travelAdmin.email },
      update: { active: true },
      create: {
        email: TEST_USERS.travelAdmin.email,
        name: TEST_USERS.travelAdmin.name,
        role: TEST_USERS.travelAdmin.role,
        department: TEST_USERS.travelAdmin.department,
        active: true,
        mustSetPassword: false,
      },
    });
    await db.user.upsert({
      where: { email: TEST_USERS.superAdmin.email },
      update: { active: true },
      create: {
        email: TEST_USERS.superAdmin.email,
        name: TEST_USERS.superAdmin.name,
        role: TEST_USERS.superAdmin.role,
        department: TEST_USERS.superAdmin.department,
        active: true,
        mustSetPassword: false,
      },
    });
  } finally {
    await db.$disconnect();
  }
}

export async function teardown() {
  // Keep the file for post-mortem inspection by the user; just drop the WAL
  // artefacts. Operators can delete the file by hand or re-run the setup.
  if (existsSync(TEST_DB_PATH + "-journal")) {
    rmSync(TEST_DB_PATH + "-journal", { force: true });
  }
}

// Allow `npm run test:db:setup` to run this directly.
if (require.main === module) {
  setup()
    .then(() => {
      console.log(`Test DB ready at ${TEST_DB_PATH}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
