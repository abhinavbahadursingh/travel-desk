# Corporate Travel Agent — audit, plan and status

Last updated: 2026-11-04

## 1. Audit summary

The application is a Next.js 15 App Router project with Prisma/SQLite, Groq for
reasoning, Tavily for real web search and optional Google Maps routing. The
existing core is sound: real search results are stored with source and retrieval
time, prices are never invented, and the AI only reasons over retrieved data.

The audit found these structural gaps:

| Area | Finding | Impact |
| --- | --- | --- |
| Roles | Only `employee`, `manager`, `travel_admin`; no `super_admin` | No separation between travel operations and administration |
| Identity | `DEV_USER_EMAIL` is resolved server-side, but `/api/profile` lets any user change their own role | Privilege escalation |
| User model | No `active` flag, no department, manager assignment only through the database | No deactivation, no departmental routing, no UI assignment |
| Approval | No unique constraint on pending approvals; create + status update not transactional | Duplicate/conflicting approvals |
| Approval | No rejection reason, no comments endpoint, no reassignment, no history | No auditable decision trail |
| Approval resolution | Manager → any travel admin → any manager; no department fallback; no active check | Weak routing and inactive approvers |
| Lifecycle | No `booking_pending_confirmation`, no `cancellation_requested`; cancellation is terminal only | Booking and cancellation states are ambiguous |
| Booking | Confirmation does not validate the trip status transition; no cancellation fields | Invalid transitions possible |
| API security | Inline role checks; some routes trust `travel_admin` broadly; errors are inconsistent | Contract and authorization drift |
| API coverage | No notifications, audit, user management, policy management, reports, health or cancellation endpoints | Four-role workflows cannot be completed |
| UI | One dashboard for all roles; no manager, operations or administration dashboards; role switcher | Dead ends and privilege escalation |
| Data safety | `Approval` and `Booking` cascade-delete with a trip; no indexes | Accidental history loss and slow queries |

## 2. Target roles and authorization

- `employee`: own trips only; create/edit drafts, plan, submit, view decisions,
  booking links, own bookings, request cancellation.
- `manager`: employee capabilities plus an approval inbox limited to approvals
  assigned to them; view reporting employees; approve/reject/request changes.
- `travel_admin`: employee capabilities plus all trips, booking operations,
  cancellation handling, approvals overview, directory and reports. May assign
  managers when authorized.
- `super_admin`: everything a travel admin can do plus user/role/manager
  management, policy configuration, audit log, health and application settings.

Every API resolves the caller from `DEV_USER_EMAIL` on the server. Client-supplied
roles are ignored. Inactive users are rejected. Role changes happen only through
`/api/admin/users/[id]` and are restricted to `super_admin`.

## 3. Approval resolution

Order (first eligible wins):

1. Requester's assigned manager (`User.managerId`).
2. Active manager in the requester's department (departmental manager).
3. Active travel admin.
4. Active super admin.

Eligibility: account active, not the requester, role in
`manager | travel_admin | super_admin`. Employees always require a human
decision. Managers/admins/super admins may auto-approve only when the policy
engine says no approval is required **and** the estimate is complete. If no
eligible approver exists, submission returns `409` with an actionable message
and no approval row is created.

## 4. State machine

```
draft
  ├─ (plan) ──────────────► draft (itinerary stored; still not approved)
  └─ (submit) ────────────► pending_approval
                              ├─ approve ─► approved
                              ├─ reject ──► rejected
                              └─ changes requested ─► draft (approval history kept)
approved
  └─ (generate links) ────► booking_links_generated
                              └─ (confirm one leg) ─► booking_pending_confirmation
                                                       └─ (all legs confirmed) ─► booked
booked
  └─ (request cancellation) ─► cancellation_requested
                                 ├─ reject ─► booked
                                 └─ verify cancellation + reference ─► cancelled
```

Rules enforced in code and transactions:

- Planning never changes approval state.
- Approval never creates bookings.
- Opening a provider link never changes booking state.
- Confirmation requires a non-empty provider reference and a travel admin/super admin.
- Cancellation request never marks anything cancelled; only a verified admin
  completion with a cancellation reference moves the trip to `cancelled`.

## 5. Schema changes (additive, no reset)

- `User`: `active`, `department`, `updatedAt`; relations for notifications,
  audit, cancellation reviews, approval assignment.
- `TripRequest`: `submittedAt`, `decidedAt`, `bookedAt`, `cancelledAt`; indexes.
- `Approval`: `rejectionReason`, `pendingKey` (unique while pending),
  `assignedById`, `assignedAt`; `onDelete: Restrict`; indexes.
- New `ApprovalEvent`: immutable decision/comment/reassignment history.
- New `Notification`: per-user inbox with read state.
- New `AuditLog`: actor, action, entity, summary, metadata.
- New `CancellationRequest`: pending/rejected/completed, review note,
  cancellation reference, unique pending key.
- `Booking`: cancellation fields, status index, `onDelete: Restrict`.
- `TravelPolicy`: auto-approval switch for non-employees, booking-reference rule,
  cancellation-review rule, `updatedAt`.

## 6. API work

New/changed:

- `GET/POST /api/trips` — role-scoped lists and filters.
- `GET/PATCH /api/trips/[id]` — visibility and draft-only editing.
- `POST /api/trips/[id]/submit` — transactional, idempotent resolution.
- `POST /api/trips/[id]/plan` — owner/admin only; no approval change.
- `POST /api/trips/[id]/book` — approved-only, transactional, idempotent.
- `POST /api/trips/[id]/confirm-booking` — valid transition + reference.
- `POST /api/trips/[id]/cancellation` — employee/admin request.
- `GET /api/approvals` — inbox/history scopes.
- `POST /api/approvals/[id]` — decision, mandatory rejection reason, atomic.
- `POST /api/approvals/[id]/comments` — clarification/comment thread.
- `POST /api/approvals/[id]/reassign` — travel admin/super admin.
- `GET/POST /api/cancellations`, `POST /api/cancellations/[id]` — operations.
- `GET/PATCH /api/notifications` — inbox and read state.
- `GET/POST /api/admin/users`, `PATCH /api/admin/users/[id]` — super admin.
- `GET/PATCH /api/admin/policy` — policy configuration.
- `GET /api/admin/audit`, `/api/admin/health`, `/api/admin/reports`.
- `GET /api/manager/team` — reporting employees and assigned work.
- `PATCH /api/profile` — name/Slack only; role removed.

Every handler uses shared `ApiError`/`withApi` helpers so business conflicts are
`409`, authorization failures `403`, validation `400`, missing resources `404`.

## 7. UI work

- Employee: `/` dashboard, `/trips`, `/trips/new`, `/bookings`, `/history`,
  `/notifications`, `/profile`.
- Manager: `/manager`, `/approvals` (inbox + history), `/team`, plus employee pages.
- Travel admin: `/admin` operations dashboard, `/admin/trips`,
  `/admin/bookings`, `/admin/cancellations`, `/admin/employees`,
  `/admin/approvals`, `/admin/reports`.
- Super admin: `/admin/users`, `/admin/policy`, `/admin/audit`,
  `/admin/health`, plus all travel admin pages.
- Sidebar renders role-specific navigation with a notification badge.
- Role switcher removed; `/profile` explains that roles are managed by a super admin.

## 8. Verification plan

Use a copy of the real database for destructive workflow tests. The real
database is never reset.

- Workflow A: employee creates a request, plans against real search, submits,
  sees pending, receives a decision, accesses links after approval.
- Workflow B: manager sees only assigned requests, reviews policy flags,
  comments, requests changes, approves/rejects, history is recorded.
- Workflow C: travel admin confirms bookings with real references, handles
  cancellation requests without auto-cancelling.
- Workflow D: super admin creates a user, assigns a role and manager, updates
  policy, verifies audit entries.
- Workflow E: employee cross-trip access, employee approval attempt, manager
  unassigned approval, manager policy update, travel admin super-admin action —
  all blocked with 403.
- Race/duplicate: second decision and duplicate submission return 409/idempotent
  result; no duplicate pending approvals.

## 9. Status

- [x] Full audit and dependency map
- [x] Schema design
- [x] Schema applied (temp DB first, then real DB without reset; 1 user, 4 trips, 1 approval,
      24 bookings and 1 policy preserved)
- [x] Shared authorization/error/approval services
- [x] API hardening and new endpoints
- [x] Role-specific navigation and dashboards
- [x] Workflow verification on a temporary database copy with controlled identities
      (employee, manager, travel admin, super admin, no-manager employee)
- [x] Documentation and final report

### Verified on 2026-11-04 (temp DB copy; real DB untouched)

- **Workflow A (employee):** created a real Mumbai → Bengaluru request, planned against live
  Tavily/Groq search (complete estimate, INR), submitted → routed to the assigned manager,
  duplicate submit idempotent, self-approval blocked (403).
- **Workflow B (manager):** inbox scoped to assigned approvals, trip detail visible, rejection
  without a reason rejected (400), change request returned the trip to `draft` with history,
  resubmission created a new approval while the old trail stayed intact, approval recorded,
  duplicate decision 409, superseded approval 409, policy change blocked (403).
- **Workflow C (travel admin):** generated 12 real provider links, rejected a confirmation without a
  reference (400), confirmed one leg → `booking_pending_confirmation`, duplicate confirmation 409,
  confirmed all legs → `booked`, rejected a cancellation (back to `booked`), then completed a
  verified cancellation with a reference → `cancelled` and all booking rows cancelled, duplicate
  request 409.
- **Workflow D (super admin):** created an account, assigned role and reporting manager, deactivated
  and reactivated it, updated policy, read audit, health and reports. Guards verified: self
  deactivation 409, self role change 409, last-super-admin protection, and deactivation blocked
  while the user holds a pending approval.
- **Workflow E (security):** employee cross-trip access 403, employee approval 403, employee
  confirm-booking 403, employee admin endpoints 403, self-role escalation ignored/rejected, manager
  unassigned approval 403, manager policy change 403, travel admin audit/health 403, plan after
  submit 409, booking before approval 409, no-approver submission 409 with actionable guidance.
- **Approval reassignment:** travel admin moved a pending approval to another approver; history
  event recorded, the new approver could decide, and the previous approver could then be
  deactivated.
- **Build:** `npx tsc --noEmit` and `next build` pass; all role pages return 200.

### 2026-11-04 issue resolutions

- **Issue 1 - Booking lifecycle redesign (implemented this session):**
  - New canonical booking leg states: `pending`, `booked`, `not_required`, `failed`, `cancelled`
    (`lib/booking.ts` normalises legacy stored values `link_only -> pending` and
    `manually_confirmed -> booked`).
  - Trip becomes `booked` only when every **required** leg is resolved successfully
    (`allRequiredLegsResolved`); `not_required` legs are exempt; pending/failed required legs
    keep the trip in `booking_pending_confirmation`.
  - New endpoints: `POST /api/trips/[id]/requirements` (mark a category not required) and
    `POST /api/bookings/[id]/failure` (record a failed provider attempt); confirm/book/cancel
    transitions updated (claims still conditional and transactional).
  - UI updated: `StatusPill` (`changes_requested`), trip booking tags, admin booking queue,
    health pending-confirmation count.
- **Issue 2 - Reports page crash (verified resolved):** page re-rendered `200` with live data
  (`₹42,617` estimated spend, status/booking/flag/destination/month/employee sections all
  rendered); spend already grouped per currency via `spendByCurrency`.
- **Issue 3 - Real authentication (implemented, then temporarily reverted for the demo):**
  - Prototyped session cookie (`auth_session`, 30-day, HttpOnly, SameSite=strict, DB `Session`
    token, scrypt password hashing, login/logout/me/password routes, middleware gate, `AUTH_REQUIRED`).
  - After the demo decision, reverted to the `DEV_USER_EMAIL` local identity (`lib/auth.ts`) and
    removed the prototype routes/middleware; kept `lib/password.ts` unused for the re-enablement.
- **Issue 4 - Legacy self-approval (implemented):** additive `Approval.isLegacy` marker, one-off
  backfill flagged the live self-approved record and wrote an `approval.legacy_marked` audit row,
  and decisions on legacy approvals now fail with `409 LEGACY_APPROVAL`.
- **Verification:** `npx prisma validate`, `npx prisma db push`, `npx prisma generate`.
  `npx tsc --noEmit` and `npx next build` all pass; live endpoints re-checked on the dev server
  after the changes (`/api/trips` 200, `/api/trips/[id]` 200, `/api/admin/reports` 200,
  `/api/admin/health` 200, `/api/auth/*` removed for demo mode).


---

## 10. v2.d — Search intelligence & decision engine (2026-11-04)

Layered on top of the workflow release above without changing any role, state
machine, approval or booking semantics. Prisma schema untouched; new ranking
fields are additive on the stored itinerary JSON.

### What changed
- **`lib/ranking.ts` (new)** — pure, testable helpers:
  - **Dedup.** Collapses two candidates sharing hostname + normalised title, or
    hostname + the first path segments. Keeps the priced copy; never merges
    unrelated hosts.
  - **Price validation.** Per-category bounds in each currency (INR/USD/EUR/GBP/
    JPY). Implausible parses are set to `price=null, priceType=unavailable` —
    never overwritten with a guess.
  - **Duration parsing.** Extracts `durationMinutes` from snippets ("2h 30m",
    "45 min", "2h30"). Not fabricated when absent.
  - **Source reliability.** Per-category allowlist (verified / general / unknown).
    Hosts are shown regardless; only ranking score is affected.
  - **Freshness.** `isStale = retrievedAt > 2h old`.
  - **Scoring.** Weighted sum: price 35%, policy 20%, duration 15%, reliability
    20%, freshness 10%. Candidates get `rankScore (0–100)`, `rankReasons`,
    `priceDelta`, `isCheapest`, `isMostExpensive`.
  - **Category summary.** `cheapest/mostExpensive/pricedCount/staleCount` per
    category, used by the decision engine and UI.
- **`lib/currency.ts`** — live FX from `open.er-api.com` with a 6h in-memory
  cache. On any failure it falls back to the previous static table; on both
  failing, candidate stays in its original currency. `normalizeMoney` now carries
  `rateSource: "live" | "fallback"` and `fetchedAt` so the UI can disclose
  conversions.
- **`lib/ai.ts`** — `planTrip` now accepts `priceCaps` per category (passed from
  the plan route, converted into the trip currency via `capsForCurrency`), warms
  the FX cache, and runs each normalised search result through `rankCategory`
  before returning. Added a new `compare()` helper that takes only the
  compact ranked featured + per-category summary line — not the raw itinerary
  JSON — so it stays well inside the Groq TPM window.
- **`/api/trips/[id]/compare` (new route)** — POST `{ question }`, returns
  `{ answer }`. Loads the stored ranked itinerary, builds the compact context,
  and delegates to `compare()`. Reads only retrieved data; refuses with 409
  when the trip hasn't been planned yet.
- **`/api/trips/[id]/plan`** — unchanged shape, now passes `priceCaps` to
  `planTrip`. The stored itinerary JSON carries the new ranking fields so the
  UI (and later analytics) can read them without touching Prisma.
- **UI (`app/trips/[id]/page.tsx`, `DecisionEngine.tsx`)** — added chips on
  every candidate: *Cheapest*, *Priciest*, *Verified source*, *Unknown source*,
  *Stale >2h*, *~duration*, *Missing price*, *Rank N* (tooltip lists reasons).
  `+Δ vs cheapest` shown on non-cheapest cards. New *Decision engine* card in
  the right column with four quick questions (train or flight / cheapest / time
  / policy) plus a free-form input. Graceful text/JSON fallback for all errors.
- **`globals.css`** — `chip-cheapest`, `chip-priciest`, `chip-verified`,
  `chip-warn`, `chip-neutral` styles.

### Verified on 2026-11-04 (real Tavily + Groq, Mumbai → Bengaluru)

- `npx tsc --noEmit` + `next build` pass. `/api/trips/[id]/compare` listed in
  the build manifest.
- Live plan: flight ranked 99 (`momondo.com`, ₹4,078, within policy, listed
  duration ~100 min, cheapest in category); hotel 87 (`tripadvisor.com`,
  ₹5,785, verified); train 96 (`railyatri.in`, ₹50, cheapest, listed duration
  ~950 min); cab 64 (`uber.com`, ₹1,050, flagged most-expensive).
- Decision engine answered "Should I prefer train or flight?" using only the
  retrieved sources: *"Flight (momondo.com) ₹4,078, 100 min, unverified.
  Train (railyatri.in) ₹50, 950 min, unverified. Both within policy. Flight is
  ~15× faster; train is essentially free but ~16 h."*
- No mock data added. No schema change. All v2.b/v2.c endpoints unchanged in
  shape.

### Constraints honoured
- No auth changes.
- No simulated bookings or availability.
- No fabricated prices (bounds-rejected parses become `null`/`unavailable`,
  never a guess).
- Approval / booking / cancellation flows untouched.

---

## 11. P0 remediation (2026-11-04)

Four P0 issues resolved before any further features. All changes are additive;
no existing DB rows were deleted. `npx prisma validate`, `npx prisma generate`,
`npx tsc --noEmit` and `npx next build` all pass.

### Issue 1 — Booking lifecycle redesign

Most of the lifecycle was already scaffolded in `lib/booking.ts` (canonical
states `pending / booked / not_required / failed / cancelled`, legacy aliases
`link_only → pending` and `manually_confirmed → booked`, `allRequiredLegsResolved`,
`nextTripBookingStatus`). The remaining gaps:

- **Latent TDZ bug** in `app/api/trips/[id]/book/route.ts`: `notRequiredKinds`
  was referenced inside `push()` before its `const` was initialised. Moved the
  `findMany` for `not_required` markers above the `push` calls so the exemption
  actually filters alternates during link generation.
- **Legacy data normalisation**: `prisma/normalize-booking-states.ts`
  (idempotent) renamed 24 `link_only` rows to `pending`; `manually_confirmed`
  rows would have been renamed to `booked` but the DB had none.
- All transitions already use `db.$transaction` + `updateMany`-based optimistic
  claims (status in `{"pending","link_only"}`) so the flip from pending to any
  other state is concurrency-safe and idempotent (repeat calls return 409 with
  `ALREADY_CONFIRMED`/`INVALID_STATE` codes).

### Issue 2 — Reports page

Root cause: `report.destinations/employees/months` carried a single `spend`
column, so the UI that tried to render spend had no safe way to attach a
currency without summing incompatible currencies. Fix:

- `lib/reports.ts` now returns `spendByCurrency: Record<string, number>` on
  every grouping, so each currency is accounted for separately.
- `app/admin/reports/page.tsx` renders a `formatSpend(…)` helper that lists
  each currency's amount with `formatMoney(amount, currency)` joined by `·`.
  Empty datasets render `—` so the UI stays honest when a group has no spend.
- Multi-currency environments render e.g. `₹83,000 · $120` next to a single
  destination/month/employee; single-currency groups look unchanged.

### Issue 3 — Real authentication

Added additively:

- `User` columns: `passwordHash`, `passwordSalt`, `mustSetPassword`,
  `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`, `activationToken`,
  `activationExpiresAt`.
- `Session` model: id, userId, `tokenHash` (sha256 of the raw token),
  `csrfToken`, `expiresAt`, `createdAt`, `revokedAt`, `lastSeenAt`, `ipAddress`,
  `userAgent`.
- `lib/session.ts`: cookie wiring (HttpOnly + Secure in prod + SameSite=Lax),
  double-submit CSRF cookie `tc_csrf`, session creation/revocation, read helpers,
  lock-on-5-failures-for-15-minutes.
- `lib/auth.ts` → `getCurrentUser()` now reads the session cookie first,
  throws 401 `NOT_AUTHENTICATED` when absent. Falls back to `DEV_USER_EMAIL`
  *only* when `ALLOW_DEV_IDENTITY=1` is explicitly set.
- Routes: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`,
  `/api/auth/activate`, `/api/auth/change-password`, super-admin-only
  `/api/admin/users/[id]/reset-password` (issues a one-time activation token).
- UI: `/login` and `/activate` pages with their client forms.
- `middleware.ts`: redirects unauthenticated page requests to `/login?next=…`,
  leaves API and Next internals alone.
- `lib/api.ts` `withApi()` auto-rejects state-changing requests without a
  matching `X-CSRF-Token` when a session cookie is present (duck-typed so
  Next's internal `NextRequest` class identity doesn't matter).
- `components/CsrfFetchBridge.tsx`: client-side fetch patch that reads the
  `tc_csrf` cookie and auto-adds the header; existing client components did
  not need to change.
- `prisma/seed.ts`: if `DEV_USER_PASSWORD` is set, hashes and stores it;
  otherwise issues a one-time activation token for `DEV_USER_EMAIL` and prints
  it once to the console. Never overwrites an existing password.
- Passwords are hashed with `scrypt` + 16-byte random salt (unchanged from
  the existing `lib/password.ts`); verification is timing-safe.

### Issue 4 — Legacy self-approval

- The one existing self-approval row was already `isLegacy=1`; the server
  guards were already in place (`app/api/approvals/[id]/route.ts:30` blocks
  own-trip decisions; `lib/approvals.ts:18` rejects the requester from
  `resolveApprover`).
- `prisma/mark-legacy-self-approvals.ts`: idempotent defensive script that
  flags any future un-flagged self-approvals as legacy (never deletes rows).
- `app/admin/audit/page.tsx` now shows a *Legacy exceptions* panel at the top
  listing every `Approval` with `isLegacy=true` for super-admin review.

### Verified end-to-end (production build, port 3202)

- Login with wrong password → 401 (generic message, no enumeration).
- Login with right password → 200, sets `tc_session` + `tc_csrf` cookies.
- `/api/auth/me` with session → 200 with csrfToken.
- `/api/auth/me` without session → 401.
- Unauth `GET /` → middleware 307 to `/login?next=/`.
- Auth `GET /admin/reports` → 200; multi-currency `formatSpend` renders.
- `POST /api/trips` without CSRF → 403 `{"code":"CSRF"}`.
- `POST /api/trips` with wrong CSRF → 403 `{"code":"CSRF"}`.
- `POST /api/trips` with correct CSRF → 201.
- `POST /api/trips/[id]/requirements` marks cab `not_required` → DB row
  stored with `status=not_required`.
- `POST /api/auth/logout` → 200; subsequent `/api/auth/me` → 401; `GET /` →
  middleware redirect.
- 5 failed-login attempts → 6th returns the generic error; account's
  `failedLoginAttempts` + `lockedUntil` are populated in the DB.
- Legacy exceptions panel renders the Lucknow self-approval with the
  `self-approved own trip to …` summary.

### Constraints honoured
- No existing DB rows deleted.
- No mock/demo/sample business data added.
- No simulated bookings or availability.
- Approval, cancellation, booking and reporting workflows preserved end-to-end.
- Passwords, session tokens and activation tokens are never written to logs
  (login/logout audit entries only record user id, ip, user-agent).

## 13. Issue 5 — Estimated-cost integrity (2026-11-04)

Goal: an unknown travel cost must never be rendered or summed as zero.

- Schema: `TripRequest.estimatedCost` is now `Float?`. Applied additively via
  `prisma db push` after validating against a scratchpad copy; no rows were
  reset. Historical rows that stored `0` with `estimateIsComplete=false` are
  preserved as-is and interpreted as "unknown" by every consumer.
- Write paths (`app/api/trips/[id]/plan/route.ts`,
  `app/api/trips/[id]/route.ts`, `app/api/slack/route.ts`): write `null` when
  the total is unknown. The previous `total ?? 0` coercion is gone.
- Read paths: single source of truth in `lib/currency.ts`:
  - `tripCostOrUnknown({ estimatedCost, estimateIsComplete })` returns the
    numeric amount only when both the estimate is complete AND the stored
    value is a finite non-null number; otherwise `null`.
  - `formatTripCost(...)` renders the money or the standard message
    `UNKNOWN_COST_MESSAGE`.
- Dashboard, trips list, approvals, manager/team, admin, history, trip
  detail hero, Slack `tripSummaryText` and AI chat/compare contexts all call
  one of the helpers and surface the unavailable state explicitly instead of
  rendering a fabricated zero.
- `lib/reports.ts`: numeric sums (`estimatedSpend`, `spendByCurrency`,
  per-destination / per-employee / per-month breakdowns) exclude unknown
  costs. A new `missingCosts` field (and matching per-bucket counts +
  `missingCostsByCurrency`) tells the UI how many trips were held out.
  Admin reports page shows "+ N missing" next to grouped spend and a
  "N trips excluded — cost unavailable" line under the aggregate stat.

## 14. Issue 6 — Travel search reliability (2026-11-04)

- Price classification (`lib/search.ts`, `PriceType`):
  - `listed`      — parsed from a public listing / snippet.
  - `indicative`  — source hinted at indicative language (`from`,
    `starting at`, `about`, `approx`, `average`, …) OR the amount was
    converted into the trip currency via live FX.
  - `verified`    — ONLY emitted when a travel admin records a real
    provider confirmation reference in `/api/trips/[id]/confirm-booking`.
    The stored candidate blob is patched in-place to preserve the
    search-time snippet alongside the verified state.
  - `unavailable` — no reliable price.
- Availability classification (`AvailabilityStatus`):
  `unverified | available_verified | unavailable_verified`. Tavily listings
  stay `unverified`; Google Maps Routes results stay `unverified`.
- Legacy stored vocabulary maps cleanly at read time
  (`normalizePriceType` / `normalizeAvailabilityStatus`); rows are never
  rewritten.
- Currency (`lib/currency.ts`):
  - Hardcoded static FX fallback table removed.
  - `ensureFx()` returns `FxSnapshot | null`; cache is fresh for 6h,
    acceptable up to a hard 24h staleness ceiling, else `null`.
  - `currentFx()` returns `null` once past the ceiling; `convertCurrency`
    returns `null`; `normalizeMoney` preserves the original amount +
    currency. Every converted candidate carries `rateSource: "live"` and
    `fetchedAt`, so the UI can disclose conversion.
- Every candidate preserves `sourceUrl`, `sourceHostname`, `retrievedAt`,
  original price + currency, price classification, availability
  classification. Results with missing fields are not discarded.
- Frontend badges (`app/trips/[id]/page.tsx` + `app/globals.css`):
  consistent `chip-price-*` / `chip-avail-*` classes across all four
  categories, rendered on both the featured candidate and the alternatives
  list, with an explicit "A search listing is not a booking confirmation."
  disclaimer.


## 15. Phase 1 — permanent test infrastructure (2026-11-04)

**Goal.** Lock down the lifecycle, authorization and CSRF invariants with
tests that run against a real, isolated SQLite DB and real route handlers.

**What runs.**

| Suite | Command | Count |
| --- | --- | --- |
| Unit (`tests/unit/`) | `npm run test` | 61 |
| Integration (`tests/integration/`) | `npm run test` | 6 |
| API handlers (`tests/api/`) | `npm run test` | 11 |
| Security regressions (`tests/security/`) | `npm run test` | 16 |
| Playwright E2E (`tests/e2e/`) | `npm run test:e2e` | 3 |

`npm run test:coverage` writes a v8 HTML+JSON report to `./coverage`.

**Isolation.** `tests/setup/global-setup.ts` runs once per Vitest invocation
and once per Playwright `webServer` boot. It rebuilds `prisma/test.db` from
the real schema with `prisma db push --skip-generate`, seeds one user per
role and the default policy, and asserts `DATABASE_URL` points at `test.db`
before opening Prisma. `tests/setup/test-db.ts` snaps any test-opened
Prisma client onto the same URL at import time. `prisma/dev.db` is never
touched — verified before and after this phase by `stat`.

**Dev identity in tests.** Route handlers call `getCurrentUser()`, which
reads the real session cookie through `next/headers`. The test harness
mocks `next/headers` with a mutable cookie store so one of two modes is
available per call:

- **Dev-identity path** (`callRoute`): empty cookies → `getCurrentUser`
  falls back to `ALLOW_DEV_IDENTITY=1` + `DEV_USER_EMAIL`, which is how
  most API-handler tests drive the handler.
- **Real-session path** (`callRouteWithCookies`): the test inserts a real
  `Session` row and passes `tc_session=<id>.<rawToken>`, so `withApi`
  exercises the full `readSessionFromRequest` → `assertCsrf` path. This is
  how the CSRF regression suite works.

**External services.** The global setup blanks `GROQ_API_KEY`,
`TAVILY_API_KEY`, `GOOGLE_MAPS_API_KEY` and `SLACK_SIGNING_SECRET` so no
test can reach the real providers.

**Playwright server.** Bound to port 3100 with `NEXT_DIST_DIR=.next-e2e` so
the test server coexists with `npm run dev` (port 3000, `.next`). First-time
browser install: `npm run test:e2e:install`.

## 16. Phase 2 — security hardening (2026-11-04)

**Vulnerabilities fixed.**

| # | Vuln | Fix | Regression test |
| --- | --- | --- | --- |
| 1 | `ALLOW_DEV_IDENTITY=1` honored in production → anonymous callers could impersonate any email via `DEV_USER_EMAIL` | New `devIdentityAllowed()` in `lib/auth.ts` returns false when `NODE_ENV === "production"`; `middleware.ts` gates its bypass on the same check | `tests/security/dev-identity.test.ts` (4) |
| 2 | No session rotation on login — a successful password proof did not revoke prior sessions | `app/api/auth/login/route.ts` calls `revokeAllSessionsForUser` before `createSession` | `tests/security/session-lifecycle.test.ts` (1) |
| 3 | Admin deactivation / role change did not revoke the target's existing sessions → they stayed authenticated until TTL | `app/api/admin/users/[id]/route.ts` revokes all sessions inside the same transaction when `active → false` or `role` actually changes | `tests/security/session-lifecycle.test.ts` (3) |
| 4 | No startup validation of required production env vars | `lib/env.ts::assertProductionEnv()` called from `app/layout.tsx`; logs one line per problem in production, no-op in dev | (implicit — only logs) |

**Items audited and left alone (already correct).**

- **Cookie configuration.** `lib/session.ts` sets session cookies with
  `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure` in production.
  The CSRF cookie is intentionally non-HttpOnly (double-submit requires
  the client to echo its value in a header).
- **Session hashing.** Only `sha256(rawToken)` is persisted; a DB leak
  cannot be replayed as a session. Token comparison is timing-safe.
- **CSRF.** `withApi` enforces `assertCsrf` on every non-safe method
  whenever the caller presents a session cookie. Unauthenticated requests
  still hit their route's auth check, which returns 401. All four
  decisions (missing / wrong / correct / revoked-session) were pinned in
  Phase 1's `tests/security/csrf.test.ts`.
- **Authorization matrix.** Every state-changing route under `app/api/`
  calls `getCurrentUser()` and a role predicate (`canManageUsers`,
  `canConfigurePolicy`, `canHandleBookings`, `canApproveAny`,
  `canViewAudit`, `canViewReports`, `canAssignManagers`). Phase 1's
  `tests/security/authorization.test.ts` pins seven of these; the rest
  share the same predicate code paths.
- **Login rate limiting.** DB-backed per-account counter (5 attempts →
  15-minute lockout). Already durable across processes; no changes.
- **Logout + password-change invalidation.** Logout revokes the current
  session row; password change revokes every session for the user before
  minting a fresh one. Covered in `tests/security/session-lifecycle.test.ts`
  for logout; the password-change path shares the same primitive.

**Files modified / added.**

Modified: `lib/auth.ts`, `middleware.ts`, `app/api/auth/login/route.ts`,
`app/api/admin/users/[id]/route.ts`, `app/layout.tsx`.

Added: `lib/env.ts`, `tests/security/dev-identity.test.ts`,
`tests/security/session-lifecycle.test.ts`.

**Remaining limitations.**

- No per-IP throttling at the application layer; recommend a reverse proxy.
- `AuditLog` has no retention policy; operators must prune manually.
- The dev-identity path is still exercised in non-production to keep test
  setup simple.

## 17. Phase 3 — email + Slack delivery (2026-11-04)

**Architecture.** Transactional outbox. A new `NotificationDelivery`
model stores "delivery intent" rows that are inserted in the SAME
transaction as the business change (and the existing in-app `Notification`
row). A separate processor loads committed rows, dispatches via the
configured provider, and marks them `sent` on success or bumps `attempts`
+ `lastError` on failure. A unique `dedupeKey` prevents duplicates on
retry.

Key invariants:

- No external send happens before commit — the processor queries
  committed rows, not in-flight ones.
- A retry of the same business event is rejected at enqueue time by the
  unique `dedupeKey` constraint, so re-fires are safe.
- If no provider is configured, no outbox row is created for that
  channel. In-app `Notification` rows are always created.

**Files added.**

- `lib/mailer.ts` — minimal Resend HTTP client. Exposes
  `__setEmailDispatcherForTests` so tests inject fakes.
- `lib/slack-notify.ts` — outbound Slack. DM via `SLACK_BOT_TOKEN` +
  `User.slackUserId`, else `SLACK_WEBHOOK_URL` for broadcast.
- `lib/notifications.ts` — outbox helpers: `enqueueDeliveriesForEvent`,
  `processOutbox`, `kickOutboxProcessor`.
- `app/api/admin/notifications/process/route.ts` — super-admin drain
  endpoint.
- `tests/integration/outbox.test.ts` — 13 regression tests.

**Files modified.**

- `prisma/schema.prisma` — additive `NotificationDelivery` model.
- `lib/audit.ts` — `notify` / `notifyMany` call `enqueueDeliveriesForEvent`
  when the event type is deliverable. In-app behavior unchanged for the
  non-deliverable types.
- `app/api/trips/[id]/submit/route.ts`,
  `app/api/trips/[id]/book/route.ts`,
  `app/api/trips/[id]/confirm-booking/route.ts`,
  `app/api/trips/[id]/cancellation/route.ts`,
  `app/api/approvals/[id]/route.ts`,
  `app/api/cancellations/[id]/route.ts` — notify calls now carry
  `entityType`/`entityId` so dedupeKey is unique per event; each route
  fires `kickOutboxProcessor()` after commit.
- `tests/setup/test-db.ts` — `resetTripData` clears the new table.
- `.env.example`, `README.md`, `WORKING.md`.

**Environment.** `RESEND_API_KEY`, `EMAIL_FROM`, `SLACK_BOT_TOKEN`,
`SLACK_WEBHOOK_URL`, `APP_BASE_URL`. All optional; the app degrades to
in-app-only when they are unset.

**Known limitations.**

- SQLite is used in dev; the processor's in-process lock is per Node
  instance. For Postgres/HA, swap in `SELECT … FOR UPDATE SKIP LOCKED`.
- `kickOutboxProcessor` is fire-and-forget; in serverless environments a
  cold shutdown may kill the drain. Pair with an external scheduler
  hitting `/api/admin/notifications/process`.
- Slack DMs require `SLACK_BOT_TOKEN` + a linked `User.slackUserId`.
  Without those, Slack falls back to the webhook channel (good for admin
  events, less useful for per-user notifications).

## 18. Phase 4 — SQLite → PostgreSQL migration (2026-11-04)

**Audit summary.** The only SQLite-specific pieces found were (1) the
`provider = "sqlite"` literal in `prisma/schema.prisma`, (2) a raw
`SELECT … FROM Approval` / `FROM Booking` orphan check in `lib/health.ts`
that relied on SQLite's case-insensitive unquoted identifier handling,
and (3) the test harness that hardcodes the `test.db` file. The schema
itself uses only portable scalar types (`String`, `Int`, `Float`,
`Boolean`, `DateTime`) and is fully additive. No `AUTOINCREMENT`, no
`PRAGMA`, no `createMany({ skipDuplicates })` reliance on Postgres
features. Issue 5's nullable `estimatedCost` and Issue 6's currency
normalisation translate 1:1 to Postgres.

**Dual-schema architecture.**

- `prisma/schema.prisma` — SQLite, default output `@prisma/client`,
  used by `npm run dev` and the Vitest/Playwright test harness.
- `prisma/schema.postgres.prisma` — PostgreSQL, output
  `@prisma/client-postgres`, migration history under
  `prisma/migrations/` (initial migration `20261104173109_init` applied
  to the local `travel_agent_pg` database).
- Model bodies are kept identical; the two schemas differ only in the
  `datasource db` provider and the generator's `output` path.

**SQLite-specific code fixes.**

- `lib/health.ts` — rewrote the orphan raw SQL with double-quoted
  identifiers so it matches Prisma's generated table names on both
  dialects (`"Approval"`, `"Booking"`, `"TripRequest"`, `"tripRequestId"`).
  The `Database` check now reports the live provider name.
- `prisma/schema.prisma` header comment points at the Postgres variant.
- `.gitignore` now excludes `prisma/test.db*` and `prisma/backup/`.

**Data migration utility.**
`prisma/migrate-sqlite-to-postgres.ts` (invoked via
`npm run db:migrate:from-sqlite`):

- Opens the SQLite source with `@prisma/client` and the Postgres
  destination with `@prisma/client-postgres` in the same Node process.
- Backs `dev.db` (plus any sibling `-wal`/`-shm`/`-journal`) up to
  `prisma/backup/dev-<iso>.db` before the first read.
- Walks every table in FK order (User → TravelPolicy → Session →
  TripRequest → Approval → ApprovalEvent → Booking →
  CancellationRequest → Notification → NotificationDelivery →
  AuditLog). The User self-reference (`managerId`) is reattached in a
  second pass once every row exists.
- Writes via `upsert` keyed on primary id, so every run is
  repeat-safe; a partial previous run converges to the same end state.
- After each table, source and destination counts are compared and the
  utility aborts on mismatch.
- Final cross-check: `LEFT JOIN` over `"Approval"` and `"Booking"`
  against `"TripRequest"` — if either returns orphan rows the utility
  fails.
- `prisma/dev.db` is opened read-only; the real database is never
  mutated.

**Verified migration** (against local `travel_agent_pg`): all 11 tables
match source counts (User 1, TravelPolicy 1, Session 2, TripRequest 7,
Approval 1, ApprovalEvent 0, Booking 24, CancellationRequest 0,
Notification 0, NotificationDelivery 0, AuditLog 12 — 49 rows total,
zero orphans). Second invocation produces the same counts (idempotent).
`prisma/dev.db` mtime unchanged.

**Postgres concurrency + integrity test suite.**
`tests/integration/postgres-concurrency.test.ts` (opt-in on
`POSTGRES_TEST_URL`) covers:

1. CRUD + nullable `estimatedCost` + timestamp round-trip.
2. `NotificationDelivery.dedupeKey` uniqueness → `P2002` on duplicate.
3. Two parallel pending-approval inserts on the same trip → exactly one
   wins, the other hits `P2002` on `pendingKey`.
4. Concurrent `updateMany` lifecycle guards → exactly one `count === 1`.
5. Transaction rollback drops the `NotificationDelivery` row (the
   commit-before-send invariant survives Postgres MVCC).
6. `SELECT … FOR UPDATE SKIP LOCKED` hides a locked row from a parallel
   reader (the primitive the HA outbox drainer would use).

All six tests pass against the local `travel_agent_pg_test` database.

**Files added.**

- `prisma/schema.postgres.prisma`
- `prisma/migrations/20261104173109_init/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrate-sqlite-to-postgres.ts`
- `tests/integration/postgres-concurrency.test.ts`
- `prisma/backup/dev-<iso>.db` (snapshot from the first migration run)

**Files modified.**

- `prisma/schema.prisma` — header comment now points at the Postgres
  variant.
- `lib/health.ts` — portable orphan query + dynamic provider label.
- `package.json` — new scripts `db:pg:generate`, `db:pg:migrate`,
  `db:pg:migrate:deploy`, `db:pg:push`, `db:migrate:from-sqlite`.
- `.env.example` — Postgres `DATABASE_URL` example + migration recipe.
- `.gitignore` — excludes `prisma/test.db*` and `prisma/backup/`.
- `README.md` — expanded "Switching to Postgres" section.
- `WORKING.md` — phase 4 snapshot.

**Verification results (2026-11-04).**

- `npm run test` — 116/116 pass (Postgres suite skipped).
- `POSTGRES_TEST_URL=… npm run test` — **122/122 pass** (adds 6
  Postgres concurrency tests).
- `npm run test:e2e` — 3/3 pass.
- `npx prisma validate` — both schemas valid.
- `DATABASE_URL=postgres://… npx prisma validate --schema=prisma/schema.postgres.prisma` — valid.
- `npx tsc --noEmit` — clean.
- `npx next build` — clean (isolated dist dir, removed after).
- `prisma/dev.db` byte count and mtime unchanged.

**Known limitations carried into Phase 5.**

- `lib/db.ts` still imports the SQLite `@prisma/client`. Production
  deployments pointing at Postgres should either (a) swap the import to
  `@prisma/client-postgres`, or (b) make `prisma/schema.prisma` the
  postgres schema via CI. The current app runs against SQLite
  end-to-end in dev + tests; the Postgres path is production-only.
- The outbox drainer still uses the per-Node JS lock. The Postgres
  concurrency tests prove `FOR UPDATE SKIP LOCKED` is available; the
  actual swap in `lib/notifications.ts::processOutbox` is deferred.
- `.env`'s `DATABASE_URL` holds exactly one URL at a time. CI pipelines
  that need both must set the Postgres URL per job.
- Data migration is one-way (SQLite → Postgres). A rollback workflow
  would need a sibling script; the backup file is sufficient for
  recovery.

## 19. Phase 5 — Search intelligence improvements (2026-11-04)

**Audit summary.** Real search runs through Tavily (`lib/search.ts`) +
Google Maps Routes for cabs, with `lib/ranking.ts` doing dedupe, price
validation, duration parsing, source reliability and freshness. The
featured picker and the AI prompts (`lib/ai.ts`) reduced that to one
heuristic — a substring match of the destination — which meant:

- A "Bengaluru to Mumbai" listing could be featured for a Mumbai →
  Bengaluru trip (the reverse-direction return leg looked identical to
  substring matching).
- No date relevance signal: a listing dated six months off was free to
  rank first if it was cheap.
- Freshness was one hard 2h flag with no tiering.
- Indian-domain sources appeared in `include_domains` but never
  received any ranking preference for domestic India trips.
- The AI prompts said "reason only over evidence" without exposing the
  evidence quality to the model.

Everything else in the pipeline (price classification, availability
classification, currency conversion, source/retrievedAt preservation,
price-bound clamping, dedupe) was already sound and is left alone.

**Improvements implemented.**

Direction matching (`detectDirection`): finds origin + destination
tokens in the snippet and compares their positions. Origin before
destination → `match`; destination before origin → `reversed`; one
missing → `unknown`. The hotel ranker passes `origin=undefined` since
a hotel listing never carries a route.

Date relevance (`detectDateMatch`): parses ISO (`YYYY-MM-DD`),
`D Month YYYY`, `Month D, YYYY` and US slash forms out of the snippet
and compares each parsed date against the trip's depart date (±3-day
window). Silence stays `unknown`; a named out-of-window date is
`mismatch`. The current calendar year is assumed when the year is
omitted.

Freshness tiers (`freshnessTier`): `fresh` <30 min, `aging` 30 min – 2 h,
`stale` >2 h. The existing `isStale` boolean is still exposed for
backward compatibility.

Indian-source ranking boost: when `tripCurrency === "INR"`, candidates
on a known Indian host (IRCTC, Ixigo, MakeMyTrip, Goibibo, Cleartrip,
OYO, Ola, Rapido, …) get a small reliability bonus (+8, capped at 100).
Non-Indian sources are never hidden; the boost affects ordering only.

Match confidence (`matchConfidenceFor`): combines direction + date +
reliability + freshness into `high | medium | low`. A `reversed`
direction or a `mismatch` date forces `low`. An AI prompt now sees
`confidence=low` alongside `direction=reversed` or `date=mismatch` so
it can caveat the claim rather than quote it as fact.

Featured picker (`pickFeaturedRanked`): never features a reversed
result when a non-reversed alternative exists; prefers direction-match
+ priced; falls back through direction-match, then priced, then first.
`lib/ai.ts::planTrip` now uses this picker instead of the inline
substring heuristic. `lib/search.ts::pickFeatured` also takes an
optional `{origin, destination}` so legacy callers get the same
behaviour.

Category-specific query improvements: `searchFlights` now includes
`"1 adult"` (overridable via `q.passengers`); `searchHotels` includes
`"1 guest 1 room"` (overridable via `q.guests` / `q.rooms`). Indian
domain prioritisation on train and hotel queries was already correct.

Rank scoring reweight: direction (18%) and date (12%) become
first-class signals; price (22%), policy (15%), reliability (15%),
duration (10%), freshness (8%) retained; policy ordering unchanged on
identical inputs — `tests/unit/ranking.test.ts` continues to pass.

AI prompts: `rationalize` and `compare` explicitly instruct the model
to call out `confidence=low`, `direction=reversed` and `date=mismatch`
as caveats, and to treat `unknown` as "evidence is silent", never as
"wrong". `describeFeatured` now emits `confidence`, `direction`,
`date`, `freshness` for every featured candidate.

**Critical rules preserved.**

- Tavily snippets never produce `priceType=verified` — unchanged.
- Missing prices stay `null` / `priceType=unavailable` — unchanged;
  new signals follow the same "unknown stays unknown" rule.
- FX conversion contract unchanged: when the live rate is unavailable
  the original currency is preserved.
- Cross-source dedupe is deliberately not changed. A regression test
  (`preserves source attribution across different hostnames`) pins
  that Expedia and Kayak listings for the same flight stay as two
  rows so each provider is cited and no attribution is lost.
- Availability classification contract unchanged: Tavily listings stay
  `unverified`; only a travel-admin confirmation writes
  `available_verified`.

**Files modified.**

- `lib/ranking.ts` — new helpers (`detectDirection`, `detectDateMatch`,
  `freshnessTier`, `pickFeaturedRanked`), new per-candidate fields
  (`freshness`, `directionMatch`, `dateMatch`, `matchConfidence`),
  rescored `rankCategory` with the new signals and an INR boost.
- `lib/search.ts` — `FlightQuery.passengers`, `HotelQuery.guests` /
  `rooms`, improved queries, `pickFeatured` accepts `{origin,
  destination}` for a direction preference.
- `lib/ai.ts` — `planTrip` wires the context through `rankCategory`
  and features via `pickFeaturedRanked`; `describeFeatured` carries
  confidence / direction / date / freshness; `rationalize` and
  `compare` prompts explicitly reason over those signals.

**Files added.**

- `tests/unit/search-intelligence.test.ts` — 22 regression tests
  covering direction detection (match / reversed / unknown-on-silence),
  date relevance (ISO, "D Month YYYY", "Month D YYYY", out-of-window,
  unknown), freshness tiers, match-confidence combinations, Indian-
  source boost scoped to INR trips, no-cross-source-merge, null-price
  preservation, stale flag in rank reasons, featured picker preferring
  direction-match, featured picker never surfacing a reversed result
  when a non-reversed alternative exists, and the plain-Candidate
  picker's direction preference.

**Verification results (2026-11-04).**

- `npx tsc --noEmit` — clean.
- `npx prisma validate` + Postgres schema — both valid.
- `npm run test` — **122/122 pass** on SQLite (6 Postgres suite tests
  skipped), **144/144 pass** with `POSTGRES_TEST_URL` set (adds 22
  Phase 5 unit tests + 6 Postgres concurrency tests on top of Phase
  3/4 baseline of 116).
- `npm run test:e2e` — 3/3 pass.
- `npx next build` — clean (isolated `.next-verify`).

**Remaining limitations carried into Phase 6.**

- Date extraction handles ISO, long-month and US slash forms but not
  locale-specific formats (e.g., "lundi 1 février 2027"). Snippets in
  those formats fall through to `date=unknown`, which is safe.
- Direction detection is substring-based on the city name. Airports
  are recognised only when the snippet spells the city out (e.g.,
  "DEL to BLR" does not match "Delhi" / "Bengaluru"). The ranker falls
  through to `direction=unknown` — safe, but a future phase could add
  an IATA → city dictionary.
- Cross-source identity is still not modelled. Phase 5 preserves
  attribution; a future phase could introduce an opt-in
  "alternateSources" surface for the UI without collapsing rows.
- The match-confidence weights (`0.22 / 0.15 / 0.10 / 0.15 / 0.08 /
  0.18 / 0.12`) are hand-tuned; no production telemetry yet.
