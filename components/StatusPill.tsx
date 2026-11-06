export function StatusPill({ status }: { status: string }) {
  const cls =
    status === "draft" || status === "changes_requested"
      ? "pill-draft"
      : status === "pending_approval"
        ? "pill-pending"
        : status === "approved"
          ? "pill-approved"
          : status === "rejected"
            ? "pill-rejected"
            : status === "booking_links_generated"
              ? "pill-links"
              : status === "booking_pending_confirmation"
                ? "pill-pending"
                : status === "booked"
                  ? "pill-booked"
                  : status === "cancellation_requested"
                    ? "pill-pending"
                    : "pill-cancelled";

  const labels: Record<string, string> = {
    draft: "Draft",
    changes_requested: "Changes requested",
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    booking_links_generated: "Booking links ready",
    booking_pending_confirmation: "Awaiting confirmation",
    booked: "Booked",
    cancellation_requested: "Cancellation requested",
    cancelled: "Cancelled",
  };

  return <span className={cls}>{labels[status] ?? status.replaceAll("_", " ")}</span>;
}
