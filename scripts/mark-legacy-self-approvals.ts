import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main(): Promise<void> {
  const superAdmin = await db.user.findFirst({
    where: { role: "super_admin", active: true },
  });

  const approvals = await db.approval.findMany({
    include: {
      tripRequest: { select: { requesterId: true, destination: true } },
    },
  });

  let marked = 0;
  for (const approval of approvals) {
    if (approval.approverId === approval.tripRequest.requesterId) {
      await db.approval.update({
        where: { id: approval.id },
        data: { isLegacy: true },
      });
      await db.auditLog.create({
        data: {
          actorId: superAdmin?.id ?? null,
          action: "approval.legacy_marked",
          entityType: "Approval",
          entityId: approval.id,
          summary:
            "Legacy self-approval flagged: " +
            approval.approverId +
            " approved their own trip to " +
            approval.tripRequest.destination,
          metadata: JSON.stringify({
            tripRequestId: approval.tripRequestId,
            approverId: approval.approverId,
            requesterId: approval.tripRequest.requesterId,
          }),
        },
      });
      marked += 1;
    }
  }

  console.log("Marked " + marked + " legacy self-approval(s).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
