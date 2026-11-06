import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getCurrentUser,
  canManageUsers,
  canAssignManagers,
} from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { userCreateSchema } from "@/lib/validators";
import { validateManagerAssignment } from "@/lib/users";
import { recordAudit, notify } from "@/lib/audit";

export const GET = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!canAssignManagers(user)) {
    throw new ApiError(403, "Travel operations or super admin access is required.");
  }
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const role = url.searchParams.get("role");
  const active = url.searchParams.get("active");

  const users = await db.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { department: { contains: q } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      department: true,
      managerId: true,
      manager: { select: { id: true, name: true, email: true, role: true } },
      createdAt: true,
      _count: { select: { requests: true, reports: true, approvals: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(users);
});

export const POST = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!canManageUsers(user)) {
    throw new ApiError(403, "Only a super admin can create accounts.");
  }

  const parsed = userCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Invalid account details", {
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  try {
    const created = await db.$transaction(async (tx) => {
      const manager = await validateManagerAssignment(tx, null, input.managerId ?? null);
      const account = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          active: input.active,
          department: input.department ?? null,
          managerId: manager?.id ?? null,
          slackUserId: input.slackUserId ?? null,
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        action: "user.created",
        entityType: "User",
        entityId: account.id,
        summary: `${user.name} created ${account.name} (${account.role})`,
        metadata: {
          email: account.email,
          role: account.role,
          department: account.department,
          managerId: account.managerId,
        },
      });
      await notify(tx, {
        userId: account.id,
        type: "account_created",
        title: "Travel account created",
        body: `A super admin created your travel account with the ${account.role.replaceAll("_", " ")} role.`,
        link: "/profile",
      });
      return account;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(
        409,
        "An account with that email or Slack user ID already exists.",
      );
    }
    throw error;
  }
});
