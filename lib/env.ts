// Production env-var guard.
//
// Runs on cold boot (imported by app/layout.tsx) to loudly fail when a
// production deployment is missing a secret we rely on, or has a dev-only
// flag turned on. In development the function is a no-op — the dev
// convenience flags are the whole point of local development.
//
// The function logs instead of throwing: a 500 from the root layout would
// serve a worse diagnostic than a clear server-log message at startup. Each
// check is a separate line so an operator can tell exactly what's wrong.

let alreadyChecked = false;

const REQUIRED_PROD_ENV = [
  // Prisma/SQLite: must be a real file:// (or postgres://) URL — never the
  // in-repo prisma/test.db that only tests should point at.
  "DATABASE_URL",
] as const;

export function assertProductionEnv(): void {
  if (alreadyChecked) return;
  alreadyChecked = true;
  if (process.env.NODE_ENV !== "production") return;

  const problems: string[] = [];

  for (const name of REQUIRED_PROD_ENV) {
    const value = process.env[name]?.trim();
    if (!value) {
      problems.push(`${name} is not set`);
    }
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (databaseUrl.endsWith("test.db")) {
    problems.push(
      "DATABASE_URL points at prisma/test.db — the test DB must never be used in production",
    );
  }

  if (process.env.ALLOW_DEV_IDENTITY === "1") {
    problems.push(
      "ALLOW_DEV_IDENTITY=1 is set in production — this flag is hard-disabled but should be removed from the environment",
    );
  }

  if (process.env.DEV_USER_EMAIL) {
    problems.push(
      "DEV_USER_EMAIL is set in production — remove it; the dev-identity fallback is disabled here anyway",
    );
  }

  if (problems.length > 0) {
    // One line per problem so operators can fix them in one pass.
    for (const p of problems) {
      console.error(`[env] production misconfiguration: ${p}`);
    }
  }
}
