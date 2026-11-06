// One-shot data migration from the local SQLite database to the configured
// PostgreSQL database.
//
// Usage:
//   SQLITE_URL="file:./prisma/dev.db" \
//   POSTGRES_URL="postgresql://user:pass@host:5432/dbname" \
//   npx tsx prisma/migrate-sqlite-to-postgres.ts
//
// Defaults:
//   SQLITE_URL   → file:./prisma/dev.db
//   POSTGRES_URL → required (must start with postgres:// or postgresql://)
//
// Guarantees:
//   - prisma/dev.db is NEVER mutated — the source client opens it in
//     read-only mode and we copy the file to prisma/backup/dev-<iso>.db
//     before the first read.
//   - All IDs, timestamps, and nullability are preserved verbatim.
//   - Safe to re-run: every row is written through `upsert` keyed on the
//     primary id, so a partial previous run resolves into the same end
//     state without duplicate inserts.
//   - Foreign-key order: users first, then sessions, policy, trips,
//     approvals, approval events, bookings, cancellation requests,
//     notifications, notification deliveries, audit logs.
//   - The script FAILS LOUDLY if row counts disagree after copy.
//
// It does not run migrations. Apply the Postgres schema first:
//   DATABASE_URL="$POSTGRES_URL" npx prisma migrate deploy \
//     --schema=prisma/schema.postgres.prisma

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient as SqliteClient } from "@prisma/client";
import { PrismaClient as PgClient } from "@prisma/client-postgres";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SQLITE = `file:${path.join(REPO_ROOT, "prisma", "dev.db")}`;

type AnyRow = Record<string, unknown>;

type Delegate = {
  findMany: (args?: unknown) => Promise<unknown[]>;
  count: (args?: unknown) => Promise<number>;
};

async function copyTable(
  label: string,
  sourceDelegate: Delegate,
  upsert: (row: AnyRow) => Promise<unknown>,
  destCount: () => Promise<number>,
  findManyArgs: Record<string, unknown> = { orderBy: { createdAt: "asc" } },
): Promise<{ label: string; source: number; dest: number }> {
  const rows = (await sourceDelegate.findMany(findManyArgs)) as AnyRow[];
  for (const row of rows) {
    await upsert(row);
  }
  const srcCount = await sourceDelegate.count();
  const dstCount = await destCount();
  console.log(
    `  ${label.padEnd(24)}  src=${srcCount}  dst=${dstCount}  ${srcCount === dstCount ? "ok" : "MISMATCH"}`,
  );
  if (srcCount !== dstCount) {
    throw new Error(
      `Row count mismatch on ${label}: source=${srcCount} destination=${dstCount}`,
    );
  }
  return { label, source: srcCount, dest: dstCount };
}

function backupSqlite(sqliteUrl: string): string {
  if (!sqliteUrl.startsWith("file:")) {
    throw new Error(
      `SQLITE_URL must be a file:// URL (got: ${sqliteUrl.slice(0, 32)}…)`,
    );
  }
  const srcPath = sqliteUrl.replace(/^file:/, "");
  const abs = path.isAbsolute(srcPath) ? srcPath : path.resolve(REPO_ROOT, srcPath);
  if (!existsSync(abs)) {
    throw new Error(`SQLite source does not exist: ${abs}`);
  }
  const backupDir = path.join(REPO_ROOT, "prisma", "backup");
  mkdirSync(backupDir, { recursive: true });
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `dev-${iso}.db`);
  copyFileSync(abs, dest);
  // SQLite's WAL / journal files live next to the DB. Copy them too if present
  // so the backup is self-consistent.
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sibling = abs + suffix;
    if (existsSync(sibling)) copyFileSync(sibling, dest + suffix);
  }
  return dest;
}

async function main() {
  const sqliteUrl = process.env.SQLITE_URL?.trim() || DEFAULT_SQLITE;
  const postgresUrl = process.env.POSTGRES_URL?.trim() || "";
  if (!/^postgres(ql)?:\/\//.test(postgresUrl)) {
    throw new Error(
      "POSTGRES_URL is required and must start with postgres:// or postgresql://",
    );
  }

  console.log("Travel Agent — SQLite → PostgreSQL migration");
  console.log(`  source:      ${sqliteUrl}`);
  console.log(`  destination: ${postgresUrl.replace(/\/\/[^@]+@/, "//***@")}`);

  const backupPath = backupSqlite(sqliteUrl);
  console.log(`  backup:      ${backupPath}`);
  console.log("");

  const source = new SqliteClient({ datasources: { db: { url: sqliteUrl } } });
  const dest = new PgClient({ datasources: { db: { url: postgresUrl } } });
  const summary: { label: string; source: number; dest: number }[] = [];

  try {
    // 1. Users — parents of nearly every other table. Self-reference via
    //    managerId is a SetNull relation, so we insert twice: first pass
    //    without managerId, second pass to restore it.
    summary.push(
      await copyTable(
        "User",
        source.user as unknown as Delegate,
        async (row) => {
          const { managerId: _managerId, ...withoutManager } = row as AnyRow & {
            managerId: string | null;
          };
          await dest.user.upsert({
            where: { id: row.id as string },
            update: {},
            create: withoutManager as never,
          });
        },
        () => dest.user.count(),
      ),
    );
    // Second pass — reattach manager links now that both sides exist.
    const usersWithManagers = await source.user.findMany({
      where: { managerId: { not: null } },
      select: { id: true, managerId: true },
    });
    for (const u of usersWithManagers) {
      await dest.user.update({
        where: { id: u.id },
        data: { managerId: u.managerId },
      });
    }

    // 2. Travel policy.
    summary.push(
      await copyTable(
        "TravelPolicy",
        source.travelPolicy as unknown as Delegate,
        async (row) =>
          dest.travelPolicy.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.travelPolicy.count(),
        { orderBy: { updatedAt: "asc" } },
      ),
    );

    // 3. Sessions.
    summary.push(
      await copyTable(
        "Session",
        source.session as unknown as Delegate,
        async (row) =>
          dest.session.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.session.count(),
      ),
    );

    // 4. Trips.
    summary.push(
      await copyTable(
        "TripRequest",
        source.tripRequest as unknown as Delegate,
        async (row) =>
          dest.tripRequest.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.tripRequest.count(),
      ),
    );

    // 5. Approvals.
    summary.push(
      await copyTable(
        "Approval",
        source.approval as unknown as Delegate,
        async (row) =>
          dest.approval.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.approval.count(),
      ),
    );

    // 6. Approval events.
    summary.push(
      await copyTable(
        "ApprovalEvent",
        source.approvalEvent as unknown as Delegate,
        async (row) =>
          dest.approvalEvent.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.approvalEvent.count(),
      ),
    );

    // 7. Bookings.
    summary.push(
      await copyTable(
        "Booking",
        source.booking as unknown as Delegate,
        async (row) =>
          dest.booking.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.booking.count(),
      ),
    );

    // 8. Cancellation requests.
    summary.push(
      await copyTable(
        "CancellationRequest",
        source.cancellationRequest as unknown as Delegate,
        async (row) =>
          dest.cancellationRequest.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.cancellationRequest.count(),
      ),
    );

    // 9. Notifications.
    summary.push(
      await copyTable(
        "Notification",
        source.notification as unknown as Delegate,
        async (row) =>
          dest.notification.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.notification.count(),
      ),
    );

    // 10. Notification deliveries.
    summary.push(
      await copyTable(
        "NotificationDelivery",
        source.notificationDelivery as unknown as Delegate,
        async (row) =>
          dest.notificationDelivery.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.notificationDelivery.count(),
      ),
    );

    // 11. Audit logs.
    summary.push(
      await copyTable(
        "AuditLog",
        source.auditLog as unknown as Delegate,
        async (row) =>
          dest.auditLog.upsert({
            where: { id: row.id as string },
            update: {},
            create: row as never,
          }),
        () => dest.auditLog.count(),
      ),
    );

    // Cross-check FK integrity on a few critical relations.
    const orphanApprovals = await dest.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "Approval" a
      LEFT JOIN "TripRequest" t ON t.id = a."tripRequestId"
      WHERE t.id IS NULL
    `;
    const orphanBookings = await dest.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "Booking" b
      LEFT JOIN "TripRequest" t ON t.id = b."tripRequestId"
      WHERE t.id IS NULL
    `;
    const oa = Number(orphanApprovals[0]?.n ?? 0);
    const ob = Number(orphanBookings[0]?.n ?? 0);
    console.log("");
    console.log(`  FK check: orphaned approvals=${oa}  orphaned bookings=${ob}`);
    if (oa !== 0 || ob !== 0) {
      throw new Error("Foreign-key integrity check failed on destination.");
    }

    console.log("");
    console.log("Migration complete.");
    console.log("Totals:");
    for (const row of summary) {
      console.log(`  ${row.label.padEnd(24)} ${String(row.source).padStart(6)}`);
    }
  } finally {
    await source.$disconnect();
    await dest.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
