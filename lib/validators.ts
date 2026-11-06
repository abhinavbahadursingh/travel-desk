import { z } from "zod";

const dateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");

// Empty strings and null both mean "no return date" (one-way trip).
const optionalDateString = z
  .union([dateString, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === null ? undefined : value));

const iataCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "invalid IATA code");

const optionalIataCode = z
  .union([iataCode, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null ? undefined : v));

const optionalShortText = z
  .union([z.string().trim().max(200), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null ? undefined : v));

// Latitude/longitude come from hidden form inputs as strings. Coerce + bound
// so rubbish entries (or empty strings on resubmit) land as undefined, not
// NaN.
const optionalLatitude = z
  .union([z.coerce.number().min(-90).max(90), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null ? undefined : v));
const optionalLongitude = z
  .union([z.coerce.number().min(-180).max(180), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null ? undefined : v));

export const tripCreateSchema = z
  .object({
    purpose: z
      .union([z.string().trim().min(3).max(500), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value === null ? undefined : value)),
    tripType: z.enum(["official", "personal"]).optional().default("official"),
    tripReason: z
      .union([z.string().trim().max(1000), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value === null ? undefined : value)),
    origin: z.string().min(2).max(100),
    destination: z.string().min(2).max(100),
    departDate: dateString,
    returnDate: optionalDateString,
    cabin: z.enum(["economy", "premium_economy", "business"]).optional(),
    notes: z.string().max(2000).optional(),
    // Per-mode class selection. Defaults to economy when omitted.
    flightClass: z
      .enum(["economy", "premium_economy", "business"])
      .optional()
      .default("economy"),
    trainClass: z
      .enum(["economy", "premium_economy", "business"])
      .optional()
      .default("economy"),
    originAirportCode: optionalIataCode,
    originAirportName: optionalShortText,
    originCity: optionalShortText,
    originCountry: optionalShortText,
    originLatitude: optionalLatitude,
    originLongitude: optionalLongitude,
    destinationAirportCode: optionalIataCode,
    destinationAirportName: optionalShortText,
    destinationCity: optionalShortText,
    destinationCountry: optionalShortText,
    destinationLatitude: optionalLatitude,
    destinationLongitude: optionalLongitude,
  })
  .refine(
    (v) =>
      !v.originAirportCode ||
      !v.destinationAirportCode ||
      v.originAirportCode !== v.destinationAirportCode,
    {
      message: "Origin and destination must be different airports",
      path: ["destinationAirportCode"],
    },
  )
  .refine(
    (value) =>
      !value.returnDate || Date.parse(value.returnDate) >= Date.parse(value.departDate),
    {
      message: "Return date must be on or after the departure date",
      path: ["returnDate"],
    },
  );

// Patch keeps null/empty distinct so an existing return date can be cleared.
export const tripPatchSchema = z.object({
  purpose: z.string().min(3).max(500).optional(),
  tripType: z.enum(["official", "personal"]).optional(),
  tripReason: z
    .union([z.string().trim().max(1000), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" || value === null ? undefined : value)),
  origin: z.string().min(2).max(100).optional(),
  destination: z.string().min(2).max(100).optional(),
  departDate: dateString.optional(),
  returnDate: z.union([dateString, z.literal(""), z.null()]).optional(),
  cabin: z.enum(["economy", "premium_economy", "business"]).optional(),
  notes: z.string().max(2000).optional(),
  flightClass: z.enum(["economy", "premium_economy", "business"]).optional(),
  trainClass: z.enum(["economy", "premium_economy", "business"]).optional(),
});

const optionalText = z
  .union([z.string().trim().max(2000), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === null ? undefined : value));

export const approvalSchema = z
  .object({
    decision: z.enum(["approved", "rejected", "changes_requested"]),
    comment: optionalText,
    rejectionReason: optionalText,
  })
  .superRefine((value, ctx) => {
    if (value.decision === "rejected") {
      if (!value.rejectionReason || value.rejectionReason.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rejectionReason"],
          message: "A rejection reason of at least 5 characters is required.",
        });
      }
    }
    if (value.decision === "changes_requested" && !value.comment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "Describe the changes or clarification needed.",
      });
    }
  });

export const approvalCommentSchema = z.object({
  comment: z.string().trim().min(1, "Comment is required").max(2000),
});

export const approvalReassignSchema = z.object({
  approverId: z.string().min(1),
  note: optionalText,
});

export const cancellationRequestSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(1000),
});

export const cancellationDecisionSchema = z
  .object({
    action: z.enum(["reject", "complete"]),
    note: optionalText,
    reference: optionalText,
  })
  .superRefine((value, ctx) => {
    if (value.action === "complete" && !value.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reference"],
        message:
          "A real provider cancellation reference is required before marking the trip cancelled.",
      });
    }
    if (value.action === "reject" && !value.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Explain why the cancellation request was rejected.",
      });
    }
  });

const optionalSlackUserId = z
  .union([
    z.string().trim().max(100, "Slack user ID must be 100 characters or fewer"),
    z.literal(""),
    z.null(),
  ])
  .optional()
  .transform((value) => (value === "" || value === null ? null : value));

export const profilePatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must be 100 characters or fewer")
      .optional(),
    slackUserId: optionalSlackUserId,
  })
  .refine((value) => value.name !== undefined || value.slackUserId !== undefined, {
    message: "Provide a name or Slack user ID to update",
  });

const roleSchema = z.enum(["employee", "manager", "travel_admin", "super_admin"]);

const optionalEmail = z
  .union([z.string().trim().email("Invalid email").max(200), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" || value === null ? undefined : value));

const employmentTypeEnum = z
  .enum(["full_time", "part_time", "contractor", "intern"])
  .optional();
const workLocationEnum = z
  .enum(["office", "remote", "hybrid"])
  .optional();

export const userCreateSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(100),
  role: roleSchema.default("employee"),
  department: z
    .union([z.string().trim().max(100), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" || value === null ? null : value)),
  managerId: z
    .union([z.string().min(1), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === "" || value === null ? null : value)),
  active: z.boolean().optional().default(true),
  slackUserId: optionalSlackUserId,
});

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    role: roleSchema.optional(),
    department: z
      .union([z.string().trim().max(100), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value === null ? null : value)),
    managerId: z
      .union([z.string().min(1), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value === null ? null : value)),
    active: z.boolean().optional(),
    slackUserId: optionalSlackUserId,
    // Personal information (super admin managed)
    phone: optionalText,
    alternatePhone: optionalText,
    personalEmail: optionalEmail,
    dateOfBirth: optionalDateString,
    gender: optionalText,
    address: optionalText,
    city: optionalText,
    state: optionalText,
    country: optionalText,
    pinCode: optionalText,
    profilePicture: optionalText,
    // Professional information (super admin managed)
    employeeId: z
      .union([z.string().trim().max(50), z.literal(""), z.null()])
      .optional()
      .transform((value) => (value === "" || value === null ? undefined : value)),
    jobTitle: optionalText,
    designation: optionalText,
    employmentType: employmentTypeEnum,
    joiningDate: optionalDateString,
    officeLocation: optionalText,
    businessUnit: optionalText,
    costCentre: optionalText,
    workLocation: workLocationEnum,
    // Sensitive — super admin only
    passportDetails: optionalText,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.role !== undefined ||
      value.department !== undefined ||
      value.managerId !== undefined ||
      value.active !== undefined ||
      value.slackUserId !== undefined ||
      value.phone !== undefined ||
      value.alternatePhone !== undefined ||
      value.personalEmail !== undefined ||
      value.dateOfBirth !== undefined ||
      value.gender !== undefined ||
      value.address !== undefined ||
      value.city !== undefined ||
      value.state !== undefined ||
      value.country !== undefined ||
      value.pinCode !== undefined ||
      value.profilePicture !== undefined ||
      value.employeeId !== undefined ||
      value.jobTitle !== undefined ||
      value.designation !== undefined ||
      value.employmentType !== undefined ||
      value.joiningDate !== undefined ||
      value.officeLocation !== undefined ||
      value.businessUnit !== undefined ||
      value.costCentre !== undefined ||
      value.workLocation !== undefined ||
      value.passportDetails !== undefined,
    { message: "Provide at least one field to update" },
  );

export const policyUpdateSchema = z
  .object({
    currency: z.enum(["INR", "USD"]).optional(),
    maxFlightEconomy: z.number().nonnegative().optional(),
    maxHotelPerNight: z.number().nonnegative().optional(),
    maxTotalPerTrip: z.number().nonnegative().optional(),
    requireApprovalAbove: z.number().nonnegative().optional(),
    advancePurchaseDays: z.number().int().min(0).max(365).optional(),
    allowedCabins: z
      .array(z.enum(["economy", "premium_economy", "business"]))
      .min(1)
      .optional(),
    allowAutoApprovalForNonEmployees: z.boolean().optional(),
    requireBookingReference: z.boolean().optional(),
    cancellationRequiresAdminReview: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one policy field to update",
  });

export const notificationsPatchSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, {
    message: "Provide notification ids or all=true",
  });

export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

// ──────────────────────── Extended profile validators ────────────────────

const seatEnum = z.enum(["window", "aisle", "middle"]).optional();
const hotelCategoryEnum = z
  .enum(["budget", "standard", "premium", "luxury"])
  .optional();
const travelClassEnum = z
  .enum(["economy", "premium_economy", "business"])
  .optional();

// Personal + professional information that the authenticated user may edit
// on their own profile. Role, employeeId and managerId are intentionally
// excluded — those are managed by a super admin via /api/admin/users/[id].
export const profileExtendedPatchSchema = z
  .object({
    // Personal
    phone: optionalText,
    alternatePhone: optionalText,
    personalEmail: optionalEmail,
    dateOfBirth: optionalDateString,
    gender: optionalText,
    address: optionalText,
    city: optionalText,
    state: optionalText,
    country: optionalText,
    pinCode: optionalText,
    profilePicture: optionalText,
    // Professional
    jobTitle: optionalText,
    designation: optionalText,
    employmentType: employmentTypeEnum,
    joiningDate: optionalDateString,
    officeLocation: optionalText,
    businessUnit: optionalText,
    costCentre: optionalText,
    workLocation: workLocationEnum,
  })
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    { message: "Provide at least one field to update" },
  );

// Travel preferences + emergency contact. PassportDetails is excluded here
// — it is writable only by a super admin through /api/admin/users/[id].
export const travelPreferencePatchSchema = z
  .object({
    preferredSeat: seatEnum,
    preferredMeal: optionalText,
    preferredAirline: optionalText,
    preferredHotelCategory: hotelCategoryEnum,
    preferredHotelChain: optionalText,
    preferredTravelClass: travelClassEnum,
    frequentFlyerNumbers: optionalText,
    hotelLoyaltyMembership: optionalText,
    emergencyContactName: optionalText,
    emergencyContactNumber: optionalText,
    emergencyContactRelationship: optionalText,
  })
  .refine(
    (value) =>
      Object.keys(value).length > 0,
    { message: "Provide at least one field to update" },
  );

// Password change initiated from the profile page (reuses the same rules as
// /api/auth/change-password but is scoped to the profile UI).
export const profilePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
