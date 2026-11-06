# Production Roadmap — Corporate Travel Agent

> **Status note (2026-11-04, four-role release).** Items 1.11–1.12 (approver role + assignment
> checks), duplicate-approval prevention, approval threads/reasons, transaction-safe decisions,
> audit log, notifications and cancellation review are implemented. Authentication/SSO remains the
> top production blocker. See `plan.md` and `WORKING.md` for the current state.

**Phase:** 0 output (read-only)
**Date:** 2026-11-04
**Purpose:** Convert the audit findings into a severity- and dependency-ordered implementation sequence.

**Nothing in this document has been implemented.** No code, schema, migration, seed or configuration was changed. Each step is labelled:

- **non-breaking** — can ship without a data migration; behavior may change, so release notes and tests are still required.
- **needs-migration** — requires a reviewed schema/data migration, a backup, and a staging rehearsal.

Finding details live in [`PRODUCTION_AUDIT.md`](./PRODUCTION_AUDIT.md) (`DB-*`, `LIFE-*`, `CFG-*`, `OPS-*`) and [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) (`SEC-*`). Test work is in [`TEST_COVERAGE.md`](./TEST_COVERAGE.md) (`TEST-*`).

---

## 1. Sequencing rules

1. **Security before features.** No shared or production deployment until Gate 0 is complete.
2. **Identity before authorization.** `SEC-01` must land before CSRF, role checks and audit attribution can be trusted.
3. **Migrations before schema-dependent fixes.** `DB-01` must land before any `needs-migration` item.
4. **Approval integrity before booking integrity.** A trip must not be bookable while its approved itinerary can change (`LIFE-01`, `LIFE-02`).
5. **Money correctness before policy tuning.** Fix null totals and currency mixing before changing caps.
6. **Every step ships with tests.** A step is not complete until its regression tests are in CI.
7. **One migration per logical change.** Never bundle enum cleanup, money type changes and booking-model changes into one irreversible migration.

---

## 2. Gate 0 — do not deploy until complete

These items close release-stopping risks. They are ordered by dependency.

### 2.1 The single most important recommendation

> **Start with version control, CI and a test harness — `OPS-03` + `TEST-07` + `TEST-01`.**
>
> This is the highest-leverage step, not the highest-severity finding. Without Git history, a protected main branch and an automated test loop, none of the security or lifecycle fixes below can be reviewed, verified or rolled back — the audit's central problem, changes that cannot be proven safe, would simply move into the remediation. The first *substantive* fix after that foundation is `SEC-01` (real authentication), the highest-severity release blocker: today every request runs as the account named by `DEV_USER_EMAIL`.

| Step | Findings | Work | Breaking? | Migration? | Required tests | Exit criteria |
|---|---|---|---|---|---|---|
| **0.1** Establish version control and CI skeleton | `OPS-03`, `TEST-07` | Initialize Git with the existing `.gitignore`; verify no `.env`/`dev.db` in history; protect main; add CI for install, typecheck, lint, build, tests and secret scan | **non-breaking** | No | CI smoke job; secret scan | `git log` exists; a failing typecheck blocks merge; no secrets in history |
| **0.2** Add the test harness | `TEST-01` | Add Vitest, Playwright, isolated test DB, coverage and scripts; no committed business data (see `TEST_COVERAGE.md:§4.2`) | **non-breaking** | No | Harness self-test | `npm test` runs; tests never touch `prisma/dev.db` |
| **0.3** Real authentication and sessions | `SEC-01`, `CFG-01` | Integrate OIDC/SSO or a maintained auth library; server-side session; map subject to `User.id`; remove production `DEV_USER_EMAIL` impersonation; add logout/expiry | **needs-migration** | Yes — session/identity mapping tables or columns | `TEST-02` auth matrix; session expiry; two-user isolation | Unauthenticated requests denied; two sessions see different data; no env impersonation in production |
| **0.4** Fail-closed Slack verification | `SEC-02` | Require `SLACK_SIGNING_SECRET` in production; refuse to start or return 503 when absent; keep timestamp/replay checks | **non-breaking** | No | Missing secret → 503/401; bad signature → 401; replay → 401; valid → accepted | Forged `user_id` cannot act; fail-open code path removed |
| **0.5** Environment validation and safe defaults | `CFG-01` | Zod-validate all env vars at boot; require Groq/Tavily/Slack secrets in production; default seed role to `employee`; require an explicit FX rate or dated source | **non-breaking** | No | Boot with each missing/invalid var; seeded role test | Production refuses to start misconfigured; default role is not admin |
| **0.6** Migration baseline and backup/restore | `DB-01`, `OPS-01` | Generate a baseline migration from the current schema; commit `prisma/migrations/`; stop using `db push` for production; document backup/RPO/RTO; test a restore | **needs-migration** | Yes — baseline migration | `prisma migrate deploy` on empty DB; restore rehearsal; row-count/FK checks | Migration history is clean; restore reproduces all data; rollback path documented |
| **0.7** CSRF and origin protection | `SEC-03` | SameSite/Secure/HttpOnly session cookie; `Origin`/`Referer` validation; CSRF token; reject non-JSON bodies where JSON is expected | **non-breaking** | No | Cross-origin POST → 403; missing token → 403; `text/plain` → 415; valid → success | Every mutating route covered by tests |
| **0.8** Rate limits and spend caps | `SEC-04` | Per-user/per-IP limits on plan, chat, Slack, places and mutations; daily/monthly AI/search budgets; concurrency caps; `429` + `Retry-After` | **non-breaking** | No (external store if multi-instance) | Load tests; concurrent plan cap; places limit | Abuse tests receive 429; spend alerts fire; no single caller can exhaust quota |

**Gate 0 exit:** all eight steps complete, CI green, restore proven, and no Critical/High security finding open without an accepted, documented exception.

---

## 3. Phase 1 — approval, booking and money integrity

These steps make the lifecycle match what approvers and admins believe they are approving.

| Step | Findings | Work | Breaking? | Migration? | Required tests | Exit criteria |
|---|---|---|---|---|---|---|
| **1.1** Invalidate stale plans on edit | `LIFE-02` | On material PATCH (route/dates/cabin/purpose), clear itinerary, retrieval timestamp, estimate, completeness and flags; require a fresh plan before submit | **non-breaking** | No | Integration: edit after plan → submit blocked; old estimate not used | No stale itinerary can be submitted |
| **1.2** Guard re-planning by status | `LIFE-01` | Allow `/plan` only in `draft` (or introduce an explicit replan state); any re-plan of an approved trip resets to draft and invalidates approvals | **non-breaking** | No | Transition tests for every status; approval invalidation | Approved/booked trips cannot be silently re-planned |
| **1.3** Nullable estimate for unknown totals | `LIFE-03` | Make `estimatedCost` nullable (or add an estimate status); store null when unknown; render “price unavailable” on home, approvals and Slack; backfill coerced zeros only after identification | **needs-migration** | Yes — column nullability/default and data backfill | Missing price → null; UI shows unavailable; genuine zero distinguishable | No unknown total is displayed or compared as zero |
| **1.4** Status guards on confirmation and decisions | `LIFE-07`, `LIFE-08` | Require `booking_links_generated` for confirmation and `pending_approval` for decisions; conditional updates; return 409 on stale state | **non-breaking** | No | Tests for every illegal source state | No lifecycle skip or stale overwrite |
| **1.5** Transactional transitions | `LIFE-05` | Wrap submit, approve/reject, book and confirm in `$transaction`; use conditional `updateMany` and check counts; return 409 on lost races | **non-breaking** | No | Concurrency and fault-injection tests | No partial approval/booking state after a crash or double request |
| **1.6** Booking selection model | `LIFE-04` | Separate booking links/alternates from the actual booking; add `isSelected`/`requiredKind` or a `BookingSelection` model; flip to `booked` when each required category has one confirmation | **needs-migration** | Yes — new fields/table and data backfill | One flight + one hotel with alternates untouched reaches `booked`; no fake references | `booked` means required legs are booked, not every alternate |
| **1.7** Currency correctness | `LIFE-06`, `DB-03` interaction | Reject/exclude unconvertible currencies; assert amount currency equals trip currency before policy comparison; store a dated rate snapshot; expose the rate at approval; replace hardcoded conversion | **needs-migration** | Yes if a rate snapshot/column is added; otherwise code-only plus backfill | Unsupported currency test; boundary tests; rate-change visibility | Policy never compares mixed units; approval shows the rate used |
| **1.8** Strict date validation | `LIFE-09` | Strict ISO; require `returnDate > departDate` when a return exists (same-day is currently allowed); future departure rule; maximum stay; one shared schema for create, PATCH and Slack; reject invalid ranges instead of clamping to one night | **non-breaking** | No | Boundary tests for one-way/same-day/reversed/past/leap/max | Invalid dates return 400; night count is never silently coerced |
| **1.9** Define estimate scope | `LIFE-10` | Decide whether trains/cabs are included; either compute all featured legs with missing-price handling or rename the field/UI to “flight + hotel estimate”; update the schema comment; recompute existing trips | **non-breaking** | No (recompute is a data job; no schema change) | Scope tests; approval label test | Code, schema comment and UI agree; approver sees the true scope |
| **1.10** Slack idempotency | `LIFE-11` | Persist Slack `trigger_id`/request ID with a unique constraint; return the existing result on retry; dedupe before creating a trip | **needs-migration** | Yes — dedupe table/column | Replay same payload twice → one trip, one search | Slack retries cannot duplicate trips or spend |
| **1.11** Cancel, withdraw and reopen | `LIFE-12` | Add explicit cancel/withdraw transitions with actor/reason/timestamp; allow rejected→draft (or a revising state) with a fresh plan and approval; enforce a central transition table | **needs-migration** | Yes — audit/reason fields and transition metadata | Cancel from each state; rejected→draft resubmit; cancel after booked rejected | No dead-end rejected trip; pending queue is releasable |
| **1.12** Approver role check | `SEC-06` | Require `manager`/`travel_admin` **and** assignment (or explicit admin override); validate `managerId` points to a manager/admin | **non-breaking** | No | Employee-as-manager → 403; manager not assigned → 403; admin override audited | Approval privilege cannot come from a misconfigured `managerId` |
| **1.13** Bound chat and AI input | `SEC-05` | Max messages, per-message and total characters, body size, per-user budget; reject 400/413 before calling Groq | **non-breaking** | No | Oversized payload tests; Groq not called | No unbounded AI request |
| **1.14** Harden prompts and extracted fields | `SEC-07` | Delimit untrusted data; separate instructions; validate extractor output with Zod; treat model output as display-only; label generated content | **non-breaking** | No | Adversarial prompt tests; malformed extraction rejected | Injection cannot change lifecycle state or persist bad fields |
| **1.15** Central error mapping | `SEC-08` | Safe JSON body parser; stable public error codes; structured server logs with request IDs; never return raw exception text | **non-breaking** | No | Malformed JSON → 400; upstream failure → generic code; no internal host in response | No unhandled 500 for client input; no detail leakage |
| **1.16** Booking URL allowlist | `SEC-11` | Require HTTPS; allowlist provider domains per category; reject credentials/non-standard ports; display hostname; consider an interstitial | **non-breaking** | No | `javascript:`/`data:`/`http:`/credentialed/non-allowlisted rejected | Only real provider HTTPS links are rendered |

**Phase 1 exit:** the full lifecycle — draft → plan → submit → approve/reject → book links → confirm → booked — is atomic, guarded, auditable and covered by integration tests. Rejection can be revised, and no fabricated confirmation is required.

---

## 4. Phase 2 — schema hardening

These steps make invalid data unrepresentable and make the database operable at team scale.

| Step | Findings | Work | Breaking? | Migration? | Required tests | Exit criteria |
|---|---|---|---|---|---|---|
| **2.1** Enums and check constraints | `DB-02` | Audit existing `role`/`status`/`decision`/`kind`/`currency` values; clean invalid rows; add Postgres enums or SQLite `CHECK`s; mirror TypeScript unions | **needs-migration** | Yes — data cleanup + constraints | Insert invalid values rejected; transition matrix | Invalid states cannot be written |
| **2.2** Decimal money | `DB-03` | Convert `estimatedCost`, booking estimates and policy caps to `Decimal`/minor units; define scale and rounding; migrate with a diff report | **needs-migration** | Yes — column type + data conversion | Boundary/property tests; migration precision report | Money is exact; policy boundaries deterministic |
| **2.3** Indexes | `DB-04` | Add `TripRequest(requesterId, createdAt)`, `TripRequest(status)`, `Approval(approverId, decision)`, `Approval(tripRequestId)`, `Booking(tripRequestId, status)`, `Booking(status)`; use concurrent index builds on Postgres | **needs-migration** | Yes — indexes | `EXPLAIN` checks; load test | Named queries use indexes; latency target met |
| **2.4** Unique/idempotency constraints | `DB-06` | Deduplicate approvals/bookings; add unique `(tripRequestId, approverId)` and booking identity constraints; add idempotency keys | **needs-migration** | Yes — dedupe + constraints | Concurrent duplicate tests; second request returns existing | One logical approval/booking per item |
| **2.5** JSON validation and versioning | `DB-05` | Zod schemas for itinerary, flags, booking details and allowed cabins; add `schemaVersion`; validate on write/read; backfill | **needs-migration** | Yes — version field/backfill | Corrupt JSON controlled error; old version still renders | Malformed/legacy JSON cannot 500 the app |
| **2.6** Production database | `DB-07` | Move to managed Postgres; or, for a single-node pilot, enable WAL + busy timeout and document the single-writer limit | **needs-migration** | Yes — provider/data migration | Concurrent write test; failover/restore drill | No `SQLITE_BUSY` under expected concurrency; backup/PITR proven |
| **2.7** Immutable audit events | `SEC-12` | Add append-only `AuditEvent` (actor, action, entity, before/after hash, timestamp, request ID); emit for every transition; restrict update/delete | **needs-migration** | Yes — new table | One event per transition; immutability test | Full trip history reconstructable; disputed actions attributable |

**Phase 2 exit:** the schema rejects invalid states, money is exact, queries are indexed, JSON is versioned, the database is production-grade, and every transition is auditable.

---

## 5. Phase 3 — operational and browser hardening

| Step | Findings | Work | Breaking? | Migration? | Required tests | Exit criteria |
|---|---|---|---|---|---|---|
| **3.1** Secret permissions and rotation | `SEC-09` | `chmod 600`; secret manager in production; encrypt DB/backups; rotate exposed keys | **non-breaking** | No | `stat` check; secret scan | Secrets not world-readable; no key in repo/image |
| **3.2** Security headers | `SEC-10` | CSP, HSTS, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | **non-breaking** | No | `curl -I`; CSP report-only; framing test | Headers present; no unexpected CSP violations |
| **3.3** Observability and health | `OPS-02` | Structured logs, request IDs, metrics, tracing, error tracking, `/api/health` + `/api/ready`, alerts for 5xx/spend/DB locks | **non-breaking** | No | Forced failure produces correlated log/alert; health checks | Failures detectable before users report them |
| **3.4** Documentation truth pass | `CFG-02` | Update DuckDuckGo references, seed-user count, Postgres switch instructions and lifecycle/estimate scope | **non-breaking** | No | Docs review against code | No stale operational claims |
| **3.5** Dependency upgrade | `CFG-03` | Upgrade to patched Next 15.x and stable React 19; run audit; rebuild and re-run E2E | **non-breaking** | No | `npm audit --production`; build; E2E | No high/critical advisories; build/E2E green |

**Phase 3 exit:** secrets, headers, observability and documentation meet production baseline; dependencies are supported.

---

## 6. Phase 4 — test and CI maturity

These steps can start early (0.2) and continue alongside every phase. They are listed separately so coverage work is not deferred to the end.

| Step | Findings | Work | Breaking? | Migration? | Required tests | Exit criteria |
|---|---|---|---|---|---|---|
| **4.1** Auth/authz suite | `TEST-02` | Matrix tests for every route/role; Slack signature tests; route-inventory guard | **non-breaking** | No | Matrix 100% cells | Every allowed/denied cell asserted |
| **4.2** Lifecycle suite | `TEST-03` | Pure transition module + integration tests for every state/action, including illegal transitions | **non-breaking** | No | 100% transition cells | No unguarded transition can merge |
| **4.3** Money/policy suite | `TEST-04` | Unit/property tests for caps, flags, nulls, FX, unsupported currencies, boundaries | **non-breaking** | No | ≥95% branch coverage | Policy decisions verified at boundaries |
| **4.4** Validation/contract suite | `TEST-05` | Table-driven schema tests; malformed/oversized bodies; stable error codes | **non-breaking** | No | Valid/invalid/boundary per schema | 400/413, never 500, for bad input |
| **4.5** E2E suite | `TEST-06` | Playwright happy path, approval/rejection, unavailable search, stale plan, booking confirmation, Slack, accessibility | **non-breaking** | No | Desktop/mobile; axe | Critical flows covered in browser |
| **4.6** Concurrency/migration suite | `TEST-08` | Duplicate requests, fault injection, migration up/down, restore rehearsal | **non-breaking** | No | Race tests; restore test | No partial state; migrations reversible/restorable |
| **4.7** CI enforcement | `TEST-07` | Require all gates on merge; publish coverage; block on audit/secret scan | **non-breaking** | No | Failing PR blocked | CI is the release gate |

**Phase 4 exit:** the Critical/High findings each have a named regression test; CI blocks regressions; coverage targets in `TEST_COVERAGE.md:§5` are met.

---

## 7. Dependency graph

```text
OPS-03 (version control)
  └─ TEST-07 (CI)
       └─ TEST-01 (harness)
            ├─ TEST-02 ──► SEC-01 (auth)
            ├─ TEST-03 ──► LIFE-01/LIFE-02/LIFE-04/LIFE-07/LIFE-08/LIFE-12
            ├─ TEST-04 ──► LIFE-03/LIFE-06/LIFE-10
            └─ TEST-08 ──► LIFE-05/DB-06/DB-01

SEC-01 (auth)
  ├─ SEC-03 (CSRF)
  ├─ SEC-06 (approver role)
  └─ SEC-12 (audit attribution)

DB-01 (migration baseline)
  ├─ LIFE-03 (nullable estimate)
  ├─ LIFE-04 (booking selection)
  ├─ LIFE-11 (Slack idempotency)
  ├─ LIFE-12 (cancel/reopen)
  ├─ DB-02 (enums/checks)
  ├─ DB-03 (Decimal)
  ├─ DB-04 (indexes)
  ├─ DB-05 (JSON versioning)
  ├─ DB-06 (unique constraints)
  ├─ DB-07 (Postgres/WAL)
  └─ SEC-12 (audit table)

LIFE-01 + LIFE-02 (approval integrity)
  └─ LIFE-04 (booking integrity: approval must be stable first)

LIFE-03 (null estimate)
  └─ DB-03 (Decimal conversion after nullability is defined)

LIFE-05 (transactions)
  └─ DB-06 (constraints enforce the invariant at the DB)
```

---

## 8. Migration sequence (when approved)

No migration was run in Phase 0. When implementation is authorized, use this order:

| Order | Change | Findings | Why this order | Rollback |
|---:|---|---|---|---|
| 1 | Baseline current schema as the first migration | `DB-01` | Establishes history before any change | Restore backup |
| 2 | Add CI migration check (`migrate status`, `migrate diff --exit-code`) | `DB-01`, `TEST-07` | Prevents unmanaged drift | Revert CI change |
| 3 | Rehearse SQLite→Postgres on a copy | `DB-01`, `DB-07` | Proves type/provider behavior before cutover | Keep SQLite copy |
| 4 | Pre-migration data audit: invalid roles/statuses, duplicates, zero-vs-null estimates | `DB-02`, `DB-06`, `LIFE-03` | Constraints and backfills need clean data | Audit report + backup |
| 5 | Nullable `estimatedCost` / estimate status | `LIFE-03` | Must precede Decimal conversion | Re-add default (data preserved) |
| 6 | Audit-event and idempotency tables | `SEC-12`, `LIFE-11` | Additive; needed before lifecycle rewrite | Drop new tables |
| 7 | Booking selection model | `LIFE-04` | Additive/backfill; needed for honest `booked` | Keep old rows; revert code |
| 8 | Unique constraints after dedupe | `DB-06` | Fails if duplicates remain | Drop constraints |
| 9 | Indexes | `DB-04` | Performance only; concurrent build on Postgres | Drop indexes |
| 10 | Enums/check constraints after cleanup | `DB-02` | Fails on invalid legacy values | Drop constraints |
| 11 | Decimal money conversion | `DB-03` | Rewrites financial columns; do last among data changes | Restore backup; keep scale report |
| 12 | JSON version field and backfill | `DB-05` | Old rows need a reader-compatible version | Keep old column values |
| 13 | Cutover to Postgres | `DB-01`, `DB-07` | Final provider move after schema is stable | DNS/connection rollback + restore |

**Pre-migration checklist**

- [ ] Backup verified by restoring to a separate environment.
- [ ] Row counts and foreign-key checks recorded before and after.
- [ ] Migration tested on a production-sized copy.
- [ ] Application version compatible with both old and new schema during rollout.
- [ ] Rollback owner and time window agreed.
- [ ] No `db push` in the production pipeline.

---

## 9. Release checklist

### Gate 0

- [ ] `SEC-01` real auth; no env impersonation in production.
- [ ] `SEC-02` Slack fails closed.
- [ ] `CFG-01` env validation; safe defaults.
- [ ] `DB-01` migration baseline; `OPS-01` restore proven.
- [ ] `OPS-03` version control and protected main.
- [ ] `SEC-03` CSRF/origin; `SEC-04` rate limits.
- [ ] `TEST-01`, `TEST-02`, `TEST-07` minimum harness and CI.

### Before real employees

- [ ] `LIFE-01`, `LIFE-02` approval integrity.
- [ ] `LIFE-03`, `LIFE-06` money integrity.
- [ ] `LIFE-04` booking semantics.
- [ ] `LIFE-05` transactions; `LIFE-07`, `LIFE-08` guards.
- [ ] `SEC-05`, `SEC-06`, `SEC-08` input/role/error fixes.
- [ ] `SEC-09`, `SEC-10` secrets and headers.
- [ ] `SEC-11` URL allowlist.
- [ ] `OPS-02` observability and health checks.

### Before schema freeze

- [ ] `DB-02`…`DB-07` complete and rehearsed.
- [ ] `SEC-12` audit events.
- [ ] `LIFE-11`, `LIFE-12` idempotency and cancel/reopen.
- [ ] Migration sequence in §8 executed with backups and verification.
- [ ] `CFG-02`, `CFG-03` documentation and dependency upgrades.

### Before declaring production-ready

- [ ] All Critical/High findings closed or explicitly risk-accepted by the owner.
- [ ] `TEST-03`…`TEST-06`, `TEST-08` green in CI.
- [ ] E2E covers the full lifecycle and the unavailable-search path.
- [ ] A restore drill and a migration rollback drill have passed.
- [ ] No mock/demo/sample business data exists in seed, tests shipped to runtime, or production.
- [ ] The app never fabricates a price, availability or booking confirmation.

---

## 10. Suggested first sprint

If only one sprint is available, do these in order:

1. `OPS-03` + `TEST-07` + `TEST-01` — get version control, CI and a harness.
2. `SEC-01` — real identity.
3. `SEC-02` — Slack fail-closed.
4. `CFG-01` — env validation and safe defaults.
5. `DB-01` + `OPS-01` — baseline migration and a proven restore.
6. `SEC-03` + `SEC-04` — CSRF and rate limits.
7. `LIFE-02` + `LIFE-01` — stop stale and post-approval re-planning.
8. `LIFE-03` — stop showing unknown totals as zero.
9. `TEST-02` + `TEST-03` — lock the auth and lifecycle fixes.

This sprint does not make the app feature-complete, but it removes the release-stopping security and approval-integrity risks and establishes the verification loop needed for the rest.
