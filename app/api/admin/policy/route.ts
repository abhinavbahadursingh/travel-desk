import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getCurrentUser,
  canConfigurePolicy,
  canViewAllTrips,
} from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { policyUpdateSchema } from "@/lib/validators";
import { recordAudit } from "@/lib/audit";

export const GET = withApi(async () => {
  const user = await getCurrentUser();
  if (!canViewAllTrips(user)) {
    throw new ApiError(403, "Travel operations access is required.");
  }
  const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
  if (!policy) throw new ApiError(404, "No default policy is configured.");
  return NextResponse.json(policy);
});

export const PATCH = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!canConfigurePolicy(user)) {
    throw new ApiError(403, "Only a super admin can change travel policy.");
  }
  const parsed = policyUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(400, "Invalid policy update", {
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  const existing = await db.travelPolicy.findUnique({ where: { name: "default" } });
  if (!existing) throw new ApiError(404, "No default policy is configured.");

  const updated = await db.$transaction(async (tx) => {
    const policy = await tx.travelPolicy.update({
      where: { name: "default" },
      data: {
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.maxFlightEconomy !== undefined && {
          maxFlightEconomy: input.maxFlightEconomy,
        }),
        ...(input.maxHotelPerNight !== undefined && {
          maxHotelPerNight: input.maxHotelPerNight,
        }),
        ...(input.maxTotalPerTrip !== undefined && {
          maxTotalPerTrip: input.maxTotalPerTrip,
        }),
        ...(input.requireApprovalAbove !== undefined && {
          requireApprovalAbove: input.requireApprovalAbove,
        }),
        ...(input.advancePurchaseDays !== undefined && {
          advancePurchaseDays: input.advancePurchaseDays,
        }),
        ...(input.allowedCabins !== undefined && {
          allowedCabins: JSON.stringify(input.allowedCabins),
        }),
        ...(input.allowAutoApprovalForNonEmployees !== undefined && {
          allowAutoApprovalForNonEmployees:
            input.allowAutoApprovalForNonEmployees,
        }),
        ...(input.requireBookingReference !== undefined && {
          requireBookingReference: input.requireBookingReference,
        }),
        ...(input.cancellationRequiresAdminReview !== undefined && {
          cancellationRequiresAdminReview:
            input.cancellationRequiresAdminReview,
        }),
      },
    });
    await recordAudit(tx, {
      actorId: user.id,
      action: "policy.updated",
      entityType: "TravelPolicy",
      entityId: policy.id,
      summary: `${user.name} updated the company travel policy`,
      metadata: { changes: input },
    });
    return policy;
  });

  return NextResponse.json(updated);
});
