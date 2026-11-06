# Production Audit — Corporate Travel Agent

> **Status note (2026-11-04, four-role release).** This Phase 0 audit predates the role/authorization
> implementation. Fixed since: approval authorization (`SEC-06`), self-role escalation, approver
> validation, state-transition guards, duplicate approvals, transactional decisions, audit logging,
> notifications and cancellation review. Still open by design in this phase: real authentication/SSO
> (`SEC-01` — identity remains `DEV_USER_EMAIL`). See `plan.md` and `WORKING.md` for the current
> state.

**Phase:** 0 (read-only)
**Date:** 2026-11-04
**Scope:** Next.js 15 App Router, React 19 RC, TypeScript, Prisma/SQLite, Groq, Tavily, Google Maps Routes API, Slack slash command.
**Mode:** Audit only. This audit made no application code, schema, migration, seed or configuration changes. Only this document and the three companion audit documents were created.
**Code snapshot:** Line references were verified against the working tree at 2026-11-04 12:22 local. The tree gained one-way-trip support while the audit was being written, so citations reflect that version.

**Companion documents**

- [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) — authN/authZ, validation, secrets, injection and abuse (`SEC-*`).
- [`TEST_COVERAGE.md`](./TEST_COVERAGE.md) — tests actually run, gaps, proposed test plan (`TEST-*`).
- [`PRODUCTION_ROADMAP.md`](./PRODUCTION_ROADMAP.md) — severity/dependency-ordered remediation steps.

Findings are not repeated across documents. Each finding is owned by one document and cross-referenced by ID elsewhere.

---

## 1. Audit evidence

### 1.1 Checks actually run

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit --incremental false` | **Passed**, exit 0 |
| Prisma schema | `npx prisma validate` | **Valid**, exit 0 |
| Test command | `npm run` | **No `test` script exists** |
| Test files | search for `*.test.*`, `*.spec.*`, `playwright.config.*`, `vitest.config.*`, `jest.config.*`, `cypress.config.*` | **None found** |
| Production build | `npm run build` | **Not run** during this audit |
| Lint | `npm run lint` | **Not run** during this audit |
| Automated tests | `npm test` | **Not run** — no test runner is installed or configured |
| Manual E2E walkthrough | `plan.md:228-237` | **Not run** during this audit |

`WORKING.md:30-35` *documents* that `npx tsc --noEmit`, `npm run build` and several HTTP checks passed in an earlier snapshot. Only the two checks marked **Passed/Valid** above were executed for this audit; everything else is reported as **not run**.

### 1.2 Live database inspection

Read-only Prisma/SQLite inspection. The initial snapshot was taken at the start of the audit; final verification was repeated after the working tree changed:

| Fact | Observed value |
|---|---|
| Users | 1 |
| Trips | 1 — a real draft created through the app during final verification (one-way, `returnDate = null`); no trip is seeded |
| Approvals | 0 |
| Bookings | 0 |
| Travel policies | 1 |
| `PRAGMA foreign_keys` through Prisma | `1` |
| `PRAGMA journal_mode` | `delete` |
| `PRAGMA integrity_check` | `ok` |
| Non-unique indexes on foreign keys/statuses | none |
| Unique indexes | `User_email_key`, `User_slackUserId_key`, `TravelPolicy_name_key` |

This matches the no-mock-data policy in `AGENTS.md:5-14`: the only seeded records are the environment-configured local account and the policy. The single trip was created through the app by the local user during final verification, not by `prisma/seed.ts`, and the earlier snapshot had zero trips.

### 1.3 Environment snapshot

- `.env` exists with mode `644`; `prisma/dev.db` exists with mode `644`.
- `.env` contains `DATABASE_URL`, `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_USER_ROLE`, `GROQ_API_KEY`, `GROQ_MODEL`, `SLACK_SIGNING_SECRET`, `TAVILY_API_KEY`.
- `SLACK_SIGNING_SECRET` is set locally. The fail-open behavior described in `SEC-02` still exists when it is unset.
- `INR_PER_USD` is not set, so the code default of `83` applies (`lib/currency.ts:228-231`).
- No `middleware.ts`, no ESLint config, no CI workflow, and no Git repository metadata were present (`git status` returned “not a git repository”).

---

## 2. Executive assessment

**Verdict: not production-ready.** Three blockers are release-stopping on their own:

1. There is no authentication. Every request is executed as the account named by `DEV_USER_EMAIL` (`SEC-01`).
2. Slack signature verification fails open when `SLACK_SIGNING_SECRET` is unset (`SEC-02`).
3. There is no migration history; schema changes are applied with `prisma db push` and the documented SQLite-to-Postgres path has no data migration (`DB-01`).

Beyond those, the approval/booking lifecycle can silently diverge from what an approver approved (`LIFE-01`, `LIFE-02`), cannot reach `booked` honestly without confirming every alternates row (`LIFE-04`), and represents an unknown total as zero (`LIFE-03`).

**Top recommendation:** put the project under version control and stand up CI with a test harness before fixing anything else (`OPS-03`, `TEST-07`, `TEST-01`); the first substantive fix is real authentication (`SEC-01`). Rationale and ordering: [`PRODUCTION_ROADMAP.md:§2.1`](./PRODUCTION_ROADMAP.md:§2.1).

### 2.1 Finding counts

| Document | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Production (this document) | 1 | 10 | 13 | 1 | 25 |
| Security | 2 | 4 | 6 | 0 | 12 |
| Test coverage | 0 | 4 | 4 | 0 | 8 |
| **Total** | **3** | **18** | **23** | **1** | **45** |

### 2.2 Release gates

| Gate | Requirement | Findings |
|---|---|---|
| G0 Identity | Real session-based identity; no env impersonation in production | `SEC-01`, `CFG-01` |
| G0 Slack | Signature verification fails closed | `SEC-02` |
| G0 Data | Versioned migrations, backup/restore proven, Postgres plan rehearsed | `DB-01`, `OPS-01`, `OPS-03` |
| G0 Request integrity | CSRF/origin checks, rate limits, bounded inputs | `SEC-03`, `SEC-04`, `SEC-05` |
| G1 Approval integrity | Re-plan/edit cannot change an approved trip without re-approval | `LIFE-01`, `LIFE-02` |
| G1 Booking integrity | `booked` means the required legs were actually booked | `LIFE-03`, `LIFE-04`, `LIFE-05` |
| G1 Money integrity | Unknown price is not zero; currencies are not mixed | `LIFE-03`, `LIFE-06` |
| G2 Schema | Enums/checks, Decimal money, indexes, JSON validation | `DB-02`…`DB-07` |
| G2 Verification | Automated unit/integration/E2E and CI | `TEST-01`…`TEST-08` |

---

## 3. Architecture

### 3.1 Runtime topology

```text
Browser (RSC pages + client components)
  │
  ├── app/layout.tsx ──► getCurrentUser() ──► env DEV_USER_EMAIL ──► Prisma User
  │
  ├── Pages: /, /trips/new, /trips/[id], /approvals, /admin
  │
  └── Route handlers under app/api/*
        │
        ├── lib/auth.ts        env-based identity + role assertion
        ├── lib/validators.ts  Zod input schemas
        ├── lib/policy.ts      policy flags / approval threshold
        ├── lib/currency.ts    INR/USD selection + hardcoded FX
        ├── lib/ai.ts          Groq planner, chat, Slack field extractor
        ├── lib/search.ts      Tavily + optional Google Routes
        └── lib/db.ts          Prisma singleton
              │
              └── SQLite prisma/dev.db (provider "sqlite")

Slack /travel ──► POST /api/slack ──► lib/slack.ts signature check
                                   └─► Prisma + lib/ai.ts + lib/search.ts

Open-Meteo geocoding ──► GET /api/places/suggest (public)
```

There is no `middleware.ts`. Identity, authorization, body parsing and error mapping are repeated in every page/route rather than enforced at one boundary. This is an architectural multiplier for `SEC-01`, `SEC-03`, `SEC-04` and `SEC-08`; it is not separately counted as a finding to avoid duplication.

### 3.2 Code map

| Layer | Files | Responsibility |
|---|---|---|
| App shell | `app/layout.tsx:14-40`, `components/Sidebar.tsx` | Loads the env-configured user, sidebar, pending badge |
| Dashboard | `app/page.tsx:23-31` | Admin sees all trips; others see their own, newest 20 |
| Create | `app/trips/new/NewTripForm.tsx`, `app/api/trips/route.ts` | Form, place typeahead, draft creation, fire-and-forget planning |
| Detail | `app/trips/[id]/page.tsx`, `TripActions.tsx`, `TripChat.tsx`, `ConfirmBookingForm.tsx` | Itinerary, flags, approvals, links, actions |
| Approvals | `app/approvals/page.tsx`, `ApprovalRow.tsx`, `app/api/approvals/**` | Queue and decisions |
| Admin | `app/admin/page.tsx` | Counts and policy display; admin-only |
| Planning | `app/api/trips/[id]/plan/route.ts`, `lib/ai.ts`, `lib/search.ts` | Real web search, Groq rationale, policy evaluation |
| Submission | `app/api/trips/[id]/submit/route.ts` | Auto-approve or create pending approval |
| Booking links | `app/api/trips/[id]/book/route.ts` | Materialise `Booking` rows with `link_only` |
| Confirmation | `app/api/trips/[id]/confirm-booking/route.ts` | Admin records a real external reference |
| Slack | `app/api/slack/route.ts`, `lib/slack.ts` | Slash command plan/status/approve/reject |
| Places | `app/api/places/suggest/route.ts`, `components/PlaceInput.tsx` | Public Open-Meteo/GeoNames typeahead |
| Persistence | `prisma/schema.prisma`, `lib/db.ts`, `prisma/seed.ts` | Data model and local account/policy seed |

### 3.3 External dependencies and failure behavior

| Dependency | Used by | Failure behavior | Data-policy assessment |
|---|---|---|---|
| Tavily | `lib/search.ts:128-184` | Throws; `runWebSearch` returns `unavailable` with the error text (`lib/search.ts:242-249`); `/plan` returns 503 when all categories fail (`plan/route.ts:37-45`) | No fallback data; correct. Error text exposure tracked as `SEC-08`. |
| Groq | `lib/ai.ts:18-23,59-135,208-291` | Planner rationale is best-effort (`lib/ai.ts:118-123`); chat/extraction throw | No fabricated inventory. Prompt-injection risk tracked as `SEC-07`. |
| Google Maps Routes | `lib/search.ts:392-531` | Returns `unavailable` for cab routing; Tavily fallback | No fabricated fare. |
| Open-Meteo geocoding | `app/api/places/suggest/route.ts:89-151` | Empty list plus `error`; UI keeps free text | Real GeoNames records, no local fallback list. Public endpoint tracked in `SEC-04`. |
| SQLite | `prisma/schema.prisma:7-10` | Single writer, `journal_mode=delete` | Production risk tracked as `DB-01`, `DB-07`. |

---

## 4. Data model and migration risk

### 4.1 Models

| Model | Key fields | Observations |
|---|---|---|
| `User` | `email` unique, `role` string, `managerId`, `slackUserId` unique | Role is unconstrained text (`prisma/schema.prisma:16`); no session/auth fields. |
| `TripRequest` | `status`, `currency`, `estimatedCost Float`, `estimateIsComplete`, `policyFlags` JSON string, `itinerary` JSON string | Status/currency are text (`:36-40`); money is `Float` (`:41`); JSON is unvalidated (`:43-44`). |
| `Approval` | `decision` string, `comment`, `decidedAt` | No unique constraint on `(tripRequestId, approverId)` (`:53-63`). |
| `Booking` | `kind`, `url`, `source`, `status`, `reference`, `confirmedById`, `details` JSON string | `kind`/`status` text (`:73,80`); URL stored without validation (`:75`); no selection/required-leg semantics. |
| `TravelPolicy` | caps as `Float`, `allowedCabins` JSON string | Money as `Float` (`:93-96`); JSON parsed without a guard (`lib/policy.ts:87`). |

### 4.2 Live schema constraints

SQLite contains only the three unique indexes listed in §1.2. There are no indexes on `TripRequest.requesterId`, `TripRequest.status`, `TripRequest.createdAt`, `Approval.approverId`, `Approval.decision`, `Booking.tripRequestId` or `Booking.status`. Common queries scan:

- Home list ordered by `createdAt` (`app/page.tsx:26-31`).
- Admin counts by status (`app/admin/page.tsx:65-70`).
- Approval queue by `approverId` + `decision` (`app/api/approvals/route.ts:10-14`, `app/approvals/page.tsx:20-24`).
- Booking cleanup/count by `tripRequestId` + `status` (`app/api/trips/[id]/book/route.ts:35-37`, `confirm-booking/route.ts:48-53`).

### 4.3 Findings — database and migration

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| DB-01 | Critical | `prisma/schema.prisma:1-10`; `package.json:10-13`; `README.md:99-119`; `plan.md:252`; no `prisma/migrations/` directory | Setup and deployment use `prisma db push` (`package.json:10,13`). There is no migration history. `README.md:107-119` says production is a one-line provider switch plus `npm run setup`. `plan.md:252` records that the dev DB previously had to be reset with `db push` because old rows were incompatible. | `db push` can drop or rewrite columns without a reviewable migration or rollback. Switching SQLite→Postgres has no data-transfer step; `Float`, `DateTime`, case sensitivity and autoincrement behavior differ. A production incident can permanently lose trips, approvals and booking references. | Create a baseline migration with `prisma migrate diff`; commit `prisma/migrations/`; use `prisma migrate deploy` in CI/CD; rehearse a copy of production data on Postgres; take a verified backup before every migration; document a rollback/restore path. | `prisma migrate status` is clean on a fresh DB; a staging restore preserves all row counts and foreign keys; a failed migration can be restored from backup within the agreed RTO. |
| DB-02 | High | `prisma/schema.prisma:16,36-40,59,73,78,80,92` | `role`, `status`, `decision`, `kind`, `currency` and policy `currency` are free-text strings. Nothing at the database level rejects `status = "aproved"` or `role = "admin"`. Application guards compare exact strings (`submit/route.ts:18`, `book/route.ts:18`, `confirm-booking/route.ts:16`). | A bad write or future code path can create an unreachable state. A typo in `status` silently fails every transition guard and leaves the trip stuck. Invalid `role` values deny access but are indistinguishable from deliberate configuration. | Replace with Prisma enums on Postgres, or add `CHECK` constraints for SQLite; mirror the union types in TypeScript; add a data-cleanup migration before adding constraints. | Attempts to insert each invalid value fail at the DB; transition tests enumerate every allowed state; a migration audit finds zero invalid existing rows. |
| DB-03 | Medium | `prisma/schema.prisma:41,77,93-96`; `lib/currency.ts:251-262` | All money is `Float`/`REAL`: trip estimate, booking estimate and four policy caps. Conversion rounds to whole units (`lib/currency.ts:261`). | Binary floating point produces boundary errors (for example a value exactly at a cap comparing greater/less than expected). Repeated conversions and sums accumulate drift; financial values are not exact. | Store money as `Decimal` with a fixed scale, or integer minor units; keep currency alongside; round once at the boundary; migrate existing rows with an explicit scale. | Property tests over boundary values and sums are exact; policy comparisons at the cap are deterministic; migration reports zero precision loss beyond the agreed rounding rule. |
| DB-04 | Medium | `prisma/schema.prisma:27-51,53-63,69-87`; queries at `app/page.tsx:26-31`, `app/admin/page.tsx:65-70`, `app/api/approvals/route.ts:10-14`, `app/api/trips/[id]/book/route.ts:35-37`, `confirm-booking/route.ts:48-53` | No non-unique indexes exist beyond primary keys and the three unique indexes. Every list/count/cleanup query scans its table. | Latency and lock duration grow linearly with trip history. Under SQLite's single writer this increases `SQLITE_BUSY` probability; on Postgres it causes avoidable sequential scans. | Add indexes: `TripRequest(requesterId, createdAt)`, `TripRequest(status)`, `Approval(approverId, decision)`, `Approval(tripRequestId)`, `Booking(tripRequestId, status)`, `Booking(status)`. Review with `EXPLAIN`. | `EXPLAIN QUERY PLAN` shows index use for each named query; load test at expected volume stays within the latency target. |
| DB-05 | Medium | `prisma/schema.prisma:43-45,85,98`; parse sites `lib/policy.ts:87`, `app/trips/[id]/page.tsx:145-146`, `app/api/trips/[id]/book/route.ts:25`, `app/api/trips/[id]/submit/route.ts:29` | `itinerary`, `policyFlags`, `Booking.details` and `TravelPolicy.allowedCabins` are unvalidated JSON strings. Parsing is unguarded; a malformed or older shape throws at request time. | One corrupt row can 500 the trip detail page or block submit/book. A future itinerary shape change silently breaks historical rows. `allowedCabins` corruption breaks every policy evaluation. | Define versioned Zod schemas for each JSON payload; store a `schemaVersion`; validate on write and read; backfill existing rows; return a controlled error for unreadable rows. | Corrupt-JSON tests return a controlled 4xx/5xx with a stable code, not an unhandled exception; a version-1 fixture still renders after a version-2 deploy. |
| DB-06 | Medium | `prisma/schema.prisma:53-63,69-87` | No unique constraint on pending approvals per trip/approver or on booking identity. `submit` can create a second pending approval on retry (`submit/route.ts:69-71`); `book` deletes then inserts without a transaction (`book/route.ts:35-37,92`). | Concurrent or retried requests create duplicate approvals or duplicate booking links. Two approvers can decide different rows for the same trip. Duplicate links confuse the confirmation count and the `booked` transition. | Add a partial unique index for `decision = "pending"` per `(tripRequestId, approverId)` and a booking identity constraint; add an idempotency key to mutating routes; use conditional creates/updates (SQLite does not support Prisma `skipDuplicates`). | Concurrent duplicate requests produce exactly one approval and one booking per logical item; the second request returns the existing result rather than an error. |
| DB-07 | Medium | `prisma/schema.prisma:7-10`; `lib/db.ts:5-7`; live `PRAGMA journal_mode=delete` | SQLite runs in rollback-journal mode, not WAL, with default busy behavior. Prisma uses a singleton client. | Concurrent plan/book/approve writes serialize and can fail with `SQLITE_BUSY`; a long write transaction (once transactions are added) blocks other writers. This is acceptable for one local user, not for a team. | For production, move to Postgres. If SQLite must remain for a single-node pilot, enable WAL and set a busy timeout, and serialize writes; document the single-writer limit. | A concurrent-write test (two approvals plus a booking) completes without `SQLITE_BUSY`; the production database is Postgres or explicitly documented as single-writer. |

### 4.4 Migration risk register

| Risk | Trigger | Impact | Required control | Finding |
|---|---|---|---|---|
| Destructive `db push` | Any schema edit in production | Column/table loss without rollback | Baseline migrations, backup, staging rehearsal | `DB-01` |
| Provider switch without data move | SQLite→Postgres | Empty or partially migrated production DB | Export/import + row-count and FK verification | `DB-01` |
| Invalid legacy enum values | Adding enums/checks | Migration fails halfway | Pre-migration data audit and cleanup | `DB-02` |
| Float→Decimal conversion | Money precision migration | Rounding disputes, cap boundary changes | Fixed scale, dry-run diff report | `DB-03` |
| Index build locks | Adding indexes on large tables | Write outage | `CREATE INDEX CONCURRENTLY` on Postgres; maintenance window on SQLite | `DB-04` |
| JSON shape change | New itinerary/policy schema | Old rows unreadable | Version field + reader compatibility + backfill | `DB-05` |
| Duplicate cleanup | Adding unique constraints | Constraint creation fails | Deduplicate first, then constrain | `DB-06` |
| SQLite write contention | Team concurrency | 5xx / failed approvals | Postgres, or WAL + busy timeout + serialized writes | `DB-07` |

No migration was executed during this audit.

---

## 5. Travel, approval and booking lifecycle

### 5.1 State map

```text
                    ┌───────────────────────────────┐
                    │            draft              │
                    │  create / PATCH / plan        │
                    └───────────────┬───────────────┘
                                    │ POST /submit (owner, itinerary required)
                    ┌───────────────┴───────────────┐
                    │                               │
          no flags / below threshold        any flag / above threshold
                    │                               │
                    ▼                               ▼
              ┌──────────┐                  ┌──────────────────┐
              │ approved │                  │ pending_approval │
              └────┬─────┘                  └────┬─────────┬───┘
                   │                             │         │
                   │ POST /book                  │ approve │ reject
                   ▼                             ▼         ▼
        ┌──────────────────────────┐        ┌────────┐  ┌──────────┐
        │ booking_links_generated  │        │approved│  │ rejected │
        └────────────┬─────────────┘        └────────┘  └──────────┘
                     │ admin confirms rows until no
                     │ link_only remains and ≥1 confirmed
                     ▼
                 ┌────────┐
                 │ booked │
                 └────────┘

  cancelled: defined in schema/UI, never set by any route.
  re-plan:   POST /plan has no status guard and can overwrite any state.
```

### 5.2 Transition table

| From | Trigger | Who | Guard present | To | Side effects | Gap |
|---|---|---|---|---|---|---|
| — | `POST /api/trips` | Any current user | Zod create schema | `draft` | Creates trip, sets currency | `SEC-01` identity |
| `draft` | `PATCH /api/trips/[id]` | Owner | Status = `draft` (`route.ts:31-33`) | `draft` | Updates fields and currency | Stale plan (`LIFE-02`) |
| any | `POST /api/trips/[id]/plan` | Owner or admin | No status guard (`plan/route.ts:10-17`) | unchanged | Overwrites itinerary, estimate, flags | `LIFE-01` |
| `draft` | `POST /api/trips/[id]/submit` | Owner | Status = `draft`, itinerary exists (`submit/route.ts:18-23`) | `approved` or `pending_approval` | Policy evaluation; may create `Approval` | Non-transactional (`LIFE-05`) |
| `pending_approval` | `POST /api/approvals/[id]` | Assigned approver or admin | Approval decision = `pending` (`:17-19`); no trip-status check | `approved`/`rejected` | Updates approval then trip | `LIFE-08`, `SEC-06` |
| `pending_approval` | Slack `approve`/`reject` | Linked approver | Approval assigned + pending (`slack/route.ts:48-51`); no role/trip-status check | `approved`/`rejected` | Updates approval then trip | `LIFE-08`, `SEC-06` |
| `approved` | `POST /api/trips/[id]/book` | Owner or admin | Status = `approved`, itinerary exists (`book/route.ts:18-23`) | `booking_links_generated` | Deletes old `link_only`, creates up to 12 rows, updates status | `LIFE-04`, `LIFE-05` |
| `booking_links_generated` | `POST /api/trips/[id]/confirm-booking` | Travel admin | Admin only (`:16-18`); no trip-status guard; flips when no `link_only` and any confirmed (`:46-57`) | `booked` | Marks one row confirmed | `LIFE-04`, `LIFE-07` |
| any | no route | — | — | `cancelled` | — | `LIFE-12` |
| `rejected` | no route | — | — | `draft` | — | `LIFE-12` dead end |

### 5.3 Findings — lifecycle and state integrity

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| LIFE-01 | High | `app/api/trips/[id]/plan/route.ts:10-17,65-84`; `app/trips/[id]/TripActions.tsx:45-62` | `/plan` checks ownership but not `trip.status`. The UI shows “Re-plan with AI” to the owner for every status. Planning overwrites `itinerary`, `itineraryRetrievedAt`, `estimatedCost`, `currency`, `estimateIsComplete` and `policyFlags` without resetting the status or invalidating approvals. | An `approved` or `booked` trip can be re-planned to different search results, a different estimate or different policy flags while keeping its approved/booked state. The approver's decision no longer describes the trip that will be booked. A newly over-policy itinerary can be attached to an already-approved trip. | Allow planning only in `draft` (and, if product requires, a new explicit `replanning` state). Any material re-plan of an approved trip must reset to `draft`, clear or supersede prior approvals, and require re-submission. Add an audit event. | State-transition tests: `/plan` on `approved`/`booked` returns 409; a re-plan that changes cost requires a new approval; the approval timeline records the superseded decision. |
| LIFE-02 | High | `app/api/trips/[id]/route.ts:39-74`; `app/api/trips/[id]/submit/route.ts:29-52` | `PATCH` updates purpose, origin, destination, dates and cabin (and currency when the route changes) but leaves the stored itinerary, estimate, `estimateIsComplete` and policy flags untouched. `submit` then evaluates the **stored** itinerary's featured flight/hotel prices against the **new** dates, cabin and currency. | A user can plan a cheap itinerary, edit the trip to different dates or a premium cabin, and submit; the approval decision is based on stale prices and stale search results. The displayed itinerary may no longer match the route or dates. | On any material edit, clear `itinerary`, `itineraryRetrievedAt`, `estimatedCost`, `estimateIsComplete` and `policyFlags`, and require a fresh plan before submit. Alternatively version the itinerary and bind the approval to that version. | After PATCH, `itinerary` is null and submit returns “plan the trip first”; a test that edits dates after planning cannot submit the old estimate. |
| LIFE-03 | High | `prisma/schema.prisma:41`; `app/api/trips/[id]/plan/route.ts:79`; `app/api/slack/route.ts:174`; `app/approvals/page.tsx:118`; `app/page.tsx:160`; `WORKING.md:289` | When the total cannot be computed because a price is missing, both `/plan` and Slack store `estimatedCost: total ?? 0`. Approval and dashboard views format that value directly. The detail page independently shows “Unavailable” when `itinerary.estimatedTotal` is null, so the same trip can read `$0` on one page and “Unavailable” on another. `WORKING.md:289` acknowledges the zero display. | An approver can see a zero estimate for a trip whose price is unknown, underestimating spend and approving a trip that should be flagged for verification. The stored value is factually wrong: zero is a price, null is not. | Make `estimatedCost` nullable (or add `estimateStatus`); store null for unknown; render “price unavailable” everywhere; keep `PRICE_UNVERIFIED` visible. Backfill existing rows that were coerced to zero only after identifying them. | Tests: missing flight price → DB null, approvals and home show “Unavailable”, never `0`; a genuine zero (if allowed) remains distinguishable. |
| LIFE-04 | High | `app/api/trips/[id]/book/route.ts:68-83`; `app/api/trips/[id]/confirm-booking/route.ts:46-57`; `prisma/schema.prisma:65-87` | `/book` creates the featured candidate **plus up to two alternates per category** (up to 12 rows), all `link_only`. `/confirm-booking` flips the trip to `booked` only when **zero** `link_only` rows remain and at least one row is confirmed. There is no notion of “the selected flight/hotel” or “required leg”; every alternate must be marked `manually_confirmed` with a reference. | To reach `booked`, an admin must either confirm options that were never booked (fabricating references, contrary to `AGENTS.md:9-12`) or leave the trip stuck in `booking_links_generated` forever. The state machine conflates “a link was shown” with “a booking was made”. | Model selection explicitly: a `BookingSelection`/`isSelected`/`requiredKind` concept, or separate `BookingLink` (alternates) from `Booking` (actual booking). Flip to `booked` when every required category has one confirmed booking; leave alternates unconfirmed without blocking. Migration needed. | Test: one confirmed flight + one confirmed hotel, with alternates untouched, reaches `booked`; no reference is required for an unselected alternate; the API rejects a second confirmation for the same required leg. |
| LIFE-05 | High | `app/api/trips/[id]/submit/route.ts:69-78`; `app/api/trips/[id]/book/route.ts:35-37,92,94-98`; `app/api/approvals/[id]/route.ts:26-33`; `app/api/trips/[id]/confirm-booking/route.ts:36-57` | No `$transaction` is used anywhere in the repository. `submit` creates an approval and updates the trip as two writes; `book` deletes old links, inserts new rows and updates status as three writes; approval updates the approval then the trip; confirmation updates the booking, counts twice, then updates the trip. | A crash or concurrent request can leave: a pending approval with a `draft` trip; deleted links with no replacements; two approvals for one trip; a confirmed booking on a trip still in `booking_links_generated`; or a trip marked `booked` without all writes. Retries amplify the damage. | Wrap each state transition in `db.$transaction`; use conditional `updateMany({ where: { status: expected } })` and check `count === 1`; add unique/idempotency constraints (`DB-06`); return 409 on lost races. | Concurrency tests fire two identical requests and assert one transition, one approval, one booking set, and a 409 for the loser; fault-injection between writes leaves no partial state. |
| LIFE-06 | High | `lib/currency.ts:228-262,270-283`; `lib/search.ts:259-283`; `lib/policy.ts:26-35,67-75` | FX rates are hardcoded (`RATES_TO_USD`) and `INR_PER_USD` defaults to `83`. `normalizeMoney` returns the **original** amount and currency when conversion is unsupported (`currency.ts:279-281`); `normalizeSearchResult` then leaves that candidate unconverted (`search.ts:267-271`). Policy caps are converted into the trip currency, but candidate numbers are compared without checking that the candidate currency matches. | A CHF/CNY/other-currency result can be compared directly against a USD/INR cap, so a trip can be wrongly approved or wrongly flagged. The total mixes units without disclosure. A stale default rate also misstates INR/USD budgets. `WORKING.md:285` confirms there is no live FX. | Reject or exclude candidates whose currency cannot be converted; store the currency with every amount; convert with a dated rate snapshot; compare only after asserting `amount.currency === trip.currency`; make the rate configurable and visible at approval time. | Unit tests: unsupported currency is excluded or flagged `PRICE_UNVERIFIED`, never compared; policy boundary tests use explicit currencies; a rate change is visible in the approval audit. |
| LIFE-07 | Medium | `app/api/trips/[id]/confirm-booking/route.ts:13-20,55-57` | Admin-only is enforced, but there is no check that the trip is in `booking_links_generated`. Any trip with a matching booking row can be confirmed, and the final update sets `booked` whenever the counts match. | An admin can confirm a booking on a `draft`, `pending_approval`, `approved` or already `rejected` trip if a row exists (for example after a status rollback or direct data repair). The lifecycle can skip approval. | Require `trip.status === "booking_links_generated"` before confirming; use a conditional update on that status; return 409 otherwise. | Tests: confirm on each non-`booking_links_generated` status returns 409; only the expected state flips to `booked`. |
| LIFE-08 | Medium | `app/api/approvals/[id]/route.ts:9-33`; `app/api/slack/route.ts:48-74` | The decision route checks that the approval is `pending`, but not that the trip is still `pending_approval`. It then unconditionally sets the trip to `approved`/`rejected`. Slack has the same pattern. | A stale approval row can overwrite a trip that has since moved to another state (for example after a future cancel/withdraw or a re-plan). The decision timestamp and trip status can diverge from the actual queue. | Require `trip.status === "pending_approval"` and update the trip conditionally in the same transaction; mark stale approvals as superseded. | Tests: decide an approval after the trip moved to `draft`/`approved`/`cancelled` → 409, no status change. |
| LIFE-09 | Medium | `lib/validators.ts:3-30,33-41`; `app/api/trips/[id]/route.ts:51-59`; `lib/dates.ts:6-16`; `lib/ai.ts:73-74`; `app/api/slack/route.ts:91-102` | Dates are validated with `Date.parse`, not strict `YYYY-MM-DD`. Create and PATCH now reject `returnDate < departDate`, but allow a same-day return. `tripNights` clamps any range to at least one night (`Math.max(1, Math.round(diff))`), while `hotelCheckOut` returns the return date itself, so a same-day return searches a zero-night hotel stay but estimates and policy use one night. There is no future-departure rule, no maximum stay, and no shared date rule across the web form, PATCH and Slack. | A same-day return makes the hotel search and the estimate disagree, and the policy night count may not match intent. A past departure silently raises `LATE_BOOKING`; an extremely long stay multiplies the hotel estimate; a non-ISO but parseable date is accepted and normalized inconsistently; the clamp hides bad data instead of rejecting it. | Enforce strict ISO dates, require `returnDate > departDate` when a return exists, departure not in the past (with a defined grace rule), and a maximum stay; share one schema across create, PATCH and Slack; make night calculation reject invalid ranges instead of clamping. | Boundary tests for same-day, reversed, past, leap-day, non-ISO and >max-stay inputs; invalid requests return 400 with field errors; Slack returns a clear date error. |
| LIFE-10 | Medium | `lib/ai.ts:113`; `app/api/trips/[id]/plan/route.ts:49-63`; `app/api/slack/route.ts:146-179`; `prisma/schema.prisma:41`; `WORKING.md:142` | The stored estimate is flight + hotel × nights only. Trains and cabs are searched, featured and displayed but excluded. `prisma/schema.prisma:41` describes `estimatedCost` as the “sum of featured legs that had a listed price”, which does not match the calculation. `WORKING.md:142` confirms trains/cabs are excluded. | The policy engine and approver see an understated trip cost when train or cab is the main transport. The schema comment misleads future maintainers into assuming all legs are included. | Decide the product semantics: either include all featured legs that have a price (and flag if any required leg is missing), or rename the field/UI to “flight + hotel estimate” and keep policy caps scoped accordingly. Backfill/recompute existing trips. | Tests assert the documented scope; a trip with a priced train and no flight has a non-null, correctly scoped estimate; the approval page labels the scope. |
| LIFE-11 | Medium | `app/api/slack/route.ts:111-122`; `lib/ai.ts:240-291` | Slack `plan` creates the trip before planning, then runs Groq extraction and real search. There is no Slack `trigger_id`/event-id deduplication and no idempotency key. Slack retries or a double-submit create another trip and spend another Groq/Tavily call. | Duplicate trips, duplicate spend and confused status lists. The user may submit/approve the wrong duplicate. | Persist the Slack request/trigger ID with a unique constraint and return the existing result on retry; create the trip and dedupe record in one transaction. | Replaying the same Slack payload twice creates one trip and one search; the second response references the first trip. |
| LIFE-12 | Medium | `prisma/schema.prisma:37-40`; `app/api/trips/[id]/route.ts:31-33`; `app/api/trips/[id]/submit/route.ts:18-20`; `app/trips/[id]/TripActions.tsx:45-104`; `WORKING.md:139,278` | `cancelled` exists in the schema/status UI but no route sets it. `rejected` is terminal: `PATCH` and `submit` both require `draft`, and no route moves `rejected` back to `draft`. The owner can still press “Re-plan with AI” on a rejected trip, but cannot resubmit it. | Users cannot withdraw a pending request or cancel an approved trip. A rejected trip is a dead end even if the employee fixes the issue. Pending approvals remain in queues indefinitely. | Add explicit `cancel`/`withdraw` transitions with actor, reason and timestamp; allow `rejected → draft` (or a new `revising` state) with a fresh plan and new approval; enforce allowed transitions centrally. Migration needed for audit fields. | Transition tests cover cancel from each state, rejected→draft resubmission, and rejection of cancel after `booked`; the queue no longer shows withdrawn trips. |

### 5.4 Lifecycle invariants that should hold (currently unenforced)

1. Only `draft` trips can be planned or edited.
2. Only `draft` trips with a current itinerary can be submitted.
3. Only `pending_approval` trips can receive an approval decision.
4. Only `approved` trips can generate booking links.
5. Only `booking_links_generated` trips can be confirmed.
6. `booked` means every required leg has one real confirmation, not every alternate.
7. Any material change after approval invalidates that approval.
8. Every transition is atomic and records actor, timestamp and reason.

---

## 6. Environment and configuration

### 6.1 Environment variable inventory

| Variable | Required | Read at | Behavior if missing | Secret |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | `prisma/schema.prisma:9` | Prisma fails to start | No (may contain credentials) |
| `GROQ_API_KEY` | Yes for planning/chat | `lib/ai.ts:18-23`; `app/api/slack/route.ts:77-82` | Planning throws; Slack returns a friendly message | **Yes** |
| `GROQ_MODEL` | No | `lib/ai.ts:16` | Defaults to `llama-3.3-70b-versatile` | No |
| `TAVILY_API_KEY` | Yes for search | `lib/search.ts:133-134` | Search throws; `/plan` returns 503 | **Yes** |
| `GOOGLE_MAPS_API_KEY` | No | `lib/search.ts:482-531` | Cab routing falls back to Tavily | **Yes** |
| `INR_PER_USD` | No | `lib/currency.ts:228-231` | Defaults to `83` | No |
| `DEV_USER_EMAIL` | Yes | `lib/auth.ts:5-16` | Every page/route throws | No (PII) |
| `DEV_USER_NAME` | Seed only | `prisma/seed.ts:16` | Defaults to the email local-part | No (PII) |
| `DEV_USER_ROLE` | Seed only | `prisma/seed.ts:17-22` | Defaults to `travel_admin` | No |
| `DEV_SLACK_USER_ID` | No | `prisma/seed.ts:47` | Slack account not linked | No (PII) |
| `SLACK_SIGNING_SECRET` | Yes in production | `lib/slack.ts:9-10` | Verification returns `true` (fail-open) | **Yes** |

There is no startup schema validation. Missing or malformed values surface at request time, often as a 500 or, for Slack, as a security bypass.

### 6.2 Findings — configuration and operations

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| CFG-01 | High | `lib/auth.ts:5-8`; `prisma/seed.ts:16-22`; `.env.example:22-27`; `lib/ai.ts:18-23`; `lib/search.ts:133-134`; `lib/slack.ts:9-10`; `lib/currency.ts:228-231` | No environment schema or boot check. `DEV_USER_ROLE` defaults to `travel_admin` in the seed (`seed.ts:17`), and `.env.example:27` suggests `travel_admin`. `INR_PER_USD` silently defaults to `83`. Slack verification silently disables itself when the secret is absent. Missing Groq/Tavily keys fail at request time. | Copying `.env.example` and seeding creates an admin account by default. Combined with `SEC-01`, every visitor is that admin. A missing Slack secret turns off authentication. A stale FX default silently misprices policy checks. | Validate all env vars at boot with Zod; fail closed in production; require `SLACK_SIGNING_SECRET`, `GROQ_API_KEY` and `TAVILY_API_KEY`; default `DEV_USER_ROLE` to `employee`; require an explicit FX rate or a dated rate source; document which vars are dev-only. | Boot with each missing/invalid var fails with a clear error; production refuses to start without Slack/Groq/Tavily secrets; the seeded default role is `employee`. |
| CFG-02 | Low | `README.md:172`; `plan.md:32,72-73`; `prisma/seed.ts:40-49`; `README.md:5,107-119` | Documentation drift: `README.md:172` still says `search.ts` uses “DuckDuckGo HTML”, while `lib/search.ts:1-5,75` uses Tavily. `plan.md:32` says the seed creates three users, while `seed.ts:40-49` creates one env-configured account. `README.md:5,107-119` presents the Postgres switch as one line, which `DB-01` shows is unsafe. | An operator following the docs may expect the wrong provider, expect demo users that do not exist, or switch production databases without a data migration. | Update the docs after the corresponding code/migration work; add a docs check to the release checklist; remove stale provider references. | A documentation review finds no stale DuckDuckGo/three-user/one-line-switch claims; setup instructions match the actual seed and migration process. |
| CFG-03 | Medium | `package.json:15-21`; `package-lock.json` | Next.js is pinned to `15.0.3` and React/React DOM to `19.0.0-rc-66855b96-20241106`. There is no `npm audit` script or CI audit. `WORKING.md:291` states Next 15.0.3 was flagged by npm with known vulnerabilities. | Unpatched framework/RC dependencies may contain security fixes that are missing from production. A release candidate framework increases runtime instability risk. | Upgrade to the latest patched Next 15.x and stable React 19; run `npm audit --production` in CI; review breaking changes; rebuild and re-run the E2E suite. | `npm audit --production` reports no high/critical issues; `npm run build` and E2E pass on the upgraded versions. |
| OPS-01 | High | `prisma/dev.db`; `README.md:99-119`; no backup/restore scripts or documented RPO/RTO | The only persistent store is a SQLite file. There is no scheduled backup, no off-host copy, no restore procedure and no retention policy. | A disk failure, accidental `db push`, ransomware or bad migration permanently destroys trips, approvals and real booking references. There is no evidence a restore has ever been tested. | Move production to managed Postgres with automated backups and point-in-time recovery; for the SQLite pilot, schedule encrypted off-host snapshots and test restore; define RPO/RTO and retention. | A restore into a fresh environment reproduces all tables and row counts; a documented drill completes within RTO; backups are encrypted and access-controlled. |
| OPS-02 | Medium | `prisma/seed.ts:51-57`; no health route; no structured logging/metrics/tracing | The only `console` calls are in the seed. Request handlers do not log request IDs, latency, transitions, upstream failures or cost. There is no `/api/health` or readiness endpoint. | Production failures (Tavily 429, Groq outage, DB lock, auth misconfiguration) are invisible until users report them. Cost abuse and repeated Slack retries cannot be detected. | Add structured JSON logs with request IDs and actor IDs; metrics for latency/error/upstream status; alerts for 5xx and spend; `/api/health` and `/api/ready`; error tracking. | A forced upstream failure produces a correlated log and alert; health endpoints report DB and dependency status; dashboards show request rate, errors and latency. |
| OPS-03 | High | Working copy root; `git status` | The working copy is not a Git repository. There is no commit history, branch protection, code review or rollback point. | A bad edit or accidental deletion cannot be reviewed or reverted. Secrets and database files are not protected by history hygiene. There is no auditable change trail for a production system. | Initialize a repository with the existing `.gitignore` (`.env`, `dev.db`), review the initial commit for secrets, protect the main branch, require review and CI, and tag releases. | `git log` and protected-branch rules exist; the initial commit contains no `.env`/`dev.db`; a release can be reverted to a tag. |

---

## 7. Architecture-level risks (summary, no duplicate findings)

| Risk | Why it matters | Findings |
|---|---|---|
| Identity is configuration, not a session | Every authorization decision is only as good as one env var | `SEC-01`, `CFG-01` |
| Controls are per-route | A new route can omit auth, CSRF, limits or validation | `SEC-03`, `SEC-04`, `SEC-08` |
| Approval is not bound to an itinerary version | The approved artifact can change underneath the approver | `LIFE-01`, `LIFE-02` |
| Booking links are confused with bookings | `booked` cannot be reached honestly | `LIFE-04` |
| Money is approximate and sometimes mixed-currency | Policy decisions can be wrong | `LIFE-03`, `LIFE-06`, `DB-03` |
| No migration/backup/version-control discipline | A schema or disk event can destroy the system of record | `DB-01`, `OPS-01`, `OPS-03` |
| No automated verification | Regressions in the above are undetectable | `TEST-01`…`TEST-08` |

---

## 8. What is sound today

These are verified positives, not findings:

- **No mock business data.** `prisma/seed.ts:24-49` creates only the env-configured account and the policy; the live DB contains 1 user, 1 policy, 1 real user-created draft trip, 0 approvals and 0 bookings. The trip was created through the app during final verification, not seeded.
- **No fabricated inventory or prices.** Search failures return `unavailable` (`lib/search.ts:228-249`, `plan/route.ts:37-45`); missing prices stay null and raise `PRICE_UNVERIFIED` (`lib/policy.ts:77-81`).
- **No simulated booking.** `/book` only materialises outbound links (`book/route.ts:6-9`); confirmation is admin-only (`confirm-booking/route.ts:16-18`); the UI states that the app does not perform bookings (`app/trips/[id]/page.tsx:354-357`).
- **One-way trips are explicit.** `returnDate` is nullable (`prisma/schema.prisma:35`), the UI accepts a blank return date (`app/trips/new/NewTripForm.tsx:93-101`), and the one-night hotel assumption is disclosed (`app/trips/[id]/page.tsx:268-270`, `WORKING.md:141`).
- **Role-aware reads.** Trip detail and API reads restrict to owner, assigned approver or admin (`app/trips/[id]/page.tsx:130-143`, `app/api/trips/[id]/route.ts:15-19`); dashboard filters by requester (`app/page.tsx:26-31`).
- **Slack HMAC is timing-safe and replay-bounded when the secret is set** (`lib/slack.ts:11-21`), and Slack approval is assigned-approver-only (`app/api/slack/route.ts:48-51`).
- **No obvious injection sink.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` or raw SQL in `app/`, `lib/` or `components/`; Prisma parameterizes queries.
- **Outbound links use `rel="noopener noreferrer"`** (`app/trips/[id]/page.tsx:391-396`).
- **No secret logging.** The only `console` calls are in `prisma/seed.ts:51-57`; no key values are printed.
- **TypeScript and Prisma schema are valid** at audit time.

These positives do not offset the release gates in §2.2.

---

## 9. Production readiness checklist

| Area | Ready? | Evidence |
|---|---|---|
| Real authentication | No | `SEC-01`, `CFG-01` |
| Authorization matrix enforced and tested | No | `SEC-06`, `TEST-02` |
| Slack request authenticity | No (fail-open if unset) | `SEC-02` |
| CSRF / origin protection | No | `SEC-03` |
| Rate limiting / spend controls | No | `SEC-04` |
| Input bounds | Partial | `SEC-05`, `LIFE-09` |
| Error handling / no internal leakage | No | `SEC-08` |
| Secrets storage and permissions | Partial | `SEC-09`, `CFG-01` |
| Security headers | No | `SEC-10` |
| Lifecycle integrity | No | `LIFE-01`…`LIFE-12` |
| Booking semantics | No | `LIFE-04` |
| Money correctness | No | `LIFE-03`, `LIFE-06`, `DB-03` |
| Migration history | No | `DB-01` |
| Backup / restore | No | `OPS-01` |
| Observability | No | `OPS-02` |
| Version control / CI | No | `OPS-03`, `TEST-07` |
| Automated tests | No | `TEST-01` |
| Documentation accuracy | Partial | `CFG-02` |

**Conclusion:** Phase 0 finds the application functionally coherent and honest about not fabricating travel data, but it is a local-development system. It must not be exposed to real employees or real booking workflows until at least Gate G0 and the approval/booking integrity items in `PRODUCTION_ROADMAP.md` are complete.

---

## 10. Cross-reference index

| Prefix | Owner | IDs |
|---|---|---|
| `DB-` | This document | `DB-01`…`DB-07` |
| `LIFE-` | This document | `LIFE-01`…`LIFE-12` |
| `CFG-` | This document | `CFG-01`…`CFG-03` |
| `OPS-` | This document | `OPS-01`…`OPS-03` |
| `SEC-` | `SECURITY_AUDIT.md` | `SEC-01`…`SEC-12` |
| `TEST-` | `TEST_COVERAGE.md` | `TEST-01`…`TEST-08` |

Remediation order and migration flags are in `PRODUCTION_ROADMAP.md`.
