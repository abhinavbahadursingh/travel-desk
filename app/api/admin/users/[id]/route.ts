import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, canManageUsers } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { userUpdateSchema } from "@/lib/validators";
import {
  assertCanChangeSuperAdmin,
  validateManagerAssignment,
} from "@/lib/users";
import { recordAudit, notify } from "@/lib/audit";

export const PATCH = withApi(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const actor = await getCurrentUser();
    if (!canManageUsers(actor)) {
      throw new ApiError(403, "Only a super admin can change accounts.");
    }

    const parsed = userUpdateSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      throw new ApiError(400, "Invalid account update", {
        details: parsed.error.flatten(),
      });
    }
    const input = parsed.data;

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "Account not found");
    if (target.id === actor.id && input.active === false) {
      throw new ApiError(409, "You cannot deactivate your own account.");
    }
    if (target.id === actor.id && input.role && input.role !== actor.role) {
      throw new ApiError(
        409,
        "You cannot change your own role. Ask another super admin to do it.",
      );
    }

    try {
      const updated = await db.$transaction(async (tx) => {
        const manager =
          input.managerId !== undefined
            ? await validateManagerAssignment(tx, target.id, input.managerId)
            : undefined;

        const nextRole = input.role ?? target.role;
        const nextActive = input.active ?? target.active;
        await assertCanChangeSuperAdmin(tx, target, nextRole, nextActive);

        const losesApproverAccess =
          (nextActive === false || !["manager", "travel_admin", "super_admin"].includes(nextRole)) &&
          target.active;
        if (losesApproverAccess) {
          const pending = await tx.approval.count({
            where: { approverId: target.id, decision: "pending" },
          });
          if (pending > 0) {
            throw new ApiError(
              409,
              `${target.name} still has ${pending} pending approval${pending === 1 ? "" : "s"}. Reassign them before deactivating or changing their role.`,
            );
          }
        }

        const account = await tx.user.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.role !== undefined && { role: input.role }),
            ...(input.active !== undefined && { active: input.active }),
            ...(input.department !== undefined && {
              department: input.department,
            }),
            ...(input.slackUserId !== undefined && {
              slackUserId: input.slackUserId,
            }),
            ...(manager !== undefined && { managerId: manager?.id ?? null }),
            // Personal information
            ...(input.phone !== undefined && { phone: input.phone }),
            ...(input.alternatePhone !== undefined && {
              alternatePhone: input.alternatePhone,
            }),
            ...(input.personalEmail !== undefined && {
              personalEmail: input.personalEmail,
            }),
            ...(input.dateOfBirth !== undefined && { dateOfBirth: input.dateOfBirth }),
            ...(input.gender !== undefined && { gender: input.gender }),
            ...(input.address !== undefined && { address: input.address }),
            ...(input.city !== undefined && { city: input.city }),
            ...(input.state !== undefined && { state: input.state }),
            ...(input.country !== undefined && { country: input.country }),
            ...(input.pinCode !== undefined && { pinCode: input.pinCode }),
            ...(input.profilePicture !== undefined && {
              profilePicture: input.profilePicture,
            }),
            // Professional information
            ...(input.employeeId !== undefined && { employeeId: input.employeeId }),
            ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
            ...(input.designation !== undefined && {
              designation: input.designation,
            }),
            ...(input.employmentType !== undefined && {
              employmentType: input.employmentType,
            }),
            ...(input.joiningDate !== undefined && { joiningDate: input.joiningDate }),
            ...(input.officeLocation !== undefined && {
              officeLocation: input.officeLocation,
            }),
            ...(input.businessUnit !== undefined && {
              businessUnit: input.businessUnit,
            }),
            ...(input.costCentre !== undefined && { costCentre: input.costCentre }),
            ...(input.workLocation !== undefined && {
              workLocation: input.workLocation,
            }),
            // Sensitive — super admin only
            ...(input.passportDetails !== undefined && {
              passportDetails: input.passportDetails,
            }),
          },
        });

        // Revoke every active session whenever the target is deactivated or
        // their role actually changes. A session cookie minted under the
        // old authority must stop working immediately — not when it
        // expires. Still-active sessions keep working for cosmetic
        // changes (name, department, Slack id, manager reassignment).
        const deactivated = input.active === false && target.active;
        const roleChanged =
          input.role !== undefined && input.role !== target.role;
        if (deactivated || roleChanged) {
          await tx.session.updateMany({
            where: { userId: account.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        await recordAudit(tx, {
          actorId: actor.id,
          action: "user.updated",
          entityType: "User",
          entityId: account.id,
          summary: `${actor.name} updated ${account.name}'s account`,
          metadata: {
            changes: input,
            previousRole: target.role,
            previousActive: target.active,
            previousManagerId: target.managerId,
          },
        });
        if (account.id !== actor.id) {
          await notify(tx, {
            userId: account.id,
            type: "account_updated",
            title: "Your travel account was updated",
            body: `Role: ${account.role.replaceAll("_", " ")} · ${account.active ? "Active" : "Deactivated"}`,
            link: "/profile",
          });
        }
        return account;
      });
      return NextResponse.json(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ApiError(
          409,
          "That Slack user ID is already linked to another account.",
        );
      }
      throw error;
    }
  },
);
