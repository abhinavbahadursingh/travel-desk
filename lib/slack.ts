import crypto from "node:crypto";
import { formatMoney } from "./currency";

export async function verifySignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return true; // dev
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export type SlackCommand =
  | { kind: "plan"; freeform: string }
  | { kind: "status" }
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string; reason: string }
  | { kind: "help" };

export function parseCommand(text: string): SlackCommand {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "help") return { kind: "help" };
  const [verb, ...rest] = trimmed.split(/\s+/);
  const tail = rest.join(" ").trim();
  switch (verb.toLowerCase()) {
    case "plan":
      return { kind: "plan", freeform: tail };
    case "status":
      return { kind: "status" };
    case "approve":
      return { kind: "approve", id: tail };
    case "reject": {
      const [id, ...reasonParts] = tail.split(/\s+/);
      return { kind: "reject", id: id ?? "", reason: reasonParts.join(" ").trim() };
    }
    default:
      // bare freeform text → treat as a plan request
      return { kind: "plan", freeform: trimmed };
  }
}

export function helpBlocks() {
  return {
    response_type: "ephemeral",
    text:
      "*Travel bot*\n" +
      "`/travel plan <freeform>` — plan a new trip (e.g. `/travel plan Berlin Nov 18-20 for Q4 review`)\n" +
      "`/travel status` — list your open trips\n" +
      "`/travel approve <trip id>` — approve a pending request assigned to you\n" +
      "`/travel reject <trip id> <reason>` — reject with a mandatory reason",
  };
}

export function tripSummaryText(trip: {
  id: string;
  destination: string;
  departDate: Date;
  returnDate: Date | null;
  status: string;
  estimatedCost: number | null;
  estimateIsComplete?: boolean | null;
  currency?: string | null;
}) {
  const dates = trip.returnDate
    ? `${trip.departDate.toISOString().slice(0, 10)} → ${trip.returnDate
        .toISOString()
        .slice(0, 10)}`
    : `${trip.departDate.toISOString().slice(0, 10)} · one-way`;
  const knownCost =
    trip.estimateIsComplete !== false &&
    trip.estimatedCost != null &&
    Number.isFinite(trip.estimatedCost)
      ? trip.estimatedCost
      : null;
  const costText =
    knownCost == null
      ? "Total cost unavailable — some prices are missing."
      : formatMoney(knownCost, trip.currency ?? "USD");
  return (
    `*${trip.destination}* (${dates}) — ` +
    `_${trip.status}_ — ${costText} — ` +
    `id \`${trip.id}\``
  );
}
