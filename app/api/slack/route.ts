import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canApproveAny } from "@/lib/auth";
import { recordAudit, notify, notifyMany } from "@/lib/audit";
import { verifySignature, parseCommand, helpBlocks, tripSummaryText } from "@/lib/slack";
import { extractTripFields, planTrip } from "@/lib/ai";
import { evaluate, policySummary } from "@/lib/policy";
import { tripCurrency, formatMoney } from "@/lib/currency";
import { tripNights } from "@/lib/dates";
import type { Candidate } from "@/lib/search";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = await verifySignature(
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return new NextResponse("bad signature", { status: 401 });

  const params = new URLSearchParams(raw);
  const slackUserId = params.get("user_id") ?? "";
  const text = params.get("text") ?? "";
  const user = await db.user.findUnique({ where: { slackUserId } });
  if (!user) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: `Your Slack account (\`${slackUserId}\`) is not linked. Ask a travel admin to link it.`,
    });
  }
  if (!user.active) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Your travel account is deactivated. Ask a super admin to reactivate it.",
    });
  }

  const cmd = parseCommand(text);

  if (cmd.kind === "help") return NextResponse.json(helpBlocks());

  if (cmd.kind === "status") {
    const trips = await db.tripRequest.findMany({
      where: { requesterId: user.id, NOT: { status: "cancelled" } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (!trips.length)
      return NextResponse.json({ response_type: "ephemeral", text: "No open trips." });
    return NextResponse.json({
      response_type: "ephemeral",
      text: trips.map(tripSummaryText).join("\n"),
    });
  }

  if (cmd.kind === "approve" || cmd.kind === "reject") {
    if (
      user.role !== "manager" &&
      user.role !== "travel_admin" &&
      user.role !== "super_admin"
    ) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "Only managers, travel admins and super admins can approve or reject trips.",
      });
    }
    if (cmd.kind === "reject" && cmd.reason.trim().length < 5) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "A rejection reason of at least 5 characters is required: `/travel reject <trip id> <reason>`.",
      });
    }
    const rejectionReason = cmd.kind === "reject" ? cmd.reason : null;
    const approval = await db.approval.findFirst({
      where: {
        tripRequestId: cmd.id,
        decision: "pending",
        ...(canApproveAny(user) ? {} : { approverId: user.id }),
      },
      include: { tripRequest: { include: { requester: true } } },
    });
    if (!approval) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `No pending approval on trip \`${cmd.id}\` assigned to you.`,
      });
    }
    if (approval.tripRequest.requesterId === user.id) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "You cannot approve or reject your own trip.",
      });
    }
    if (approval.tripRequest.status !== "pending_approval") {
      return NextResponse.json({
        response_type: "ephemeral",
        text: `Trip \`${cmd.id}\` is not awaiting approval.`,
      });
    }

    const decision = cmd.kind === "approve" ? "approved" : "rejected";
    try {
      await db.$transaction(async (tx) => {
        const claimed = await tx.approval.updateMany({
          where: { id: approval.id, decision: "pending", pendingKey: cmd.id },
          data: {
            decision,
            decidedAt: new Date(),
            comment: rejectionReason ?? "via Slack",
            rejectionReason,
            pendingKey: null,
          },
        });
        if (claimed.count !== 1) {
          throw new Error("ALREADY_DECIDED");
        }
        const tripUpdate = await tx.tripRequest.updateMany({
          where: { id: cmd.id, status: "pending_approval" },
          data: { status: decision, decidedAt: new Date() },
        });
        if (tripUpdate.count !== 1) {
          throw new Error("STATE_CHANGED");
        }
        await tx.approvalEvent.create({
          data: {
            approvalId: approval.id,
            type: decision,
            actorId: user.id,
            comment: rejectionReason ?? "via Slack",
            metadata: JSON.stringify({ channel: "slack" }),
          },
        });
        await notify(tx, {
          userId: approval.tripRequest.requesterId,
          type: decision === "approved" ? "trip_approved" : "trip_rejected",
          title: decision === "approved" ? "Trip approved" : "Trip rejected",
          body:
            decision === "approved"
              ? `${user.name} approved your trip to ${approval.tripRequest.destination}.`
              : `${user.name} rejected your trip to ${approval.tripRequest.destination}: ${rejectionReason}`,
          link: `/trips/${cmd.id}`,
        });
        if (decision === "approved") {
          const admins = await tx.user.findMany({
            where: { role: { in: ["travel_admin", "super_admin"] }, active: true },
            select: { id: true },
          });
          await notifyMany(
            tx,
            admins.map((a) => a.id),
            {
              type: "trip_ready_for_booking",
              title: "Approved trip ready for booking",
              body: `${approval.tripRequest.requester.name}'s trip to ${approval.tripRequest.destination} is approved.`,
              link: `/trips/${cmd.id}`,
            },
          );
        }
        await recordAudit(tx, {
          actorId: user.id,
          action: `approval.${decision}`,
          entityType: "Approval",
          entityId: approval.id,
          summary: `${user.name} ${decision} ${approval.tripRequest.requester.name}'s trip via Slack`,
          metadata: {
            tripRequestId: cmd.id,
            channel: "slack",
            rejectionReason: rejectionReason ?? undefined,
          },
        });
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return NextResponse.json({
        response_type: "ephemeral",
        text:
          code === "ALREADY_DECIDED"
            ? "This approval was already decided. Refresh the dashboard."
            : "The trip changed before the decision was saved. Refresh the dashboard.",
      });
    }
    return NextResponse.json({
      response_type: "ephemeral",
      text: `Trip \`${cmd.id}\` ${decision}.`,
    });
  }

  // plan
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "AI planning is disabled (no GROQ_API_KEY on the server).",
    });
  }
  const fields = await extractTripFields(cmd.freeform, "SFO");
  if (!fields.destination || !fields.departDate) {
    return NextResponse.json({
      response_type: "ephemeral",
      text:
        "Couldn't parse that. Try `/travel plan Berlin 2026-11-18 to 2026-11-20 for Q4 review`, or omit the return date for a one-way trip.",
    });
  }
  const departDate = new Date(fields.departDate);
  const returnDate = fields.returnDate ? new Date(fields.returnDate) : null;
  if (
    Number.isNaN(departDate.getTime()) ||
    (returnDate !== null && Number.isNaN(returnDate.getTime())) ||
    (returnDate !== null && returnDate.getTime() < departDate.getTime())
  ) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Couldn't use those dates. Use YYYY-MM-DD and keep the return date on or after departure.",
    });
  }
  const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
  if (!policy) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "No travel policy configured.",
    });
  }

  const trip = await db.tripRequest.create({
    data: {
      requesterId: user.id,
      purpose: fields.purpose ?? cmd.freeform,
      origin: fields.origin ?? "SFO",
      destination: fields.destination,
      departDate,
      returnDate,
      currency: tripCurrency(fields.origin ?? "SFO", fields.destination),
      status: "draft",
    },
  });

  await recordAudit(db, {
    actorId: user.id,
    action: "trip.created",
    entityType: "TripRequest",
    entityId: trip.id,
    summary: `${user.name} created a draft trip via Slack to ${trip.destination}`,
    metadata: { channel: "slack" },
  });

  const currency = tripCurrency(trip.origin, trip.destination);
  const planned = await planTrip({
    purpose: trip.purpose,
    origin: trip.origin,
    destination: trip.destination,
    departDate: trip.departDate,
    returnDate: trip.returnDate,
    cabin: trip.cabin,
    currency,
    policySummary: policySummary(policy, currency),
  });

  if (planned.status === "unavailable") {
    return NextResponse.json({
      response_type: "ephemeral",
      text:
        `*Trip drafted* — id \`${trip.id}\`\n` +
        `Search is currently unavailable (${planned.reason}). ` +
        `No itinerary was generated. Open the dashboard to try again.`,
    });
  }

  const nights = tripNights(trip.departDate, trip.returnDate);
  const flightCost = planned.featured.flight?.estimatedPrice ?? null;
  const hotelPerNight = planned.featured.hotel?.estimatedPrice ?? null;
  const total =
    flightCost != null && hotelPerNight != null
      ? flightCost + hotelPerNight * nights
      : null;

  const ev = evaluate(
    { departDate: trip.departDate, cabin: trip.cabin },
    { flightCost, hotelPerNight, nights, total, cabin: trip.cabin },
    policy,
    currency,
  );
  await db.tripRequest.update({
    where: { id: trip.id },
    data: {
      itinerary: JSON.stringify({
        flights: planned.flights,
        hotels: planned.hotels,
        trains: planned.trains,
        cabs: planned.cabs,
        featured: planned.featured,
        estimatedTotal: total,
        rationale: planned.rationale,
        retrievedAt: planned.retrievedAt,
      }),
      itineraryRetrievedAt: new Date(planned.retrievedAt),
      // Null when the total is unknown — never coerced to 0.
      estimatedCost: total,
      currency,
      estimateIsComplete: flightCost != null && hotelPerNight != null,
      policyFlags: JSON.stringify(ev.flags),
    },
  });

  const linkLine = (label: string, c: Candidate | null) =>
    c
      ? `• *${label}:* <${c.sourceUrl}|${c.sourceHostname}> — ${
          c.price != null
            ? `${formatMoney(c.price, c.currency ?? currency)} (${c.priceType})`
            : "price not listed"
        } — availability: ${c.availabilityStatus}`
      : `• *${label}:* no result`;

  const tripDates = trip.returnDate
    ? `${trip.departDate.toISOString().slice(0, 10)} → ${trip.returnDate
        .toISOString()
        .slice(0, 10)}`
    : `${trip.departDate.toISOString().slice(0, 10)} · one-way`;
  return NextResponse.json({
    response_type: "ephemeral",
    text:
      `*Trip drafted* — id \`${trip.id}\`\n` +
      `${trip.origin} → ${trip.destination}, ${tripDates}\n` +
      `${linkLine("Flight", planned.featured.flight)}\n` +
      `${linkLine("Hotel", planned.featured.hotel)}\n` +
      `${linkLine("Train", planned.featured.train)}\n` +
      `${linkLine("Cab", planned.featured.cab)}\n` +
      `Est. total: ${
        total != null ? formatMoney(total, currency) : "unavailable (price missing)"
      }` +
      (ev.flags.length ? `  _flags: ${ev.flags.join(", ")}_` : "") +
      `\n_retrieved ${planned.retrievedAt}_\n\n` +
      `_${planned.rationale}_\n\n` +
      `Open the dashboard to submit for approval.`,
  });
}
