# What's Working Right Now

Snapshot of the Travel Agent project as of **2026-11-04** (four-role release;
Issue 5 estimated-cost integrity + Issue 6 travel-search reliability shipped
in this snapshot).

> This project contains **no mock, demo, sample or seeded business data**. The only
> account is the local identity configured in `.env`, and the only other seeded
> record is the travel policy. See `AGENTS.md`.

---

## Current state

| Item | Value |
|---|---|
| App | Next.js 15.0.3 (App Router), React 19 RC, TypeScript, Tailwind |
| Database | SQLite via Prisma (`prisma/dev.db`) — schema applied additively, no reset |
| Roles | `employee`, `manager`, `travel_admin`, `super_admin` |
| AI | Groq (`GROQ_MODEL`, default `llama-3.3-70b-versatile`) |
| Web search | Tavily |
| Place suggestions | Open-Meteo geocoding (GeoNames data) |
| Optional routing | Google Maps Routes API for cab distance/duration |
| Local account | `rgl@localhost` — `super_admin`, active |
| Travel policy | INR — flight ₹1,00,000 · hotel ₹25,000/night · trip ₹3,32,000 · approval above ₹1,24,500 · 7 advance days |
| Real records | 1 user · 4 trips · 1 approval · 24 bookings · 1 policy · 0 cancellations |
| Dev server | Running on port `3000` (`npm run dev`, pinned) |

### Schema additions (all additive)

`User.active`, `User.department`, `User.updatedAt`; `TripRequest.submittedAt/decidedAt/bookedAt/cancelledAt`
and indexes; `Approval.rejectionReason/pendingKey/assignedById/assignedAt` plus
`onDelete: Restrict`; new `ApprovalEvent`, `Notification`, `AuditLog`, `CancellationRequest`
models; `Booking.status` extended with `cancelled` plus cancellation fields; `TravelPolicy`
auto-approval, booking-reference and cancellation-review switches; `Approval.isLegacy` (2026-11-04
legacy self-approval marker, additive). Booking lifecycle (2026-11-04): canonical leg states
`pending`/`booked`/`not_required`/`failed`/`cancelled` with legacy aliases.
**2026-11-04 cost-integrity pass:** `TripRequest.estimatedCost` is now
`Float?` (nullable). Existing rows were preserved — a historical `0` with
`estimateIsComplete=false` keeps its stored value and is treated as unknown
by every consumer. New writes store `NULL` when the total is unknown.

### Issue 5 — Estimated cost integrity (2026-11-04)

- `TripRequest.estimatedCost` is nullable; plan, slack and edit routes write
  `null` (never `0`) when a required featured leg has no listed price.
- `tripCostOrUnknown()` and `formatTripCost()` in `lib/currency.ts` are the
  single source of truth for rendering a trip's total. Historical rows with
  `estimatedCost=0, estimateIsComplete=false` render as
  "Total cost unavailable — some prices are missing."
- Operational report (`lib/reports.ts`): numeric totals (`estimatedSpend`,
  `spendByCurrency`, per-destination / per-employee / per-month breakdowns)
  exclude unknown costs. A new `missingCosts` field (both overall and per
  bucket) surfaces how many trips were excluded. Totals never cross
  currencies.
- Dashboard, trips list, approvals, manager/team, admin, history, trip
  detail, Slack messages and AI chat/compare contexts all surface the
  unavailable state explicitly.

### Issue 6 — Travel search reliability (2026-11-04)

- `PriceType`: `listed | indicative | verified | unavailable`. Tavily
  snippets emit `listed` (or `indicative` when the source says "from /
  starting at / about / approx / average") and never `verified`. A converted
  amount becomes `indicative` and preserves `originalPrice` + `originalCurrency`.
  `verified` is emitted only when a travel admin records a real provider
  confirmation reference (`/api/trips/[id]/confirm-booking` patches the
  stored candidate blob).
- `AvailabilityStatus`: `unverified | available_verified | unavailable_verified`.
  Tavily listings stay `unverified`; Google Maps Routes results stay
  `unverified` (the route exists, the ride does not). `available_verified` is
  written on travel-admin confirmation.
- Legacy stored vocabulary (`estimate`, `quote`, `listed` availability,
  `unavailable` availability) is normalised at read time by
  `normalizePriceType` / `normalizeAvailabilityStatus`. Stored rows are not
  rewritten.
- Currency (`lib/currency.ts`): the static hardcoded FX fallback table is
  gone. `ensureFx()` fetches live rates (open.er-api.com) with a 6h TTL and
  a hard 24h staleness ceiling. Stale beyond 24h → `currentFx()` returns
  `null` → `convertCurrency` returns `null` → `normalizeMoney` preserves the
  original currency. Nothing is silently stale, nothing is fabricated.
- Every candidate carries `sourceUrl`, `sourceHostname`, `retrievedAt`,
  original price + currency, price classification and availability
  classification. Results with missing fields are not discarded.
- Frontend badges (`app/trips/[id]/page.tsx`): Listed / Indicative / Verified /
  Price unavailable + Availability unverified / Availability confirmed /
  Confirmed unavailable, rendered on every candidate card across the four
  categories, with an explicit "A search listing is not a booking
  confirmation." disclaimer.

---

## Verified in this snapshot

- `npx prisma validate` — schema valid.
- `npx tsc --noEmit` — passes (also fixed a pre-existing stray leading `y`
  in `app/admin/users/UserRow.tsx` that was blocking the typecheck).
- `npx next build` — passes (production build, all routes compiled, isolated
  `.next-verify` dist dir removed after).
- Issue 5 / Issue 6 scenario suite — 16/16 pass against a scratchpad DB copy
  (`prisma/dev.db` untouched):
  1. Missing flight price stays `null`.
  2. Historical `0 + estimateIsComplete=false` is treated as unknown by
     `tripCostOrUnknown` / `formatTripCost`.
  3. Real `0` with `estimateIsComplete=true` survives as a real zero.
  4. Mixed currencies: FX miss preserves the original currency.
  5. Unknown currency returns `null` — no silent conversion.
  6. `ensureFx()` never returns a static fallback — only `live` or `null`.
  7. Same-currency normalisation preserves `priceType`.
  8. Tavily snippets are never classified as `verified`.
  9. Missing price → `priceType: "unavailable"`, availability stays
     `unverified`.
  10. Legacy `estimate` priceType maps to `indicative`; legacy `listed`
      availability maps to `unverified`; legacy `unavailable` availability
      maps to `unavailable_verified`.
  11. Report aggregator produces totals without throwing, tracks
      `incompleteEstimates` separately, and the reported `estimatedSpend`
      matches a hand-recomputed known-only sum (42,617 INR against seven
      stored rows).
- Every role page returns `200`: employee (`/`, `/trips`, `/bookings`, `/history`,
  `/notifications`, `/profile`), manager (`/manager`, `/approvals`, `/team`), travel admin
  (`/admin`, `/admin/bookings`, `/admin/cancellations`, `/admin/employees`, `/admin/reports`),
  super admin (`/admin/users`, `/admin/policy`, `/admin/audit`, `/admin/health`).
- Every API endpoint in the API surface returns a role-appropriate status; the real database
  was not modified by verification.

### Workflow verification (temporary DB copy with controlled identities)

- **Employee (A):** created a real Mumbai → Bengaluru request, planned against live
  Tavily/Groq search (complete estimate, INR), submitted → routed to the assigned manager;
  duplicate submit idempotent; self-approval `403`.
- **Manager (B):** assigned inbox only; trip detail visible; rejection without a reason `400`;
  change request returned the trip to `draft` and preserved history; resubmission created a
  new approval; approval recorded; duplicate and superseded decisions `409`; policy patch `403`.
- **Travel admin (C):** generated 12 real provider links; confirmation without a reference
  `400`; first leg → `booking_pending_confirmation`; duplicate confirmation `409`; all legs →
  `booked`; cancellation request left bookings untouched; rejection returned the trip to
  `booked`; verified completion with a reference → `cancelled` and all 12 booking rows
  cancelled.
- **Super admin (D):** created an account, assigned role + reporting manager, deactivated and
  reactivated it, updated policy, read audit/health/reports. Guards: self-deactivation `409`,
  self role change `409`, last-active-super-admin protection, deactivation blocked while the
  account holds a pending approval.
- **Security (E):** cross-trip access `403`; employee approval `403`; employee confirm-booking
  `403`; employee admin endpoints `403`; self-role escalation rejected; manager unassigned
  approval `403`; manager policy `403`; travel admin audit/health `403`; plan after submit
  `409`; book before approval `409`; no-approver submission `409` with actionable guidance.
- **Reassignment:** travel admin moved a pending approval; event recorded; the new approver
  decided it; the previous approver could then be deactivated.

### 2026-11-04 layout pass

- Root layout: `main` no longer uses `max-w-7xl mx-auto`. The new `app-main` shell fills the
  space beside the fixed sidebar (CSS variables `--sidebar-w`, `--sidebar-gap`,
  `--shell-gutter`), so content now uses roughly 90–95% of the available width with even
  gutters instead of large empty margins.
- `app/globals.css` additions: `.app-main` (responsive gutters), `.stat-tile` (uniform metric
  tiles), `.table-scroll` (horizontal scrolling with styled scrollbar), table left/right edge
  padding aligned with card headers, `vertical-align: middle`, `min-width: 0` on grid children,
  `white-space: nowrap` on buttons, hidden mobile nav scrollbar.
- Normalized spacing across dashboards and pages: `space-y-6` page columns, `gap-4` metric
  grids, `gap-6` content grids, `px-5 py-4 sm:px-6` list headers, `px-6 py-14` empty states,
  full-width itinerary grid (removed the `lg:w-4/5` centered wrapper).
- Verified: `npx tsc --noEmit`, `next build`, and all pages return `200`. No browser was
  available in this environment, so responsive rendering was checked by CSS breakpoints and
  markup rather than screenshots.

### Dev-server rule (kept)

`npm run dev` is pinned to port 3000. A second start fails with `EADDRINUSE` instead of
falling back to another port and sharing `.next`. Parallel verification servers used
`NEXT_DIST_DIR` (isolated build directories) and were stopped afterwards.

---

## 2026-11-04 issue work (this session)

- **Issue 1 — booking lifecycle redesign:** canonical booking leg states
  (`pending`, `booked`, `not_required`, `failed`, `cancelled`) in `lib/booking.ts`, with legacy
  aliases (`link_only -> pending`, `manually_confirmed -> booked`); trip becomes `booked` only when
  every required leg is resolved; endpoints `POST /api/trips/[id]/requirements` and
  `POST /api/bookings/[id]/failure`; confirm/book/cancel transitions updated. P0 pass fixed a TDZ
  bug in `app/api/trips/[id]/book/route.ts` so `not_required` markers filter the alternates
  correctly, and `prisma/normalize-booking-states.ts` renamed the 24 existing `link_only` rows to
  `pending` (idempotent, no deletes).
- **Issue 2 — reports crash:** `lib/reports.ts` now returns `spendByCurrency` per grouping
  (destinations/months/employees). `app/admin/reports/page.tsx` renders a `formatSpend` helper
  that lists each currency separately; empty groupings render `—`.
- **Issue 3 — real auth:** session-cookie auth (`tc_session` HttpOnly + SameSite=Lax + Secure in
  prod) + double-submit CSRF (`tc_csrf`). `Session` model stores `sha256(rawToken)`; rotation on
  logout and password change. `lib/password.ts` (scrypt) is the hashing primitive.
  `/login`, `/activate`, `/api/auth/{login,logout,me,activate,change-password}`,
  super-admin-only `/api/admin/users/[id]/reset-password`. `middleware.ts` redirects
  unauthenticated page requests to `/login`. `getCurrentUser()` reads the session; falls back to
  `DEV_USER_EMAIL` only when `ALLOW_DEV_IDENTITY=1`. Failed-login lockout at 5 attempts for 15
  minutes. The existing user was given a password via `DEV_USER_PASSWORD` on seed.
- **Issue 4 — legacy self-approval:** `Approval.isLegacy` added, the existing self-approval
  (`cmw1rlexn…` to Lucknow) is flagged. Super-admin audit page gains a *Legacy exceptions* panel.
  `prisma/mark-legacy-self-approvals.ts` runs defensively (idempotent, no deletes).

## Phase 1 — automated test infrastructure (2026-11-04)

- Vitest 2.1 drives unit, integration, API-handler and security-regression suites via
  `npm run test` / `npm run test:watch` / `npm run test:coverage`.
  - Unit: `tests/unit/{policy,booking,currency,cost,ranking,search}.test.ts`.
  - Integration: `tests/integration/approvals.test.ts`.
  - API route handlers: `tests/api/{trips-create,submit-approve,cancellation}.test.ts`.
  - Security regressions: `tests/security/{authorization,csrf}.test.ts`.
- Playwright 1.64 drives browser E2E via `npm run test:e2e`.
  - Browser install: `npm run test:e2e:install` (one-time, Chrome Headless Shell).
  - Specs live in `tests/e2e/` and are excluded from Vitest collection.
  - Dev server is pinned to port 3100 with `NEXT_DIST_DIR=.next-e2e` so it can run
    beside `npm run dev` on port 3000 without a route-manifest collision.
- Database isolation. `tests/setup/global-setup.ts` provisions a fresh
  `prisma/test.db`, applies the real schema with `prisma db push --skip-generate`,
  and seeds the minimum rows (one user per role + the default policy).
  - The script asserts `DATABASE_URL` ends with `test.db` before running Prisma
    and refuses to execute otherwise, so a mis-pointed env can never destroy
    `prisma/dev.db`.
  - `tests/setup/test-db.ts` likewise forces Prisma clients opened from tests
    onto the test DB URL at import time.
  - Vitest runs `pool: "forks"` with `singleFork: true` so SQLite is never hit
    concurrently from multiple workers.
- Dev identity. Route handlers resolve `getCurrentUser()` via the
  `ALLOW_DEV_IDENTITY=1` + `DEV_USER_EMAIL=<address>` path during tests, which
  avoids faking signed session cookies. The CSRF suite instead creates real
  `Session` rows and drives the full `withApi` → `assertCsrf` path.
- External providers (Groq, Tavily, Google Maps, Slack) are blanked in the test
  environment so a leaked key cannot cause a network call during CI.

## Phase 2 — security hardening (2026-11-04)

Four vulnerabilities fixed, with regression tests pinning each one:

1. **Dev-identity fallback honored in production.** `lib/auth.ts` previously
   accepted `ALLOW_DEV_IDENTITY=1` + `DEV_USER_EMAIL=<x>` on any
   `NODE_ENV`. A misconfigured production env would have let any anonymous
   caller impersonate an account whose email they could guess. Fixed by a
   new `devIdentityAllowed()` guard that returns false when
   `NODE_ENV === "production"`; the middleware's dev-identity bypass is
   gated on the same check. Covered by `tests/security/dev-identity.test.ts`
   (4 tests).
2. **No session rotation on login.** A successful password proof now revokes
   every pre-existing session for the account before minting a fresh one
   (`app/api/auth/login/route.ts`). A leaked or forgotten cookie stops
   working the moment the real user signs in. Covered by
   `tests/security/session-lifecycle.test.ts`.
3. **Admin deactivation / role change did not revoke sessions.** Admin
   PATCH on `/api/admin/users/[id]` previously flipped `active` or `role`
   but left the target's current cookie usable until TTL. Now the same
   transaction revokes every non-revoked session when `active` flips to
   false or `role` changes, while cosmetic edits (name, department, Slack
   id, manager reassignment) leave sessions alone. Covered by three tests
   in `tests/security/session-lifecycle.test.ts`.
4. **No startup validation of production env.** Added `lib/env.ts` with
   `assertProductionEnv()` — called on cold boot from `app/layout.tsx`. In
   production it logs one line per problem (missing `DATABASE_URL`,
   `DATABASE_URL` pointing at `prisma/test.db`, `ALLOW_DEV_IDENTITY=1`
   leaking into the env, `DEV_USER_EMAIL` set). It is a no-op in dev.

**Audit-trail scope.** `recordAudit` is already called for every
state-changing admin action (user update, policy update, booking confirm,
cancellation, login/logout, password change). Retention is unbounded — the
app never deletes `AuditLog` rows. Operators can prune by date at the DB
layer if the table grows too large.

**Rate limiting.** Login is already protected by a DB-backed per-account
counter (`User.failedLoginAttempts` + `User.lockedUntil`, 5 attempts →
15-minute lockout). This is durable across processes and restarts — there
is no process-local counter to migrate. Per-IP rate limiting is out of
scope; an ingress/reverse proxy is the right place for it.

**Known gaps carried forward.**
- No per-IP throttling at the application layer.
- `AuditLog` has no retention policy.
- The dev-identity path still exists for local development; production is
  the only enforced gate.

## Phase 3 — email + Slack delivery (2026-11-04)

Notifications now go out as real email (Resend) and Slack messages, in
addition to the existing in-app Notification feed. A transactional outbox
(`NotificationDelivery` model + `lib/notifications.ts`) guarantees:

- **Commit-before-send.** The outbox row is created inside the same
  transaction as the business change, so a rollback cleans up the intent
  and the dispatcher never sends for a failed operation.
- **Idempotent retries.** Each delivery row has a unique
  `dedupeKey = "<channel>:<eventType>:<entityType>:<entityId>:<userId>"`.
  A business retry that re-emits the same event is a no-op at enqueue time;
  a transient provider failure keeps the row `pending` and the next drain
  retries the SAME row (never a duplicate send).
- **Bounded retries.** After five failed attempts the row flips to
  `failed` with `lastError` recorded; operators see it on the dashboard
  and can inspect/manually resend.
- **In-app always works.** If `RESEND_API_KEY` / `SLACK_WEBHOOK_URL` /
  `SLACK_BOT_TOKEN` are unset, no outbox row is created for that channel
  — only the in-app Notification row exists. Nothing is ever claimed sent
  that wasn't sent.

### Events wired up
| Event | Trigger | Recipient | Channels |
| --- | --- | --- | --- |
| `approval_assigned` | `POST /api/trips/:id/submit` → human-approval path | Resolved approver | email + slack |
| `trip_approved` | `POST /api/approvals/:id` approved; also auto-approve on submit | Requester | email + slack |
| `trip_rejected` | `POST /api/approvals/:id` rejected | Requester | email + slack |
| `trip_changes_requested` | `POST /api/approvals/:id` changes_requested | Requester | email + slack |
| `trip_ready_for_booking` | After approval | All active travel admins + super admins | email + slack |
| `booking_links_ready` | `POST /api/trips/:id/book` by an admin | Requester | email + slack |
| `booking_confirmed` | `POST /api/trips/:id/confirm-booking` | Requester | email + slack |
| `cancellation_requested` | `POST /api/trips/:id/cancellation` | All travel admins | email + slack |
| `trip_cancelled` | `POST /api/cancellations/:id` with verified reference | Requester | email + slack |

### Dispatcher trigger
- In-request: each state-changing route calls `kickOutboxProcessor()`
  after the transaction commits. The kick is non-blocking.
- Operator-driven: `POST /api/admin/notifications/process`
  (super-admin only) drains up to 100 rows per call. Pair with an
  external scheduler for a guaranteed sweep.
- Suppressed under `NODE_ENV=test` so tests can control dispatch timing.

### Environment
- `RESEND_API_KEY`, `EMAIL_FROM` — Resend configuration.
- `SLACK_BOT_TOKEN` — enables DM to the recipient's `User.slackUserId`
  via `chat.postMessage`.
- `SLACK_WEBHOOK_URL` — enables workspace-channel broadcast fallback.
- `APP_BASE_URL` — absolute base URL embedded in outbound links.

### Known limitations
- The in-process `processing` lock means two Node instances can both drain
  the outbox simultaneously. SQLite serializes the writes, so the worst
  case is one row's `attempts` being bumped twice before a success — still
  idempotent. For Postgres/HA deployments, a `SELECT … FOR UPDATE SKIP
  LOCKED` processor would be the next step.
- `kickOutboxProcessor` is fire-and-forget; in serverless environments
  the function may be killed before the drain finishes. Pair with the
  admin endpoint on a scheduler.
- `AuditLog` retention remains unbounded (as in Phase 2).

## Phase 4 — SQLite → PostgreSQL migration (2026-11-04)

The app now ships a production-grade PostgreSQL path alongside the
SQLite dev default.

- **Dual schema.** `prisma/schema.prisma` (SQLite) and
  `prisma/schema.postgres.prisma` (PostgreSQL). Bodies kept identical;
  only the `datasource db` provider and the generator output path
  differ. Migration history under `prisma/migrations/` (initial:
  `20261104173109_init`).
- **Portable code.** `lib/health.ts` orphan check now uses
  double-quoted identifiers so it runs on both dialects; the health
  banner reports the live provider name.
- **Data migration utility.**
  `npm run db:migrate:from-sqlite` backs `prisma/dev.db` up to
  `prisma/backup/dev-<iso>.db`, walks every table in FK order, upserts
  into Postgres, and aborts on any source/destination count mismatch
  or orphaned FK. Repeat-safe. Verified on the local copy — all 11
  tables matched (49 rows, 0 orphans). `prisma/dev.db` mtime unchanged.
- **Postgres concurrency tests.**
  `tests/integration/postgres-concurrency.test.ts` runs when
  `POSTGRES_TEST_URL` is set and covers: CRUD + nullable + timestamps,
  `NotificationDelivery.dedupeKey` uniqueness (P2002), two parallel
  pending-approval inserts (exactly one wins via `pendingKey`
  uniqueness), concurrent lifecycle `updateMany` (exactly one count=1),
  transaction rollback drops the outbox row, and `SELECT … FOR UPDATE
  SKIP LOCKED` hides a locked row from a parallel reader.
- **Scripts.** `db:pg:generate`, `db:pg:migrate`, `db:pg:migrate:deploy`,
  `db:pg:push`, `db:migrate:from-sqlite`.

Verification (2026-11-04):

- `npm run test` — 116/116 pass with Postgres suite skipped;
  `POSTGRES_TEST_URL=… npm run test` — 122/122 pass.
- `npm run test:e2e` — 3/3 pass.
- `npx prisma validate` — both schemas valid.
- `npx tsc --noEmit` — clean.
- `npx next build` — clean.

## Phase 5 — Search intelligence improvements (2026-11-04)

The planner now reasons over match signals instead of a substring guess.
Every candidate carries verdicts derived strictly from the snippet text.

- **Direction** (`detectDirection`): `match` / `reversed` / `unknown`
  based on origin and destination tokens' order in the snippet.
  Silence stays `unknown`.
- **Date** (`detectDateMatch`): parses ISO, "D Month YYYY" and US-slash
  dates and compares against the trip depart date within a ±3-day
  window. A named date outside the window is `mismatch`; a snippet
  with no parseable date is `unknown`.
- **Freshness** (`freshnessTier`): `fresh` <30 min, `aging` 30 min–2 h,
  `stale` >2 h. The 2 h `isStale` boolean is still exposed.
- **Match confidence** (`high` / `medium` / `low`): combines direction,
  date, reliability, freshness. `reversed` or `mismatch` → `low`.
- **Indian source boost**: when `tripCurrency === "INR"`, candidates
  on IRCTC / Ixigo / MakeMyTrip / Goibibo / Cleartrip / OYO / Ola /
  Rapido / … receive a +8 reliability bonus (capped at 100). Non-Indian
  sources are never hidden.
- **Featured picker** (`pickFeaturedRanked`): never surfaces a reversed
  result when a non-reversed alternative exists; prefers
  direction-match + priced.
- **Queries**: `searchFlights` now includes passenger count ("1 adult"
  default); `searchHotels` includes guest + room count (both
  overridable).
- **AI prompts**: `rationalize` and `compare` instruct the model to
  caveat `confidence=low`, `direction=reversed`, and `date=mismatch`,
  and to treat `unknown` as "evidence is silent".

Critical rules preserved (unchanged): Tavily snippets never emit
`priceType=verified`; missing prices stay `null`; FX conversion keeps
the original currency when live rates are unavailable; availability
classification only becomes `available_verified` on a travel-admin
confirmation; cross-source listings are not merged (Expedia and Kayak
for the same flight remain two attributed rows — pinned by a
regression test).

Added: `tests/unit/search-intelligence.test.ts` — 22 regression tests.
Modified: `lib/ranking.ts`, `lib/search.ts`, `lib/ai.ts`.

Verification (2026-11-04):

- `npm run test` — 122/122 pass (SQLite only); with
  `POSTGRES_TEST_URL` — **144/144 pass**.
- `npm run test:e2e` — 3/3 pass.
- `npx prisma validate` + Postgres schema — both valid.
- `npx tsc --noEmit` — clean.
- `npx next build` — clean.

## Known limitations

- `lib/db.ts` imports the SQLite-generated `@prisma/client`. A
  production deployment on Postgres either imports
  `@prisma/client-postgres` or swaps the schema file via CI. Dev + tests
  stay on SQLite.
- The outbox drainer still uses the per-Node JS lock. The Postgres
  concurrency suite proves `FOR UPDATE SKIP LOCKED` is available; the
  actual swap in `lib/notifications.ts::processOutbox` is deferred.
- Date extraction handles ISO, long-month and US slash forms but not
  locale-specific formats (French / German etc.); those snippets fall
  through to `date=unknown`, which is safe.
- Direction detection matches on spelled-out city names; IATA airport
  codes (DEL, BLR) stay `direction=unknown` and never cause a false
  mismatch. A future phase could add an IATA → city dictionary.

- Manager assignment and role changes are super-admin UI actions, not self-service.
- No ESLint configuration is wired up; linting is still manual.
- No pagination on large admin tables; no distributed rate limiting.
- The flight search can return the reverse direction for a route depending on what the search
  provider indexes; the stored candidate, source and timestamp are always real, but direction
  quality depends on the provider.
