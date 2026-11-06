import { db } from "./db";

export type HealthCheck = {
  name: string;
  status: "ok" | "warn" | "fail" | "optional";
  detail: string;
};

export type SystemHealth = {
  status: "ok" | "attention" | "degraded";
  databaseOk: boolean;
  generatedAt: string;
  checks: HealthCheck[];
  metrics: {
    users: Array<{ role: string; active: boolean; count: number }>;
    activeApprovers: number;
    pendingApprovals: number;
    stuckApprovals: number;
    pendingCancellations: number;
    pendingConfirmations: number;
    incompleteEstimates: number;
    unreadNotifications: number;
  };
};

export async function buildSystemHealth(): Promise<SystemHealth> {
  const checks: HealthCheck[] = [];
  let databaseOk = true;
  try {
    await db.user.count();
    const provider =
      process.env.DATABASE_URL?.startsWith("postgres") ? "PostgreSQL" : "SQLite";
    checks.push({
      name: "Database",
      status: "ok",
      detail: `${provider} connection is responding.`,
    });
  } catch (error) {
    databaseOk = false;
    checks.push({
      name: "Database",
      status: "fail",
      detail: error instanceof Error ? error.message : "Database query failed.",
    });
  }

  const [
    policy,
    users,
    activeApprovers,
    pendingApprovals,
    stuckApprovals,
    pendingCancellations,
    pendingConfirmations,
    incompleteEstimates,
    unreadNotifications,
  ] = await Promise.all([
    db.travelPolicy.findUnique({ where: { name: "default" } }),
    db.user.groupBy({ by: ["role", "active"], _count: { _all: true } }),
    db.user.count({
      where: {
        active: true,
        role: { in: ["manager", "travel_admin", "super_admin"] },
      },
    }),
    db.approval.count({ where: { decision: "pending" } }),
    db.approval.count({
      where: { decision: "pending", tripRequest: { status: { not: "pending_approval" } } },
    }),
    db.cancellationRequest.count({ where: { status: "pending" } }),
    db.booking.count({
      where: { status: { in: ["pending", "link_only"] } },
    }),
    db.tripRequest.count({ where: { status: "approved", estimateIsComplete: false } }),
    db.notification.count({ where: { readAt: null } }),
  ]);

  checks.push(
    policy
      ? { name: "Travel policy", status: "ok", detail: `Default policy in ${policy.currency}.` }
      : { name: "Travel policy", status: "fail", detail: "No default policy is configured." },
  );
  checks.push(
    activeApprovers > 0
      ? {
          name: "Approvers",
          status: "ok",
          detail: `${activeApprovers} active approver account(s).`,
        }
      : {
          name: "Approvers",
          status: "fail",
          detail: "No active manager, travel admin or super admin exists.",
        },
  );
  checks.push(
    stuckApprovals === 0
      ? {
          name: "Approval consistency",
          status: "ok",
          detail: "Every pending approval belongs to a trip awaiting approval.",
        }
      : {
          name: "Approval consistency",
          status: "warn",
          detail: `${stuckApprovals} pending approval(s) point at a trip that is not pending approval.`,
        },
  );
  checks.push(
    process.env.DEV_USER_EMAIL
      ? { name: "Local identity", status: "ok", detail: "DEV_USER_EMAIL is configured." }
      : { name: "Local identity", status: "fail", detail: "DEV_USER_EMAIL is not configured." },
  );
  checks.push(
    process.env.GROQ_API_KEY
      ? { name: "Groq", status: "ok", detail: "GROQ_API_KEY is configured." }
      : { name: "Groq", status: "warn", detail: "GROQ_API_KEY is missing; AI planning is disabled." },
  );
  checks.push(
    process.env.TAVILY_API_KEY
      ? { name: "Tavily", status: "ok", detail: "TAVILY_API_KEY is configured." }
      : {
          name: "Tavily",
          status: "fail",
          detail: "TAVILY_API_KEY is missing; real travel search cannot run.",
        },
  );
  checks.push(
    process.env.GOOGLE_MAPS_API_KEY
      ? { name: "Google Maps", status: "ok", detail: "Optional cab routing key is configured." }
      : {
          name: "Google Maps",
          status: "optional",
          detail: "Optional cab routing key is not configured.",
        },
  );

  // Double-quoted identifiers so the query matches Prisma's generated
  // table names on both SQLite (case-sensitive by default here) and
  // PostgreSQL (unquoted identifiers are lowercased).
  const orphans = await db.$queryRaw<Array<{ approvals: number | bigint; bookings: number | bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM "Approval" a LEFT JOIN "TripRequest" t ON t.id = a."tripRequestId" WHERE t.id IS NULL) AS approvals,
      (SELECT COUNT(*) FROM "Booking" b LEFT JOIN "TripRequest" t ON t.id = b."tripRequestId" WHERE t.id IS NULL) AS bookings
  `;
  const orphanRow = orphans[0];
  const orphanCount = Number(orphanRow?.approvals ?? 0) + Number(orphanRow?.bookings ?? 0);
  checks.push(
    orphanCount === 0
      ? { name: "Referential integrity", status: "ok", detail: "No orphaned approvals or bookings." }
      : {
          name: "Referential integrity",
          status: "fail",
          detail: `${orphanCount} orphaned approval/booking row(s) found.`,
        },
  );

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");

  return {
    status: hasFail ? "degraded" : hasWarn ? "attention" : "ok",
    databaseOk,
    generatedAt: new Date().toISOString(),
    checks,
    metrics: {
      users: users.map((u) => ({
        role: u.role,
        active: u.active,
        count: u._count._all,
      })),
      activeApprovers,
      pendingApprovals,
      stuckApprovals,
      pendingCancellations,
      pendingConfirmations,
      incompleteEstimates,
      unreadNotifications,
    },
  };
}
