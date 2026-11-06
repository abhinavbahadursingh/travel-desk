import { PrismaClient } from "@prisma/client";

// Idempotent remediation script.
//
// Marks every Approval row where approver = requester as isLegacy=true so the
// application never treats it as a valid independent approval. Historical
// records are preserved; the only fields that change are `isLegacy` on rows
// that currently have it false. Safe to run multiple times. No rows are ever
// deleted.
//
// Run with:  DATABASE_URL="file:./dev.db" npx tsx prisma/mark-legacy-self-approvals.ts

async function main() {
  const db = new PrismaClient();
  try {
    const offenders = await db.approval.findMany({
      where: { isLegacy: false },
      include: { tripRequest: { select: { requesterId: true, destination: true } } },
    });
    const selfApprovals = offenders.filter(
      (a) => a.approverId === a.tripRequest.requesterId,
    );
    if (selfApprovals.length === 0) {
      console.log("No unflagged self-approvals found.");
      return;
    }
    for (const row of selfApprovals) {
      await db.approval.update({
        where: { id: row.id },
        data: { isLegacy: true },
      });
      console.log(
        `Flagged approval ${row.id} (approver = requester for trip to ${row.tripRequest.destination}) as legacy.`,
      );
    }
    console.log(`Done. Flagged ${selfApprovals.length} record(s) as legacy.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
