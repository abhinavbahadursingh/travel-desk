import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, withApi } from "@/lib/api";
import { resolveApprover } from "@/lib/approvals";
import { recordAudit, notify } from "@/lib/audit";
import { kickOutboxProcessor } from "@/lib/notifications";
import { evaluate } from "@/lib/policy";
import { tripCurrency } from "@/lib/currency";
import { tripNights } from "@/lib/dates";

type ItineraryShape = {
  featured?: {
    flight?: { estimatedPrice?: number | null } | null;
    hotel?: { estimatedPrice?: number | null } | null;
  };
  estimatedTotal?: number | null;
};

function parseItinerary(raw: string | null): ItineraryShape {
  if (!raw) {
    throw new ApiError(409, "Plan the trip first — no itinerary has been generated.", {
      code: "ITINERARY_REQUIRED",
    });
  }
  try {
    return JSON.parse(raw) as ItineraryShape;
  } catch {
    throw new ApiError(
      409,
      "The stored itinerary is unreadable. Re-plan the trip before submitting.",
      { code: "ITINERARY_INVALID" },
    );
  }
}

export const POST = withApi(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const trip = await db.tripRequest.findUnique({
      where: { id },
      include: { requester: true, approvals: true },
    });
    if (!trip) throw new ApiError(404, "Trip not found");
    if (trip.requesterId !== user.id) {
      throw new ApiError(403, "Only the requester can submit this trip.");
    }

    // Idempotent submission: a repeated click returns the existing pending
    // approval instead of creating a second one or a misleading conflict.
    if (trip.status === "pending_approval") {
      const pending = trip.approvals.find((a) => a.decision === "pending");
      if (pending) {
        return NextResponse.json({
          trip,
          autoApproved: false,
          idempotent: true,
          pendingApprovalId: pending.id,
        });
      }
      throw new ApiError(
        409,
        "This trip is marked pending approval but has no pending approver. A super admin should reassign an approver.",
        { code: "PENDING_APPROVAL_MISSING" },
      );
    }

    if (trip.status !== "draft") {
      throw new ApiError(
        409,
        `This trip is already ${trip.status.replaceAll("_", " ")} and cannot be submitted again.`,
        { code: "INVALID_STATE" },
      );
    }

    // Personal trips are auto-approved on submit — no approver, no Approval
    // row, no policy gate. They go straight to "approved" so the requester can
    // proceed to booking links immediately.
    if (trip.tripType === "personal") {
      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.tripRequest.updateMany({
          where: { id, status: "draft" },
          data: {
            status: "approved",
            submittedAt: new Date(),
            decidedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new ApiError(
            409,
            "This trip was submitted by another request. Refresh and check its status.",
            { code: "SUBMISSION_RACE" },
          );
        }
        await recordAudit(tx, {
          actorId: user.id,
          action: "trip.auto_approved",
          entityType: "TripRequest",
          entityId: id,
          summary: `Personal trip to ${trip.destination} auto-approved (no approval required).`,
          metadata: { tripType: "personal", reason: trip.tripReason ?? null },
        });
        await notify(tx, {
          userId: user.id,
          type: "trip_approved",
          title: "Trip approved",
          body: `Your personal trip to ${trip.destination} has been approved. No approver is required for personal trips.`,
          link: `/trips/${id}`,
          entityType: "TripRequest",
          entityId: id,
        });
        return tx.tripRequest.findUnique({ where: { id } });
      });

      kickOutboxProcessor();
      return NextResponse.json({ trip: updated, autoApproved: true, tripType: "personal" });
    }

    const itin = parseItinerary(trip.itinerary);
    const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
    if (!policy) {
      throw new ApiError(
        500,
        "No travel policy is configured. A super admin must create the default policy.",
      );
    }

    const nights = tripNights(trip.departDate, trip.returnDate);
    const flightCost = itin.featured?.flight?.estimatedPrice ?? null;
    const hotelPerNight = itin.featured?.hotel?.estimatedPrice ?? null;
    const evaluation = evaluate(
      { departDate: trip.departDate, cabin: trip.cabin },
      {
        flightCost,
        hotelPerNight,
        nights,
        total: itin.estimatedTotal ?? null,
        cabin: trip.cabin,
      },
      policy,
      tripCurrency(trip.origin, trip.destination),
    );

    const requester = trip.requester;
    // Employees always need a human decision. Managers, travel admins and
    // super admins may auto-approve only when the policy passes, the estimate
    // is complete and the policy switch allows it.
    const needsApproval =
      requester.role === "employee" ||
      evaluation.requiresApproval ||
      !trip.estimateIsComplete ||
      !policy.allowAutoApprovalForNonEmployees;

    if (!needsApproval) {
      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.tripRequest.updateMany({
          where: { id, status: "draft" },
          data: {
            status: "approved",
            policyFlags: JSON.stringify(evaluation.flags),
            submittedAt: new Date(),
            decidedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          throw new ApiError(
            409,
            "This trip was submitted by another request. Refresh and check its status.",
            { code: "SUBMISSION_RACE" },
          );
        }
        await recordAudit(tx, {
          actorId: requester.id,
          action: "trip.auto_approved",
          entityType: "TripRequest",
          entityId: id,
          summary: `Trip auto-approved within policy for ${requester.name}`,
          metadata: { flags: evaluation.flags, role: requester.role },
        });
        await notify(tx, {
          userId: requester.id,
          type: "trip_approved",
          title: "Trip auto-approved",
          body: `Your trip to ${trip.destination} was auto-approved within policy.`,
          link: `/trips/${id}`,
          entityType: "TripRequest",
          entityId: id,
        });
        return tx.tripRequest.findUnique({ where: { id } });
      });
      kickOutboxProcessor();
      return NextResponse.json({ trip: updated, autoApproved: true });
    }

    const resolution = await resolveApprover(requester);
    if (!resolution.ok) {
      throw new ApiError(409, `${resolution.reason} ${resolution.action}`, {
        code: "NO_APPROVER",
        details: { reason: resolution.reason, action: resolution.action },
      });
    }

    const approver = resolution.approver;
    try {
      const result = await db.$transaction(async (tx) => {
        const claimed = await tx.tripRequest.updateMany({
          where: { id, status: "draft" },
          data: {
            status: "pending_approval",
            policyFlags: JSON.stringify(evaluation.flags),
            submittedAt: new Date(),
            decidedAt: null,
          },
        });
        if (claimed.count !== 1) {
          throw new ApiError(
            409,
            "This trip was submitted by another request. Refresh and check its status.",
            { code: "SUBMISSION_RACE" },
          );
        }

        const approval = await tx.approval.create({
          data: {
            tripRequestId: id,
            approverId: approver.id,
            decision: "pending",
            pendingKey: id,
            assignedById: requester.id,
            assignedAt: new Date(),
          },
        });
        await tx.approvalEvent.create({
          data: {
            approvalId: approval.id,
            type: "created",
            actorId: requester.id,
            comment: `Submitted for approval (${resolution.source.replaceAll("_", " ")}).`,
            metadata: JSON.stringify({ source: resolution.source }),
          },
        });
        await recordAudit(tx, {
          actorId: requester.id,
          action: "trip.submitted",
          entityType: "TripRequest",
          entityId: id,
          summary: `Trip to ${trip.destination} submitted to ${approver.name}`,
          metadata: {
            approverId: approver.id,
            source: resolution.source,
            flags: evaluation.flags,
          },
        });
        await notify(tx, {
          userId: approver.id,
          type: "approval_assigned",
          title: "New approval request",
          body: `${requester.name} submitted a trip to ${trip.destination}.`,
          link: `/trips/${id}`,
          entityType: "TripRequest",
          entityId: id,
        });
        return tx.tripRequest.findUnique({
          where: { id },
          include: { approvals: true },
        });
      });

      kickOutboxProcessor();
      return NextResponse.json({
        trip: result,
        autoApproved: false,
        approver: { id: approver.id, name: approver.name, source: resolution.source },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await db.approval.findFirst({
          where: { tripRequestId: id, decision: "pending" },
        });
        if (existing) {
          return NextResponse.json({
            trip: await db.tripRequest.findUnique({ where: { id } }),
            autoApproved: false,
            idempotent: true,
            pendingApprovalId: existing.id,
          });
        }
        throw new ApiError(
          409,
          "This trip already has a pending approval. Refresh and check its status.",
          { code: "DUPLICATE_PENDING_APPROVAL" },
        );
      }
      throw error;
    }
  },
);
