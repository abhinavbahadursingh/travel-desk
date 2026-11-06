import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The suite is split into two projects so component tests get a browser-like
// DOM via jsdom while server-side/library tests run in pure Node (where
// Prisma, `node:crypto` and the `next/server` helpers behave).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // One shared global setup provisions the isolated test DB. It runs ONCE
    // per `vitest run` and never touches `prisma/dev.db`.
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Playwright specs live under tests/e2e and must never be collected by
    // Vitest — they call `test.describe` on the Playwright runner.
    exclude: ["**/node_modules/**", "**/.next/**", "tests/e2e/**"],
    pool: "forks",
    poolOptions: {
      // Serialise DB-touching tests: the tests that reset rows can race if
      // multiple worker threads hit the same SQLite file in parallel.
      forks: { singleFork: true },
    },
    setupFiles: ["./tests/setup/vitest-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "lib/**/*.ts",
        "app/api/**/*.ts",
        "components/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.d.ts", "**/types.ts"],
    },
    // Vitest 2.1 added `projects` at runtime but hasn't included it in
    // InlineConfig's types yet; cast through unknown to keep tsc happy while
    // still running the two environments at test time.
    ...({
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            include: [
              "tests/unit/**/*.test.ts",
              "tests/integration/**/*.test.ts",
              "tests/api/**/*.test.ts",
              "tests/security/**/*.test.ts",
            ],
          },
        },
        {
          extends: true,
          test: {
            name: "dom",
            environment: "jsdom",
            include: ["tests/components/**/*.test.{ts,tsx}"],
          },
        },
      ],
    } as Record<string, unknown>),
  },
});
