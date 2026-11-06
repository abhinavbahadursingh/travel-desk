import { PrismaClient } from "@prisma/client";

// Idempotent remediation: rename legacy booking statuses to the canonical
// vocabulary from lib/booking.ts (Issue 1):
//   link_only          -> pending
//   manually_confirmed -> booked
//
// Only renames the status column. No rows are ever deleted. Safe to run
// multiple times. Confirmed/cancelled/not_required/failed rows are untouched.
//
// Run with: DATABASE_URL="file:./dev.db" npx tsx prisma/normalize-booking-states.ts

async function main() {
  const db = new PrismaClient();
  try {
    const linkOnly = await db.booking.updateMany({
      where: { status: "link_only" },
      data: { status: "pending" },
    });
    const confirmed = await db.booking.updateMany({
      where: { status: "manually_confirmed" },
      data: { status: "booked" },
    });
    console.log(
      `Renamed link_only→pending: ${linkOnly.count} rows; manually_confirmed→booked: ${confirmed.count} rows.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
