# Project rules

## No mock data — ever

- Never add mock, demo, sample, fixture, placeholder or seeded business data.
- Do not create sample trips, users, bookings, approvals, itineraries, prices or inventory.
- The only records `prisma/seed.ts` may create are the env-configured local account
  (`DEV_USER_EMAIL` / `DEV_USER_NAME` / `DEV_USER_ROLE` / `DEV_USER_DEPARTMENT`) and the
  travel policy. The seed sets the role only when creating the account; roles are managed
  afterwards by a super admin so re-seeding cannot escalate an account.
- All inventory and prices must come from real web search at request time. Never
  fabricate a listing, flight number, hotel, train, fare or availability.
- If a source has no price, show "price not listed". If search fails, show the
  unavailable state. Never fall back to fake data.
- Do not re-add the old demo accounts (`alice@acme.test`, `bob@acme.test`,
  `carol@acme.test`) or test trips.
- Booking confirmation references must be typed by a travel admin/super admin from a real
  provider. Never generate, seed or fabricate a reference.

This rule stays in force until the user explicitly says otherwise.

## Roles and authorization

- Roles are `employee`, `manager`, `travel_admin`, `super_admin`.
- Authorization is enforced server-side only. Never trust a client-supplied role; resolve the
  caller with `getCurrentUser()` and check with the helpers in `lib/auth.ts`.
- Employees can never approve their own requests, change their own role, confirm bookings or
  modify policy. Those paths must stay blocked in the API, not just hidden in the UI.
- Approval resolution order is: assigned manager → departmental manager → travel admin →
  super admin. The approver must be active, must not be the requester, and must have an
  approver role. Never auto-approve an employee request or bypass approval because no
  approver exists — return an actionable `409`.
- Use `withApi` and `ApiError` so errors keep the standard envelope and status codes
  (`400` validation, `403` authorization, `404` missing, `409` conflict, `502/503` upstream).

## State machine

- `draft → pending_approval → approved | rejected`, with `changes_requested` returning the
  trip to `draft` while preserving approval history.
- `approved → booking_links_generated → booking_pending_confirmation → booked`.
- `booked → cancellation_requested → cancelled` only after a verified provider cancellation
  reference. Planning never implies approval, approval never implies booking, opening a link
  never changes state, and a cancellation request never cancels anything by itself.
- Guard transitions with conditional `updateMany` checks inside a transaction so concurrent
  decisions return `409` instead of corrupting state.

## Schema and data safety

- Schema changes are additive. Apply them to a temporary copy first, then to the real database
  with `prisma db push`. Never reset or delete existing records.
- Deactivate accounts instead of deleting them so approvals, trips and bookings stay intact.
- Run `npx tsc --noEmit` and `npx next build` before calling a change done.

## Layout and spacing

- The root layout owns page width. `main` uses the `app-main` class in `app/globals.css`, which
  fills the space beside the fixed sidebar (geometry is driven by `--sidebar-w`,
  `--sidebar-gap` and `--shell-gutter`). Never re-add `max-w-*` caps or centered containers
  inside pages.
- Spacing scale: cards `p-5`, page heroes `p-6 sm:p-8`, list headers `px-5 py-4 sm:px-6`,
  empty states `px-6 py-14`, stat tiles use the `stat-tile` class, page columns `space-y-6`,
  metric grids `gap-4`, content grids `gap-6`, table wrappers use `table-scroll`, form grids
  `gap-4`. Do not introduce new magic padding or margin values.
- Tables rely on `.table-glass` edge padding to line up with card headers; keep horizontal
  scrolling inside `table-scroll` containers so tables are never clipped by a card.
- Grid children must keep `min-width: 0` (defined in `globals.css`) so long content cannot push
  a column wider than the grid.

## Development servers

- `npm run dev` is pinned to port 3000. Never run two dev servers against the same `.next`
  directory — stale route manifests cause missing-route 404s. Use `NEXT_DIST_DIR` for isolated
  verification servers.
