# Test Coverage Audit — Corporate Travel Agent

> **Status note (2026-11-04, four-role release).** There is still no automated test suite. The
> four-role workflows and security paths were verified manually against a temporary database copy
> with controlled identities; see `plan.md §9` and `WORKING.md` for the verified checklist.

**Phase:** 0 (read-only)
**Date:** 2026-11-04
**Scope:** Existing automated tests, what was actually executed, coverage gaps by module, and a proposed unit/integration/E2E plan.
**Mode:** Audit only. No test files, scripts or application code were added or changed.

**Companion documents**

- [`PRODUCTION_AUDIT.md`](./PRODUCTION_AUDIT.md) — architecture, schema, lifecycle and operations (`DB-*`, `LIFE-*`, `CFG-*`, `OPS-*`).
- [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) — security findings (`SEC-*`).
- [`PRODUCTION_ROADMAP.md`](./PRODUCTION_ROADMAP.md) — remediation order.

---

## 1. What was actually run

| Check | Command | Result | Notes |
|---|---|---|---|
| TypeScript | `npx tsc --noEmit --incremental false` | **Passed**, exit 0 | Run for this audit |
| Prisma schema | `npx prisma validate` | **Valid**, exit 0 | Run for this audit |
| Test runner | `npm test` | **Not run** | No `test` script exists (`package.json:5-13`) |
| Unit tests | — | **Not run** | No test files or runner installed |
| Integration tests | — | **Not run** | No test files or runner installed |
| E2E tests | — | **Not run** | No Playwright/Cypress config or test files |
| Production build | `npm run build` | **Not run** | `WORKING.md:32` documents a prior pass, not re-run here |
| Lint | `npm run lint` | **Not run** | No ESLint config found; not executed |
| Manual walkthrough | `plan.md:228-237` | **Not run** | Manual plan only; no evidence of execution in this audit |

The requirement is explicit: a test is reported as passed only if it was executed. Only TypeScript and `prisma validate` were executed. Everything else is **not run**.

### 1.1 Test inventory

| Item | Finding |
|---|---|
| `*.test.*` / `*.spec.*` files | None |
| `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*` | None |
| `test`, `test:unit`, `test:integration`, `test:e2e` scripts | None (`package.json:5-13`) |
| CI workflow | None (`.github/` absent) |
| Coverage configuration | None |
| Test database configuration | None |
| Manual test plan | `plan.md:228-237` only |

**There are zero automated tests in the repository.** This is the single largest verification gap: all findings in the companion documents are established by code inspection and live DB checks, not by a regression suite.

---

## 2. Coverage gaps by module

| Module | Behavior that needs tests | Current coverage | Risk | Related findings | Proposed level |
|---|---|---|---|---|---|
| `lib/auth.ts` | Identity resolution, missing env, unknown email, role assertion | None | Every request runs as one env user; no test would catch a production auth change | `SEC-01`, `SEC-06`, `CFG-01` | Integration + E2E |
| `lib/slack.ts` | HMAC valid/invalid, missing secret, replay window, timing-safe compare, command parser | None | Fail-open bypass; parser edge cases | `SEC-02`, `LIFE-11` | Unit + integration |
| `lib/validators.ts` | Create/patch fields, strict dates, date order, future/max stay, chat bounds, approval enum | None | Reversed dates, unbounded chat, malformed input | `SEC-05`, `LIFE-09` | Unit |
| `lib/policy.ts` | Caps conversion, all six flags, null-price handling, boundary equality, cabin allow-list, malformed JSON | None | Approvals can be wrong at boundaries or with missing prices | `LIFE-03`, `LIFE-06`, `LIFE-10`, `DB-05` | Unit (pure functions) |
| `lib/currency.ts` | Domestic-India detection, trip currency, supported/unsupported conversion, rounding, normalize | None | Mixed-currency policy decisions | `LIFE-06`, `DB-03` | Unit |
| `lib/search.ts` | Price parsing, candidate mapping, URL scheme/host, normalize, featured selection, sum, Tavily retry/failure, cab route | None | Bad prices, bad links, silent failure | `SEC-11`, `LIFE-06`, `LIFE-10` | Unit + integration |
| `lib/ai.ts` | Planner prompt construction, best-effort rationale, chat bounds, extractor schema, error behavior | None | Prompt injection, unbounded cost, malformed extraction | `SEC-05`, `SEC-07` | Unit + integration |
| `app/api/trips/route.ts` | List scoping, create validation, currency selection, auth | None | Cross-tenant read/write | `SEC-01`, `SEC-03` | Integration |
| `app/api/trips/[id]/route.ts` | Read scoping, draft-only PATCH, stale-plan invalidation | None | Approved trip edited; stale itinerary submitted | `LIFE-02`, `SEC-06` | Integration |
| `plan/route.ts` | Status guard, 503 path, estimate/flags write, re-plan overwrite | None | Approved/booked trip re-planned | `LIFE-01`, `LIFE-03` | Integration |
| `submit/route.ts` | Draft-only, itinerary required, auto-approve vs pending, approver selection, transaction | None | Duplicate approvals, partial state | `LIFE-05`, `LIFE-08` | Integration |
| `book/route.ts` | Approved-only, idempotent re-run, alternate rows, concurrent delete/create | None | Duplicate/lost links | `LIFE-04`, `LIFE-05`, `DB-06` | Integration |
| `confirm-booking/route.ts` | Admin-only, status guard, per-booking confirmation, final `booked` rule | None | Booking without approval; every alternate must be confirmed | `LIFE-04`, `LIFE-07` | Integration |
| `approvals/route.ts`, `approvals/[id]/route.ts` | Queue scoping, assigned-approver check, role check, pending-only, trip-status guard | None | Employee-as-manager approval; stale decision | `SEC-06`, `LIFE-08` | Integration |
| `slack/route.ts` | Signature, linked user, status/approve/reject, duplicate retries, unavailable search | None | Forged requests; duplicate trips | `SEC-02`, `LIFE-11` | Integration |
| `places/suggest/route.ts` | Query bounds, upstream failure, result ranking, no fallback | None | Public proxy abuse; misleading suggestions | `SEC-04` | Integration |
| Pages / UI | Access states, action visibility, empty/unavailable states, confirm form, approvals | None | UI and API diverge | `LIFE-01`, `LIFE-12` | E2E |
| Database / migrations | Migration up/down, constraints, indexes, JSON compatibility, backup/restore | None | Data loss; invalid states | `DB-01`…`DB-07`, `OPS-01` | Migration + integration |
| Cross-cutting | CSRF, rate limits, headers, error mapping, audit events | None | All `SEC-*` controls unverified | `SEC-03`, `SEC-04`, `SEC-08`, `SEC-10`, `SEC-12` | Integration + E2E |

### 2.1 Coverage by risk area

| Area | Automated coverage today | Assessment |
|---|---|---|
| Authentication / authorization | 0% | Unverified; Critical finding |
| Policy / money / FX | 0% | Unverified; High findings |
| Lifecycle transitions | 0% | Unverified; High findings |
| API validation / error handling | 0% | Unverified |
| Search / AI failure behavior | 0% | Unverified |
| Concurrency / idempotency | 0% | Unverified |
| Migrations / backup | 0% | Unverified |
| UI / accessibility | 0% | Unverified |

No coverage percentage is claimed because no coverage tool was run.

---

## 3. Findings — test coverage

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| TEST-01 | High | `package.json:5-13`; repository-wide test-file search; `plan.md:228-237` | There is no test runner, no test script, no test file and no CI job. The only verification plan is a seven-step manual walkthrough in `plan.md:228-237`. | Every change to auth, policy, money, lifecycle or search is unverified. Regressions reach users silently. The Critical/High findings in the companion documents have no regression guard. | Add Vitest for unit/integration and Playwright for E2E; add `test`, `test:unit`, `test:integration`, `test:e2e`, `test:coverage` scripts; require them in CI. | `npm test` runs and fails on a deliberately broken assertion; CI blocks a PR when tests fail; coverage report is published. |
| TEST-02 | High | `lib/auth.ts:5-16`; `lib/slack.ts:4-22`; `app/api/approvals/[id]/route.ts:14-16`; `app/api/trips/[id]/route.ts:15-19` | No tests exercise authentication, the authorization matrix, role assignment or Slack signature verification. | The most dangerous defects (`SEC-01`, `SEC-02`, `SEC-06`) could be reintroduced without detection. A future route can omit `getCurrentUser` and no test notices. | Build an authz matrix test that calls every route as each role and as no session; unit-test Slack signatures; add a route-inventory test that fails if a mutating route lacks an auth guard. | Matrix tests pass for all allowed/denied cells; forged Slack payload tests return 401; a route added without auth fails the inventory test. |
| TEST-03 | High | `app/api/trips/[id]/plan/route.ts`; `submit/route.ts`; `book/route.ts`; `confirm-booking/route.ts`; `app/api/approvals/[id]/route.ts`; `app/trips/[id]/TripActions.tsx` | No tests enumerate state transitions, illegal transitions, re-planning, stale edits or the `booked` rule. | `LIFE-01`, `LIFE-02`, `LIFE-04`, `LIFE-07`, `LIFE-08` and `LIFE-12` are exactly the kind of defects a transition table test would catch. | Extract the transition rules into a pure module; test every `(state, actor, action)` cell; add integration tests for each route's guard and side effects. | Transition matrix has 100% cell coverage; every illegal transition returns 409; the booking test reaches `booked` with one confirmation per required leg. |
| TEST-04 | High | `lib/policy.ts`; `lib/currency.ts`; `lib/search.ts:87-111,259-283`; `prisma/schema.prisma:41,77,93-96` | No tests cover caps, flags, null prices, boundary equality, domestic-India detection, unsupported currencies, conversion rounding or price parsing. | A wrong approval decision or a mixed-currency comparison can pass unnoticed. `LIFE-03`, `LIFE-06` and `LIFE-10` are financial-control defects. | Unit-test every flag and boundary; property-test conversion and totals; test unsupported currency, missing price, zero, negative and huge values; test price-parser noise. | Policy/currency branch coverage ≥ 95%; boundary tests at cap-1/cap/cap+1; unsupported currency never compared silently. |
| TEST-05 | Medium | `lib/validators.ts`; all routes calling `req.json()` (`app/api/trips/route.ts:24`, `confirm-booking/route.ts:22`, `approvals/[id]/route.ts:20`, `chat/route.ts:16`) | No tests cover malformed JSON, missing fields, wrong types, oversized bodies, same-day/past/max-stay dates, strict ISO dates, chat limits or unknown fields. | Invalid input can produce 500s, stuck states or unbounded AI cost. `SEC-05`, `SEC-08` and `LIFE-09` are unverified. | Add table-driven validation tests for every schema; add route tests for malformed/oversized bodies; assert 400/413 and stable error codes. | Every schema has valid/invalid/boundary cases; malformed JSON returns 400, not 500; oversized chat returns 413. |
| TEST-06 | Medium | `app/trips/new/NewTripForm.tsx`; `app/trips/[id]/page.tsx`; `app/approvals/page.tsx`; `app/admin/page.tsx`; `plan.md:228-237` | No E2E or browser tests. The manual plan covers only the happy path and one search-failure scenario. | UI/API divergence, broken action visibility, inaccessible controls and missing unavailable states are undetected. `LIFE-12` (no cancel/reopen) and `SEC-10` (headers) have no browser check. | Add Playwright tests for the full lifecycle, unavailable search, approval/rejection, booking links, admin confirmation and role-based visibility; include an accessibility scan. | E2E suite passes on desktop and mobile viewports; failure path shows “unavailable” and no fabricated data; axe scan has no serious violations. |
| TEST-07 | Medium | `package.json:5-13`; no `.github/`, no CI configuration | There is no CI. Typecheck, lint, build, tests, migration checks, dependency audit and secret scan are not enforced. | A change can merge with a type error, failing build, vulnerable dependency or destructive migration. `OPS-03` notes there is no Git repository at all. | Add a CI pipeline: install, typecheck, lint, unit, integration, build, E2E smoke, `prisma migrate diff`/`migrate status`, `npm audit --production`, secret scan. Protect the main branch. | CI is required for merge; a deliberately failing typecheck/test/migration blocks the PR; audit and secret scan are green. |
| TEST-08 | Medium | `app/api/trips/[id]/submit/route.ts:69-78`; `book/route.ts:35-37,92-98`; `confirm-booking/route.ts:36-57`; `app/api/approvals/[id]/route.ts:26-33`; `prisma/schema.prisma:53-63,69-87` | No concurrency, retry, idempotency, transaction-rollback or migration tests. | `LIFE-05`, `LIFE-11`, `DB-01`…`DB-07` can cause duplicate approvals, lost links, partial states or data loss without a failing test. | Add concurrent-request tests for submit/book/approve/confirm; Slack replay tests; fault-injection tests between writes; migration up/down and restore tests. | Two concurrent requests produce one logical result; a mid-transaction failure leaves no partial state; migration and restore tests pass on a copy. |

---

## 4. Proposed test architecture

### 4.1 Tooling

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure modules: policy, currency, validators, Slack signature/parser, search parsing, URL allowlist, state machine |
| Integration | Vitest + route invocation or a running test server | Route handlers, Prisma, authz matrix, transactions, error mapping |
| E2E | Playwright | Browser flows, role visibility, failure states, accessibility |
| Migration | Prisma CLI in CI | `migrate deploy`, `migrate diff`, drift detection, restore rehearsal |
| Coverage | Vitest coverage (v8) | Branch/line report; thresholds per module |

### 4.2 Test data rules (no mock business data)

The project rule in `AGENTS.md:5-14` forbids mock/demo/sample/fixture/placeholder business data. The test plan must respect it:

1. Tests run against an **isolated test database** (`TEST_DATABASE_URL`), never `prisma/dev.db` and never production.
2. Test records are created inside the test and removed/rolled back; they are never seeded into the app, committed as seed data, or shown to real users.
3. External providers are stubbed at the **HTTP boundary** only. Stubs assert request shape and failure mapping; they never become fallback inventory in the application.
4. Tests that need a realistic search response use a recorded or hand-built provider payload in the test file, clearly marked as a test double. The application still has no fallback data path.
5. A small **staging canary** may call real Tavily/Groq with a dedicated key to verify live contracts; it is not part of the deterministic suite and never writes to production.
6. No test may assert a fabricated price or availability as if it were real; failure tests assert the “unavailable / price not listed” state.

### 4.3 Proposed scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --dir tests/unit",
    "test:integration": "vitest run --dir tests/integration",
    "test:e2e": "playwright test",
    "test:coverage": "vitest run --coverage"
  }
}
```

These scripts do **not** exist today; they are a proposal, not a change made by this audit.

### 4.4 Unit test plan

| Suite | Cases | Findings covered |
|---|---|---|
| `policy.evaluate` | Each flag; no flags; multiple flags; `PRICE_UNVERIFIED` for each null field; boundary at cap-1/cap/cap+1; `LATE_BOOKING` at 0/6/7/8 days; cabin allowed/disallowed; malformed `allowedCabins` | `LIFE-03`, `LIFE-06`, `LIFE-10`, `DB-05` |
| `currency` | Domestic India true/false; IATA and city hints; INR/USD selection; supported conversions; unsupported currency returns null; `normalizeMoney` keeps source on failure; rounding; zero/negative/huge amounts | `LIFE-06`, `DB-03` |
| `validators` | Required/optional fields; min/max lengths; strict ISO; one-way vs return; same-day; reversed dates; past dates; max stay; chat message count/length; approval enum; unknown fields | `SEC-05`, `LIFE-09` |
| `slack` | Missing secret; valid signature; wrong signature; missing timestamp; old timestamp; malformed signature; timing-safe path; parser for plan/status/approve/reject/help/bare text | `SEC-02`, `LIFE-11` |
| `search` | Price parser symbols/commas/decimals/noise; `toCandidates` host/source/scheme; normalize converted/unconverted; `pickFeatured` priority; `sumFeaturedEstimates` null/all-ok/empty; Tavily retry on 5xx/429; timeout; zero results | `SEC-11`, `LIFE-06`, `LIFE-10` |
| `url` (new helper) | `https` required; allowlisted host; subdomain rules; credentials; non-standard port; `javascript:`/`data:`; IDN/punycode | `SEC-11` |
| `state machine` (new pure module) | Every `(state, action, actor)` cell; illegal transitions; terminal states; cancel/reopen if added | `LIFE-01`, `LIFE-02`, `LIFE-04`, `LIFE-07`, `LIFE-08`, `LIFE-12` |

### 4.5 Integration test plan

| Suite | Cases | Findings covered |
|---|---|---|
| Auth matrix | Every route as no session, employee owner, employee non-owner, manager assigned/not assigned, admin; assert 200/403/404 | `SEC-01`, `SEC-06` |
| Trip CRUD | Create validation; list scoping; detail scoping; PATCH draft-only; PATCH clears stale plan; currency recompute | `LIFE-02`, `SEC-03` |
| Planning | Owner/admin only; status guard; 503 when all searches fail; partial success stored; estimate null vs zero; flags stored | `LIFE-01`, `LIFE-03`, `LIFE-10` |
| Submission | Draft-only; itinerary required; auto-approve path; pending path; approver selection/role; duplicate submit; transaction rollback | `LIFE-05`, `LIFE-08`, `SEC-06` |
| Booking links | Approved-only; idempotent re-run; alternates; concurrent runs; zero rows; status update | `LIFE-04`, `LIFE-05`, `DB-06` |
| Confirmation | Admin-only; status guard; booking must belong to trip; double confirm; final `booked` rule with alternates | `LIFE-04`, `LIFE-07` |
| Approvals | Queue scoping; pending-only; assigned approver; admin override; trip-status guard; duplicate decision | `SEC-06`, `LIFE-08` |
| Slack | Missing secret; forged signature; linked/unlinked user; plan/status/approve/reject; replay; unavailable search | `SEC-02`, `LIFE-11` |
| Places | Query too short/long; upstream 5xx/timeout; ranking; no fallback; rate limit | `SEC-04` |
| Error/contract | Malformed JSON; oversized body; wrong content type; stable error codes; no internal text | `SEC-05`, `SEC-08` |
| Concurrency | Two submits; two books; two confirms; two approvals; SQLite busy behavior | `LIFE-05`, `DB-06`, `DB-07` |
| Security controls | CSRF/origin; headers; rate limits; URL allowlist | `SEC-03`, `SEC-04`, `SEC-10`, `SEC-11` |
| Audit | One event per transition; immutable; actor/timestamp correct | `SEC-12` |

### 4.6 E2E test plan

| Scenario | Steps | Assertions | Findings covered |
|---|---|---|---|
| Employee happy path | Sign in → create trip → plan → submit within policy → auto-approved → generate links | No admin UI; real/unavailable states honest; links open provider domains | `TEST-03`, `TEST-06` |
| Manager approval | Employee submits over-policy → manager approves with comment | Queue scoped; comment persists; status changes once | `SEC-06`, `LIFE-08` |
| Rejection and revision | Manager rejects → employee edits/replans → resubmits | Rejected trip can be revised; old approval not reused | `LIFE-12` |
| Admin confirmation | Approved → links → admin confirms required legs | `booked` only after required legs; alternates do not block | `LIFE-04`, `LIFE-07` |
| Search unavailable | Stub all providers as failing → plan | 503/`unavailable` banner; no fabricated candidates or prices | `TEST-06` |
| Partial search | One provider fails, others succeed | Successful categories shown; failed category explicit | `TEST-06` |
| Stale plan | Plan → edit dates/cabin → submit | Submit blocked until re-plan; old estimate not used | `LIFE-02` |
| Re-plan approved | Approve → re-plan | Blocked or requires re-approval; status resets correctly | `LIFE-01` |
| Slack | Valid command, forged signature, replay, duplicate retry | Valid works; forged 401; replay 401; duplicate creates one trip | `SEC-02`, `LIFE-11` |
| Security headers | Load any page | CSP/HSTS/frame-ancestors/nosniff/referrer present | `SEC-10` |
| Accessibility | Keyboard through place typeahead, approval form, confirm form | Focus visible; combobox roles; no serious axe violations | `TEST-06` |

### 4.7 CI gates

| Gate | Command | Blocks merge |
|---|---|---|
| Install | `npm ci` | Yes |
| Typecheck | `npx tsc --noEmit` | Yes |
| Lint | `npm run lint` (after adding a config) | Yes |
| Unit | `npm run test:unit` | Yes |
| Integration | `npm run test:integration` | Yes |
| Build | `npm run build` | Yes |
| E2E smoke | `npm run test:e2e -- --grep @smoke` | Yes |
| Migration | `npx prisma migrate status` / `migrate diff --exit-code` | Yes |
| Dependency audit | `npm audit --production` | High/critical yes |
| Secret scan | `gitleaks` or equivalent | Yes |

No CI exists today (`TEST-07`).

---

## 5. Coverage targets and exit criteria

| Area | Target |
|---|---|
| `lib/policy.ts`, `lib/currency.ts`, state machine | ≥ 95% branch coverage |
| `lib/validators.ts`, `lib/slack.ts`, URL helper | ≥ 90% branch coverage |
| Every API route | At least one integration test per method and per authorization outcome |
| Authorization matrix | 100% of cells exercised |
| Lifecycle transitions | 100% of `(state, action)` cells, including illegal transitions |
| Critical/High findings | Each has at least one regression test before closure |
| Migration | Up/down and restore rehearsal on a copy of production-like data |
| E2E | Happy path, approval/rejection, unavailable search, stale plan, booking confirmation, Slack |

**Exit criteria for Phase 1:**

1. `npm test` exists and passes locally and in CI.
2. The authz matrix, lifecycle matrix and money/policy suites are green.
3. Every `Critical` and `High` finding in `SECURITY_AUDIT.md` and `PRODUCTION_AUDIT.md` has a named regression test.
4. A migration and restore rehearsal has passed on a copy.
5. No test relies on committed business data; the isolated test DB is cleaned up.

---

## 6. Honest conclusion

The application has **no automated tests**. The two checks that were run — TypeScript compilation and Prisma schema validation — passed, and they establish only that the code and schema are syntactically/type valid. They do not establish that authentication, authorization, policy, money, lifecycle or search behavior is correct.

Any statement that the app “works” today rests on manual walkthroughs and code inspection. That is not sufficient for a production travel and approval system.
