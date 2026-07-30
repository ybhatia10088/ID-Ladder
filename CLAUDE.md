<!-- stripe-projects-cli managed:claude-md:start -->
look at AGENTS.md for your rules
<!-- stripe-projects-cli managed:claude-md:end -->

# ID-Ladder

## Stack (fixed — do not add to it)

- **Client:** React + Vite + TypeScript, in `/client`
- **Server:** Express + TypeScript, in `/server`
- **Database:** SQLite via `better-sqlite3` (synchronous, no ORM)
- **Auth:** Auth0 React SDK (`@auth0/auth0-react`) on the client
- **Payments:** Stripe Node SDK, **test mode only**
- **Deploy:** one process — Express serves the built client as static files

### Do not introduce

Next.js, Prisma, Supabase, Docker, or any dependency not listed above. If a task
seems to need one, say so and stop rather than adding it. This includes
"temporary" or dev-only additions.

## Architecture

Single deployable process. There is no separate frontend host.

- In **production**, Express serves `client/dist` as static files and falls back
  to `index.html` for non-`/api` routes (SPA routing).
- In **development**, Vite dev server runs on `5173` and proxies `/api/*` to
  Express on `3000`. Client code should therefore always call the API with
  relative paths (`/api/...`), never an absolute origin.
- All server routes live under `/api`. Anything not under `/api` belongs to the
  client bundle.

## Money

**Money is always integer cents.** No floats, no decimals, anywhere — not in
TypeScript, not in SQLite columns, not in JSON payloads over the wire. Store
`amount_cents INTEGER`. Format to dollars only at the render edge in the client.
This matches Stripe's own representation, so amounts pass through untouched.

## Conventions

- TypeScript everywhere; no `.js` source files.
- Server compiles to `server/dist` with `tsc`; client builds to `client/dist`
  with Vite.
- Secrets live in `.env` at the repo root (gitignored). Never commit real keys,
  and never expose a secret to the client — Vite only exposes vars prefixed
  `VITE_`, so anything sensitive must stay server-side.
- Stripe stays in test mode. Do not add live keys or code paths that branch on
  live mode.

## Commands

```bash
npm install          # installs root + client + server (npm workspaces)
npm run dev          # runs client (5173) and server (3000) together
npm run build        # builds client, then compiles server
npm start            # production: single process on PORT (default 3000)
npm run seed         # drops and rebuilds the SQLite demo database
npm run typecheck    # typechecks both workspaces
```

`PORT` overrides the Express port and the Vite proxy target together, so
`PORT=3100 npm run dev` moves both consistently. Use it when something else is
already on `3000`.

## Jurisdiction rules (the core domain constraint)

A state's vital records office only holds records for people **born in that
state**, and a state's fee-waiver program generally reaches only **its own
records**. An organization's verified standing is likewise per-state. So a
California-verified provider cannot attest for a Michigan-held birth record,
and the client must be routed to an organization with Michigan standing.
`organizations.standing_jurisdictions` and `attestations.valid_in_jurisdiction`
exist to enforce exactly this — do not collapse them into a global flag.

Fee waivers almost always require a **verified homeless services provider** to
sign an affidavit or submit the request. The one researched exception is the
Washington identicard (RCW 46.20.195), which turns on self-attestation. Do not
generalize either way without checking the seed comments.

## Research discipline

Every seeded fee and waiver rule carries an inline comment with the source URL
it came from. When adding or changing one:

- Cite a real, current source. Prefer the issuing agency's own page.
- If a figure cannot be verified, set it to `NULL` and comment it `UNVERIFIED`.
  **Never guess a government fee.** A gap is better than a fabrication.
- Fees change. Re-check before relying on a figure; the CA birth record fee is
  already scheduled to drop $2 in 2027.

## Resolver labels

A waiver is **not real until a provider signs**. That distinction is the whole
product, so the labels keep it explicit:

| Label | Meaning | Costs money? |
|---|---|---|
| `HELD` | already in `case_holdings` | no |
| `PAID` | a `succeeded` payment exists for this case + document | no |
| `WAIVED` | an attestation exists whose `valid_in_jurisdiction` matches the document's jurisdiction | no |
| `WAIVABLE_PENDING` | waiver exists and the org has standing, but nobody has signed yet | **yes, full fee** |
| `BLOCKED_JURISDICTION` | waiver exists but the org lacks standing there | **yes, full fee** |
| `PAYABLE` | has a fee, no waiver exists | yes |
| `PAYABLE_UNVERIFIED` | no waiver and `fee_cents IS NULL` | unknown — excluded from the total |

`counts_toward_total` is `chargeable && fee_cents !== null`. A chargeable step
with an unverified fee sets `has_unverified_costs`, so the total is reported as
a floor rather than silently understated by treating NULL as 0.

## Status

Milestone 1 complete: client/server scaffold, `GET /api/health`, dev proxy,
combined dev script, static serving in production.

Milestone 2 complete: SQLite schema at [server/src/db/schema.sql](server/src/db/schema.sql),
cited seed data at [server/src/db/seed.ts](server/src/db/seed.ts), and an
idempotent `npm run seed`.

Milestone 3 complete: pure resolver in [server/src/resolver.ts](server/src/resolver.ts)
and `GET /api/cases/:id/plan`.

Milestone 4 complete: attestations drive the plan (`POST /api/cases/:id/attest`),
per-document payment via Stripe hosted Checkout (`POST /api/cases/:id/pay`),
and an org subscription (`POST /api/organizations/:id/subscribe`).

Milestone 5 complete: Auth0 Universal Login via `@auth0/auth0-react`, and the
single-screen case view.

Auth0 notes:
- Auth0 config is served at runtime from `GET /api/config`, so the callback URL
  comes from `APP_BASE_URL` (or the request origin) and is never hardcoded and
  never baked into the bundle at build time.
- The API validates the browser's access token against Auth0's `/userinfo`
  rather than verifying a JWT locally, which avoids a JWKS dependency.
- Auth0 Organizations is not configured on this tenant, so membership lives in
  `user_organizations`. The signed-in user's organization — never the case's —
  supplies the standing the resolver uses.

Not built yet: a Stripe webhook (payments settle on the browser redirect only).
