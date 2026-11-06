export const MS_PER_DAY = 1000 * 60 * 60 * 24;

// One-way trips have no return date. Hotel pricing and policy maths still need
// a night count, so a one-way trip assumes a single night. The UI discloses
// that assumption; this is arithmetic, not invented inventory or pricing.
export function tripNights(departDate: Date, returnDate: Date | null): number {
  if (!returnDate) return 1;
  return Math.max(
    1,
    Math.round((returnDate.getTime() - departDate.getTime()) / MS_PER_DAY),
  );
}

export function hotelCheckOut(departDate: Date, returnDate: Date | null): Date {
  return returnDate ?? new Date(departDate.getTime() + MS_PER_DAY);
}
