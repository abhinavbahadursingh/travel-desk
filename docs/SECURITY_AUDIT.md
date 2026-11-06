# Security Audit — Corporate Travel Agent

> **Status note (2026-11-04, four-role release).** `SEC-06` (approver role/assignment) and the
> self-role escalation path are fixed and verified; approval decisions are transactional with
> mandatory rejection reasons. `SEC-01` (no real authentication; `DEV_USER_EMAIL` impersonation) is
> intentionally still open for local development and remains the top production blocker. See
> `plan.md` and `WORKING.md` for the current state.

**Phase:** 0 (read-only)
**Date:** 2026-11-04
**Scope:** Authentication, authorization, input validation, secrets, injection, abuse controls, browser/transport hardening and auditability.
**Mode:** Audit only. No code, schema, configuration or data was changed.

**Companion documents**

- [`PRODUCTION_AUDIT.md`](./PRODUCTION_AUDIT.md) — architecture, schema, lifecycle, migration and operations (`DB-*`, `LIFE-*`, `CFG-*`, `OPS-*`).
- [`TEST_COVERAGE.md`](./TEST_COVERAGE.md) — test gaps and proposed security tests (`TEST-*`).
- [`PRODUCTION_ROADMAP.md`](./PRODUCTION_ROADMAP.md) — remediation order.

Findings owned by this document use `SEC-*` IDs. Findings owned by the production audit are referenced, not restated.

---

## 1. Threat model

### 1.1 Assets

| Asset | Location | Why it matters |
|---|---|---|
| Trip requests | `TripRequest` (`prisma/schema.prisma:27-51`) | Employee names, routes, dates, purposes, notes, costs |
| Approvals | `Approval` (`:53-63`) | Who approved what, when, and with what comment |
| Booking references | `Booking.reference` (`:81-84`) | Real external confirmation codes |
| Travel policy | `TravelPolicy` (`:89-99`) | Financial control thresholds |
| AI/search spend | Groq and Tavily credentials | Direct monetary cost and denial of service |
| Secrets | `.env` | Groq, Tavily, Slack and database access |
| Audit integrity | Status fields and decision rows | Financial and compliance evidence |

### 1.2 Actors and trust boundaries

```text
Unauthenticated internet ──► Next.js pages / route handlers
Employee browser ──────────► Next.js pages / route handlers
Manager browser ───────────► /approvals, approval API
Travel admin browser ──────► /admin, confirm-booking API
Slack workspace ───────────► POST /api/slack
Server ────────────────────► Groq, Tavily, Google Maps, Open-Meteo
Server ────────────────────► SQLite
```

The application has no session boundary: every browser request is resolved to the same `DEV_USER_EMAIL` account (`SEC-01`). The Slack boundary is the only one with a cryptographic check, and that check fails open when the secret is missing (`SEC-02`).

### 1.3 Assumptions used for severity

- The app will be reachable by multiple employees, not only `localhost`.
- Real trips, approvals and booking references will be stored.
- The deployment is single-tenant (one company, one policy), as stated in `plan.md:46`.
- The attacker can send arbitrary HTTP requests, including cross-site requests from a browser, and can submit arbitrary Slack payloads if the endpoint is reachable.

---

## 2. Findings summary

| Severity | Count | IDs |
|---|---:|---|
| Critical | 2 | `SEC-01`, `SEC-02` |
| High | 4 | `SEC-03`, `SEC-04`, `SEC-05`, `SEC-06` |
| Medium | 6 | `SEC-07`, `SEC-08`, `SEC-09`, `SEC-10`, `SEC-11`, `SEC-12` |
| Low | 0 | — |

---

## 3. Authentication and authorization

### 3.1 Findings

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| SEC-01 | Critical | `lib/auth.ts:5-16`; `app/layout.tsx:14-19`; all pages/routes calling `getCurrentUser()` (for example `app/api/trips/route.ts:8,23`, `app/trips/[id]/page.tsx:120`, `app/admin/page.tsx:53`) | Identity is the value of `DEV_USER_EMAIL`. `getCurrentUser()` looks up that one row and returns it; there is no login, session, cookie, token, logout or SSO. Every visitor is the same user. `DEV_USER_ROLE` defaults to `travel_admin` in the seed (`prisma/seed.ts:17`) and `.env.example:27`. | In production, every visitor becomes the configured account. If it is `travel_admin`, every visitor can read all trips, approve/reject, generate links and confirm bookings. There is no way to attribute an action to a real person. This invalidates every authorization check in the app. | Add real authentication (OIDC/SSO or a maintained auth library) with server-side sessions; map the authenticated subject to `User.id`; remove `DEV_USER_EMAIL` impersonation from production; require role assignment through an admin flow; add logout and session expiry. | An unauthenticated request is redirected/401. Two sessions resolve to different users. A role matrix test proves employee/manager/admin boundaries. Removing `DEV_USER_EMAIL` does not break login. |
| SEC-02 | Critical | `lib/slack.ts:9-10`; `app/api/slack/route.ts:10-28` | `verifySignature` returns `true` when `SLACK_SIGNING_SECRET` is unset. The route then trusts `user_id` from the form body and looks up the linked user. | Anyone who can reach `/api/slack` can forge a `user_id` and: create trips and spend Groq/Tavily credits, list a user's trips, approve/reject that user's pending approvals. This bypasses Slack entirely and is reachable from the internet if the route is exposed. | Fail closed in production: refuse to start or return 503 when the secret is missing. Require timestamp and signature; keep the 5-minute replay window; verify the raw body exactly; consider Slack's `X-Slack-Retry-Num` handling. | With the secret unset, production returns 503/500 and never processes the command. A forged signature returns 401. A valid signature succeeds. A replay older than 5 minutes returns 401. |
| SEC-03 | High | `app/api/trips/route.ts:22-45`; `app/api/trips/[id]/route.ts:23-76`; `app/api/trips/[id]/plan/route.ts:10-93`; `app/api/trips/[id]/submit/route.ts:8-80`; `app/api/trips/[id]/book/route.ts:10-99`; `app/api/trips/[id]/confirm-booking/route.ts:13-63`; `app/api/trips/[id]/chat/route.ts:8-34`; `app/api/approvals/[id]/route.ts:6-34`; `app/api/slack/route.ts:10-212` | Every state-changing route accepts a request without a CSRF token, `Origin`/`Referer` check, or SameSite session cookie. No route checks `Content-Type`. `req.json()` parses any body regardless of the declared type. | Because identity is ambient (the env-configured user), a malicious page can submit a cross-site request to a reachable deployment and act as that user: create a trip, submit it, approve/reject, generate links, or confirm a booking. With real cookie auth added later, the same gap becomes classic CSRF. | Add a session cookie with `SameSite=Lax/Strict`, `Secure`, `HttpOnly`; verify `Origin`/`Referer` on every mutating request; issue and validate a CSRF token (double-submit or synchronizer); reject non-JSON content types where JSON is expected; consider a central wrapper/middleware. | Cross-origin POST without a token returns 403. Same-origin POST with a valid token succeeds. A `text/plain` body is rejected with 415. Tests cover every mutating route. |
| SEC-04 | High | `app/api/trips/[id]/plan/route.ts:10-33`; `app/api/trips/[id]/chat/route.ts:8-32`; `app/api/slack/route.ts:76-122`; `app/api/places/suggest/route.ts:89-151`; `app/api/trips/route.ts:22-45` | There is no rate limit, quota, concurrency cap or spend guard on any route. `/plan` runs four Tavily searches plus a Groq call per request. `/chat` runs a Groq call per message. Slack planning does the same. The public places endpoint proxies Open-Meteo without authentication. | A single authenticated or unauthenticated caller can exhaust Groq/Tavily quota, run up cost, saturate the SQLite writer and deny service to employees. A loop against `/api/slack` or `/api/places/suggest` needs no account when `SEC-01`/`SEC-02` are unresolved. | Add per-user and per-IP rate limits; per-user daily/monthly AI and search budgets; max concurrent plans per user; cache identical searches; require authentication for places (or strict IP limits); return `429` with `Retry-After`; alert on spend anomalies. | Load tests hit each endpoint above the limit and receive 429; a second concurrent plan for the same user is rejected or queued; spend dashboards show the cap enforced; the places endpoint is not usable as a free proxy. |
| SEC-05 | High | `lib/validators.ts:48-57`; `app/api/trips/[id]/chat/route.ts:16-32`; `lib/ai.ts:208-230` | `chatSchema` requires at least one message but sets no maximum on the number of messages or on `content` length. The entire array is forwarded to Groq; only output `max_tokens` is capped. `req.json()` has no body-size check. | A single request can send thousands of messages or megabytes of text, incurring large input-token cost, exhausting memory/context limits and creating a denial-of-service vector. The same unbounded surface is a delivery mechanism for prompt injection (`SEC-07`). | Cap messages (for example 20), per-message characters (for example 4,000), total characters and request body size. Reject with 400/413. Add a per-user chat budget and truncate context deliberately. | A 1,000-message payload returns 400; a 1 MB message returns 413; the Groq call is never made for rejected input. |
| SEC-06 | High | `app/api/approvals/[id]/route.ts:14-16`; `app/api/slack/route.ts:48-51`; `app/api/trips/[id]/submit/route.ts:65-67`; `app/approvals/page.tsx:9-17` | Approval decisions are authorized by `approval.approverId === user.id` or `user.role === "travel_admin"`, with no check that the assigned approver actually has the `manager` or `travel_admin` role. `submit` assigns `trip.requester.managerId` directly, regardless of that user's role. The approvals page hides the queue from non-managers, but the API does not. | If an employee is (mis)configured as another user's `managerId`, that employee can approve via the API or Slack even though the UI says “Approver access only”. This is a privilege-escalation path through data configuration, and it undermines the manager approval control. | Require the approver to have `role in ("manager", "travel_admin")` **and** be the assigned approver (or be an admin override). Validate `managerId` points to a manager/admin at assignment time. Return 403 otherwise. | An employee assigned as `managerId` gets 403 from both the API and Slack. A manager can decide only assigned approvals. An admin override is explicit and audited. |

### 3.2 Authorization matrix (current behavior)

Legend: **A** allowed, **D** denied, **C** conditional, **—** not applicable. “Public” means no session; today it still resolves to the env-configured user.

| Route / action | Public | Employee owner | Employee non-owner | Manager assigned | Manager not assigned | Travel admin |
|---|---|---|---|---|---|---|
| `GET /api/trips` | A (as env user) | A (own) | A (own only) | A (own only) | A (own only) | A (all) |
| `POST /api/trips` | A (as env user) | A | A | A | A | A |
| `GET /api/trips/[id]` | A (as env user) | A | D | A if approver | D | A |
| `PATCH /api/trips/[id]` | A (as env user) | C (draft) | D | D | D | D (owner check only) |
| `POST /plan` | A (as env user) | C (any status) | D | D | D | C (any trip) |
| `POST /submit` | A (as env user) | C (draft + itinerary) | D | D | D | D |
| `POST /book` | A (as env user) | C (approved) | D | D | D | C (approved) |
| `POST /confirm-booking` | A (as env user) | D | D | D | D | C (any status with a row) |
| `POST /chat` | A (as env user) | A | D | D | D | A |
| `GET /api/approvals` | A (as env user) | D (empty list) | D (empty list) | C (assigned) | D (empty list) | C (assigned/admin) |
| `POST /api/approvals/[id]` | A (as env user) | C if assigned, regardless of role | D | C (assigned) | D | A |
| `POST /api/slack` | C (signature, or open if secret unset) | C (linked Slack user) | C (linked Slack user) | C (linked Slack user) | C (linked Slack user) | C (linked Slack user) |
| `GET /api/places/suggest` | A (public) | A | A | A | A | A |
| `/admin` page | A (as env user) | D (UI) | D (UI) | D (UI) | D (UI) | A |
| `/approvals` page | A (as env user) | D (UI) | D (UI) | A | D (UI) | A |

The matrix is only meaningful once `SEC-01` is fixed; today “Public” and “Employee owner” can be the same person.

---

## 4. Input validation, injection and abuse

### 4.1 Findings

| ID | Severity | Files | Current behavior | Risk | Fix | Verification |
|---|---|---|---|---|---|---|
| SEC-07 | Medium | `lib/ai.ts:166-199`; `lib/ai.ts:218-226`; `lib/ai.ts:240-291`; `app/api/slack/route.ts:83`; `app/api/trips/[id]/plan/route.ts:24-33` | User-controlled fields (`purpose`, `origin`, `destination`, `cabin`) are interpolated into the planner prompt; chat messages are appended verbatim after the system prompt; Slack freeform text is sent to the extractor. The model is instructed not to invent data, but no input is delimited or escaped, and the extractor output is only checked for presence and basic date order, not schema-validated. | Prompt injection can make the rationale or chat output contradict the real search results, misstate policy, or produce misleading advice. The Slack extractor can be steered into unexpected origin/destination/date values (then checked only for presence and basic date validity at `slack/route.ts:83-102`). No tool can book or pay, so the impact is content integrity rather than direct transaction. | Delimit untrusted data (for example JSON with explicit `untrusted` markers), keep instructions in a separate channel, validate extracted fields with Zod, cap lengths, and treat model output as display-only. Add a “generated, not verified” label and never let the model set lifecycle state. | Adversarial prompts (“ignore previous instructions”, embedded fake prices) do not change tool arguments or lifecycle state; output remains source-grounded; malformed extraction is rejected, not persisted. |
| SEC-08 | Medium | `lib/search.ts:242-249`; `app/api/trips/[id]/plan/route.ts:37-45`; `app/api/slack/route.ts:136-144`; `lib/ai.ts:122`; `app/trips/[id]/page.tsx:453-455`; unguarded `req.json()` at `app/api/trips/route.ts:24`, `app/api/trips/[id]/route.ts:34`, `app/api/trips/[id]/confirm-booking/route.ts:22`, `app/api/approvals/[id]/route.ts:20`, `app/api/trips/[id]/chat/route.ts:16` | Upstream exception text is returned as `reason` and rendered in the UI; a Groq failure is embedded in the rationale. Malformed JSON throws before `safeParse`, producing an unhandled 500. | Error text can disclose internal hostnames, upstream status, implementation details and provider behavior. Malformed input produces 500s instead of 400s, which is noisy and can leak stack traces depending on the deployment. | Map errors to stable public codes (`search_unavailable`, `ai_unavailable`, `invalid_json`) and log the detail server-side with a request ID. Wrap body parsing in a helper that returns 400. Never render raw exception messages. | Malformed JSON returns 400 with a stable JSON error; a forced Tavily/Groq failure returns a generic code; logs contain the detail but the response does not. |
| SEC-09 | Medium | `.env` (mode `644`); `prisma/dev.db` (mode `644`); `.gitignore:3-6` | The secret file and the database are world-readable on the host. `.gitignore` correctly excludes `.env` and `dev.db`, and no secret logging was found. | Any local account or process can read Groq/Tavily/Slack secrets and all trip/booking data. On a shared CI runner or developer machine, this is a direct credential and PII exposure. | `chmod 600` for `.env` and the DB; use a secret manager or injected environment in production; encrypt the database at rest; restrict backup access; rotate keys if the file was ever exposed. | `stat` shows `600`; a secret scan finds no keys in the repo; production secrets are not present in the filesystem image; backups are encrypted. |
| SEC-10 | Medium | `next.config.mjs:1-6` | No security headers are configured: no CSP, HSTS, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. | The app can be framed (clickjacking), has no defense-in-depth against XSS, may leak referrers to provider sites, and can be downgraded without HSTS. | Add headers in `next.config.mjs` or a middleware: strict CSP (start with `default-src 'self'`, adjust for Next), HSTS, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal permissions. | `curl -I` shows the headers; a CSP report-only run has no unexpected violations; framing the app is blocked. |
| SEC-11 | Medium | `lib/search.ts:178,200-211`; `app/api/trips/[id]/book/route.ts:58-64`; `app/trips/[id]/page.tsx:391-396` | Tavily results are accepted when `url.startsWith("http")`; there is no HTTPS requirement and no host allowlist at storage/render time. The URL is stored as `Booking.url` and rendered directly as an `href`. `rel="noopener noreferrer"` is present. | A malicious or compromised search result can become a clickable booking link to a phishing or malware site. `http://` links allow downgrade. `include_domains` is a search hint, not a guarantee. | Require `https:`; validate against an allowlist of provider domains per category; store and display the hostname prominently; consider an interstitial for non-allowlisted hosts; reject URLs with credentials or non-standard ports. | Non-HTTPS, non-allowlisted, credentialed and odd-port URLs are rejected at ingestion; UI shows the hostname; a test attempts a `javascript:`/`data:`/`http:` URL. |
| SEC-12 | Medium | `app/api/approvals/[id]/route.ts:26-33`; `app/api/trips/[id]/confirm-booking/route.ts:36-44`; `app/api/slack/route.ts:58-69`; `app/api/trips/[id]/plan/route.ts:65-84`; `app/api/trips/[id]/submit/route.ts:69-78` | Status changes overwrite the current row. There is no append-only audit table and no record of the actor, reason or previous value for plan/submit/status changes. Approval has `approverId`/`decidedAt`, and confirmation has `confirmedById`, but those are current-state fields, not an immutable event log. | After a disputed approval or booking, there is no reliable history of who changed what, when, or why. A re-plan can erase the itinerary that was approved (`LIFE-01`), leaving no evidence of the approved version. | Add an append-only `AuditEvent` table (actor, action, entity, before/after hash or snapshot, timestamp, request ID). Emit events for create/edit/plan/submit/approve/reject/book/confirm/cancel. Make it write-once and restrict deletion. | Every transition produces exactly one event; the event log reconstructs a trip's full history; an attempt to update/delete an event is rejected. |

---

## 5. Secrets and configuration

| Control | Status | Evidence |
|---|---|---|
| Secrets excluded from version control | **Pass** | `.gitignore:3-6` covers `.env`, `.env.local`, `dev.db`, `dev.db-journal` |
| Secrets absent from logs | **Pass** | Only `prisma/seed.ts:51-57` logs; no key values |
| Secrets not exposed to the browser | **Pass by inspection** | All key reads are in server-only modules; no `NEXT_PUBLIC_*` key |
| File permissions | **Fail** | `.env` and `prisma/dev.db` are `644` (`SEC-09`) |
| Startup validation | **Fail** | No env schema; missing values fail at request time (`CFG-01`) |
| Slack secret required | **Fail** | Fail-open when unset (`SEC-02`) |
| Default role safe | **Fail** | Seed defaults to `travel_admin` (`CFG-01`) |
| FX rate explicit | **Fail** | Silent default `83` (`CFG-01`, `LIFE-06`) |

Tavily sends its key in the JSON body over HTTPS (`lib/search.ts:136-156`); Groq uses the official SDK (`lib/ai.ts:18-23`); Slack uses HMAC (`lib/slack.ts:14-18`). No key is placed in a URL query string in the reviewed code.

---

## 6. Controls verified present

These are positive controls; they do not close the findings above.

1. **Slack HMAC is timing-safe and replay-bounded when configured.** `crypto.timingSafeEqual` plus a 300-second window (`lib/slack.ts:11-21`).
2. **No raw SQL.** No `$queryRaw`/`$executeRaw` in `app/`, `lib/` or `components/`; Prisma parameterizes queries.
3. **No HTML injection sink.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in application code. React escapes rendered text.
4. **Zod validation exists on the main JSON routes.** Trip create/patch, approval decision, chat and confirm-booking (`lib/validators.ts:3-57`, `confirm-booking/route.ts:8-11`).
5. **Trip reads are scoped.** Owner, assigned approver or admin (`app/api/trips/[id]/route.ts:15-19`, `app/trips/[id]/page.tsx:130-143`).
6. **Approval decisions are scoped to the assigned approver or admin** (`app/api/approvals/[id]/route.ts:14-16`), subject to the role gap in `SEC-06`.
7. **Booking confirmation is admin-only** (`app/api/trips/[id]/confirm-booking/route.ts:16-18`), subject to the state gap in `LIFE-07`.
8. **Outbound links use `rel="noopener noreferrer"`** (`app/trips/[id]/page.tsx:391-396`).
9. **No simulated transactions.** `/book` stores links only (`book/route.ts:6-9`); the UI discloses this (`app/trips/[id]/page.tsx:354-357`).
10. **No mock data.** The only seeded records are the configured account and policy (`prisma/seed.ts:24-49`). The live DB also has one real draft trip created through the app during final verification; it is not seed data (live counts in `PRODUCTION_AUDIT.md:§1.2`).

---

## 7. Security test plan (summary)

Detailed cases are in `TEST_COVERAGE.md`; this is the security-specific subset.

| Test area | Cases | Findings |
|---|---|---|
| Identity | No session → 401/redirect; two users → different data; env impersonation absent in production | `SEC-01` |
| Slack | Missing secret fails closed; bad signature 401; replay >5 min 401; valid signature accepted; forged `user_id` cannot act | `SEC-02` |
| CSRF/origin | Cross-origin POST rejected; missing token rejected; `text/plain` rejected; valid same-origin accepted | `SEC-03` |
| Rate limits | 429 after N requests per user/IP; concurrent plans capped; places endpoint limited | `SEC-04` |
| Chat bounds | >max messages 400; >max chars 413; Groq not called | `SEC-05` |
| Approval roles | Employee assigned as manager → 403; manager not assigned → 403; admin override audited | `SEC-06` |
| Prompt injection | Instruction override, fake price, fake policy text → no state change, output source-grounded | `SEC-07` |
| Error handling | Malformed JSON → 400; upstream failure → generic code; no stack/internal host in response | `SEC-08` |
| Secrets | File modes 600; no key in repo/logs; production boot fails without required keys | `SEC-09`, `CFG-01` |
| Headers | CSP/HSTS/frame-ancestors/nosniff/referrer present | `SEC-10` |
| URLs | `javascript:`, `data:`, `http:`, credentialed, non-allowlisted hosts rejected | `SEC-11` |
| Audit | Every transition emits one immutable event; update/delete rejected | `SEC-12` |

---

## 8. Residual risk statement

After the Critical and High findings are fixed, the largest remaining risks are:

1. **Approval integrity** — the approved itinerary can still change unless `LIFE-01`/`LIFE-02` are fixed and approvals are bound to an itinerary version.
2. **Booking integrity** — `booked` still requires confirming alternates unless `LIFE-04` is fixed.
3. **Money integrity** — hardcoded FX and mixed currencies remain unless `LIFE-06`/`DB-03` are fixed.
4. **Supply chain** — outdated Next/React RC dependencies remain until `CFG-03` is fixed.
5. **Detection** — without `SEC-12`/`OPS-02`, abuse and disputed actions are not reconstructable.

The application is **not safe to expose to real employees or real booking workflows** in its current state.
