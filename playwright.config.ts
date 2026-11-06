import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Playwright owns its own webServer that boots Next.js against the isolated
// prisma/test.db. The global-setup script (shared with Vitest) provisions
// that DB — see tests/setup/global-setup.ts.
//
// The dev server is bound to port 3100 so it never collides with `npm run
// dev` on 3000, and NEXT_DIST_DIR points at a scratch build directory to keep
// Next's route manifest separate from the main dev server's.

const TEST_DB_URL = `file:${path.resolve(__dirname, "prisma/test.db")}`;
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    // The dev server is driven through Next directly so Playwright can reuse
    // its route manifest and skip the full build step. NEXT_DIST_DIR keeps
    // the compiled assets out of the main `.next` so a parallel `npm run
    // dev` on port 3000 is unaffected.
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_DB_URL,
      NEXT_DIST_DIR: ".next-e2e",
      ALLOW_DEV_IDENTITY: "1",
      DEV_USER_EMAIL: process.env.DEV_USER_EMAIL ?? "employee@test.local",
      // Make sure no external provider is hit by accident.
      GROQ_API_KEY: "",
      TAVILY_API_KEY: "",
      GOOGLE_MAPS_API_KEY: "",
      SLACK_SIGNING_SECRET: "",
    },
  },
});
