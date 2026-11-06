import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, readJson, withApi } from "@/lib/api";
import { travelPreferencePatchSchema } from "@/lib/validators";
import { recordAudit } from "@/lib/audit";

/** PATCH /api/profile/travel-preferences — update travel preferences + emergency contact. */
export const PATCH = withApi(async (req: NextRequest) => {
  const user = await getCurrentUser();
  const parsed = travelPreferencePatchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new ApiError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid travel preferences",
    );
  }

  try {
    const updated = await db.travelPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...(parsed.data),
      },
      update: parsed.data,
      select: {
        id: true,
        preferredSeat: true,
        preferredMeal: true,
        preferredAirline: true,
        preferredHotelCategory: true,
        preferredHotelChain: true,
        preferredTravelClass: true,
        frequentFlyerNumbers: true,
        hotelLoyaltyMembership: true,
        emergencyContactName: true,
        emergencyContactNumber: true,
        emergencyContactRelationship: true,
      },
    });

    await recordAudit(db, {
      actorId: user.id,
      action: "travel_preference.updated",
      entityType: "TravelPreference",
      entityId: updated.id,
      summary: `${user.name} updated travel preferences`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    throw error;
  }
});
