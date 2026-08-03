# ID Ladder

**A working model of the paperwork someone needs to climb out of homelessness — and of who's actually allowed to help them do it.**

Getting a state ID sounds simple until you've never had one. In most states, a state ID requires a certified birth certificate. A birth certificate has a fee. That fee is often waived for people experiencing homelessness — but *only* if a verified homeless-services provider signs an affidavit vouching for them. And that provider's authority to vouch is usually scoped to a single state.

So the real question isn't "what does this cost?" It's: *does the organization standing in front of this client actually have the standing to help them, in the state that holds their record?*

ID Ladder answers that question as a live computation, not a checklist. Give it a client's birth state, current state, and goal document; give it an organization's approved jurisdictions; it walks the actual dependency graph of records and tells you exactly what's covered, what's blocked, and why — in plain language, with a citation to the law behind every number.

It's a small project right now — three states, one federal record, fourteen documents. But the mechanism underneath (a jurisdiction-aware dependency graph plus a real authorization model) doesn't care how many states you add. That's the part worth building on.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [What it actually does](#what-it-actually-does)
- [Seeing it work: two real cases](#seeing-it-work-two-real-cases)
- [The resolver: how the answer is computed](#the-resolver-how-the-answer-is-computed)
- [Where the numbers come from](#where-the-numbers-come-from)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API](#api)
- [Running it locally](#running-it-locally)
- [Design notes](#design-notes)
- [What's not built yet](#whats-not-built-yet)
- [Where this could go](#where-this-could-go)
- [Credits and sources](#credits-and-sources)

---

## Why this exists

Vital records law in the United States is a patchwork, and the patchwork is the whole problem for anyone trying to actually help someone through it:

- A state's vital records office generally only holds **records for people born in that state**. California doesn't have your Michigan birth certificate. There is no national database that does.
- A state's fee-waiver program for homelessness generally only reaches **that state's own records**. California waiving its birth-certificate fee has no bearing on what Michigan charges.
- The waiver itself is usually not self-service. It requires **a verified homeless-services provider** to sign an affidavit or submit the request on the client's behalf — and that provider's approval to do so is typically **scoped to a specific state**, not blanket nationwide authority.

Put those three facts together and you get a case that looks simple on paper and isn't: *a client living in California, born in Michigan, who needs a California ID.* A California-approved caseworker can vouch for everything in California — the ID card itself, the residency proof — but the birth certificate underneath all of it is held by Michigan, and that same caseworker has no standing there. The fee stands. Someone has to pay it, or a Michigan-approved partner has to sign for it. There's no way to discover that except by tracing the actual dependency chain and checking jurisdiction at every step.

That tracing is what this project automates.

## What it actually does

Give ID Ladder four things about a case:

1. **Where the client was born** (which state holds their birth record)
2. **Where the client lives now** (which state issues their target document)
3. **The goal document** (a state ID card, for instance)
4. **The organization's approved jurisdictions** (where they're a verified provider)

It returns an ordered chain of every document standing between the client and their goal — dependencies first — with each one labeled by exactly what has to happen to it:

| Label | Meaning | Costs money right now? |
|---|---|---|
| **Held** | Client already has it | No |
| **Paid** | A real Stripe payment has gone through for it | No |
| **Waived** | A qualified organization has actually signed off | No |
| **Needs a voucher** | A waiver exists and this org *could* sign it — but hasn't yet | **Yes, full fee** |
| **Fee due** | No waiver program exists for this one | Yes |
| **Fee unknown** | No waiver, and the government has never published a fee for it | Unknown — excluded from the total, flagged separately |
| **Out of reach** | A waiver exists, but this organization has no standing in the state that holds the record | **Yes, full fee** |

The distinction between "needs a voucher" and "waived" is the entire point of the product. **A waiver is not real until a provider actually signs it.** The system will not tell you a fee is zero because a waiver theoretically exists somewhere — only once someone with real, checked authority has attested to it. That's why a client's running total can start at $71 and visibly drop to $0 the moment a caseworker clicks "vouch," rather than starting at $0 and staying there.

## Seeing it work: two real cases

The seed data ships with two cases that make the mechanism concrete.

**Case 1 — born and living in California, needs a California ID.**
Everything this client needs — the birth certificate, the ID card itself — sits inside one state, and the organization is approved there. Every fee is waivable. Before anyone signs anything, the running total is **$71.00** (a $31 birth record plus a $40 ID card, both at full price because nobody has vouched yet). The moment a California-approved caseworker vouches for both, the total drops to **$0.00** — and it happens live, with the number animating down, not just re-rendering.

**Case 2 — living in California, born in Michigan, needs a California ID.**
This is the case that exposes the seam. The client's target document is a California ID, and California's own fees are all waivable by a California-approved org. But the birth certificate underneath it is a **Michigan** record, and Michigan's waiver requires a **Michigan-approved** verifier. A California organization's standing simply does not reach it. The chain shows that step as **out of reach** — not a vague error, but a plain-language explanation of exactly why: *"Michigan holds this record because your client was born there, and only a verifier approved in Michigan can vouch for the fee waiver. Your California approval does not carry across the state line, so this step stays $34.00 until a Michigan partner signs it — or you pay it."* Total: **$34.00**, and it will not move for this organization no matter how many times someone clicks vouch — by design.

Both cases run against a live control strip: you can change the client's birth state, living state, goal document, what they already hold, and which states the organization can vouch in, and the whole chain recomputes in real time. Widen the organization's approved states to include Michigan on Case 2, and that same blocked step flips to "needs a voucher" in front of you.

## The resolver: how the answer is computed

At the center of the server is a single pure function — no database access, no network calls, no side effects — that takes a case description and a document graph and returns the labeled chain described above. It's pure specifically so it can be tested exhaustively without a database: the current version has 32 automated tests covering every label, the jurisdiction-mismatch case, cost totals with and without an unverified fee mixed in, and a guard against cycles in the graph.

The rule that produces the interesting behavior is small: **prefer a waiver over a fee, but only where the organization's actual standing reaches the document's actual jurisdiction.** Everything else — the dependency ordering, the running total, the "out of reach" explanation — falls out of applying that one rule consistently at every node in the graph.

A quieter piece of logic sits next to it: when a document is a *birth record*, the resolver substitutes in whichever state's record actually applies to this client — the state they were **born** in, not the state their goal document happens to be issued by. Without that substitution, Case 2 above would silently resolve as if the client's birth certificate were a California one, and the entire cross-jurisdiction problem this project exists to model would disappear.

## Where the numbers come from

Every fee and every waiver rule in the system is sourced to a real, checked citation — not estimated, not typical, not "roughly." If a real number couldn't be found, the fee is stored as unverified rather than guessed at zero or at a plausible-sounding figure, because a wrong number that *looks* authoritative is worse than an honest gap.

Currently modeled: **California, Michigan, Washington, and one federal record (the Social Security card)** — 14 documents and 15 dependency edges in total.

| Document | Fee | Waiver program | Who has to sign |
|---|---|---|---|
| CA birth certificate (State Registrar) | $31.00 | [Health & Safety Code §103577](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201720180AB2490), via [AB 1733](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201320140AB1733) (2014) and [AB 2490](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201720180AB2490) (2018) | A homeless-services provider signs the affidavit alongside the client |
| CA state ID card | $40.00 | [DMV No-Fee ID program](https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/reduced-no-fee-id-card-program-information-for-organizations/), form DL 933 | A government agency or 501(c)(3) serving unhoused people |
| Michigan birth certificate (state) | $34.00 | Michigan HB 4853 (2019), Category 1 homeless applicants | A public service agency's verification letter |
| Michigan state ID card | $10.00 | SB 404 (2017), implemented 2018 | A Homeless Verification Letter plus an HMIS card |
| Washington birth certificate | $25.00 | [RCW 70.58A.560](https://app.leg.wa.gov/RCW/default.aspx?cite=70.58A.560) | A government agency or homeless-service provider, on letterhead |
| Washington identicard | $61.00 (6-yr) | [RCW 46.20.195](https://app.leg.wa.gov/RCW/default.aspx?cite=46.20.195), SB 5815 (2022) | **No provider signature required** — this is the one exception |
| Social Security card | $0.00 | N/A — free for everyone | [SSA charges nothing for original or replacement cards](https://oig.ssa.gov/scam-alerts/2026-03-10-ssa-provides-new-and-replacement-social-security-cards-for-free/) |

The Washington identicard is the one deliberate outlier worth calling out: unlike every other waiver in the system, it does not require a caseworker's signature at all — a client can self-attest. Generalizing "a provider always has to vouch" would have been wrong, so the resolver treats it as data, not as an assumption baked into the code.

One fee is honestly unresolved: **Michigan's county-level birth certificate copy has no single statewide price.** MDHHS's own provider guidance states fees range roughly $5–$34 and vary by clerk's office. Rather than average that into a fake number, the system stores it as `NULL` and labels any chain that depends on it "fee unknown" — excluded from the running total, with the total itself flagged as a floor rather than a final number whenever that happens.

Every citation above resolves to a live government or primary source page; each one was checked directly against the live URL before being written down here.

## Architecture

One deployable process, no separate frontend host:

```
┌─────────────────────────────┐
│         Express (Node)       │
│                               │
│  /api/*  → JSON API           │  ← resolver, auth, Stripe, sourcing
│  /*      → client/dist        │  ← React SPA, served as static files
└─────────────────────────────┘
              │
              ▼
      SQLite (better-sqlite3)
```

- **Client:** React + Vite + TypeScript. A single screen — no dashboard shell, no settings page — because the chain itself is the product.
- **Server:** Express + TypeScript, compiled with `tsc`.
- **Database:** SQLite via `better-sqlite3` — synchronous, no ORM, no network hop for a dataset this size. Money is stored as **integer cents everywhere**, enforced by database-level `CHECK` constraints (SQLite is dynamically typed enough that nothing else would actually stop a stray float from sneaking into an `INTEGER` column).
- **Auth:** [Auth0](https://auth0.com/docs/quickstart/spa/react) Universal Login — the hosted page, never a homegrown login form. The API validates a bearer token by calling Auth0's own `/userinfo` endpoint rather than verifying a JWT locally, trading a small amount of latency for not needing a JWKS key-rotation dependency.
- **Payments:** [Stripe](https://stripe.com/docs/payments/checkout) hosted Checkout, **test mode only**. The app never renders a card field itself.
- **Deploy:** [Railway](https://docs.railway.com/), one process, `PORT`-driven.

In development, Vite runs on `5173` and proxies `/api/*` to Express on `3000`, so client code only ever calls relative paths and the exact same bundle works unmodified in production. Auth0's own configuration — domain, client ID, callback URL — is fetched by the client from the server at runtime rather than baked into the build, so the same compiled bundle works on `localhost` and in production without a rebuild.

## Data model

Eight tables, the shape of which mirrors the domain problem directly rather than being a generic CRUD schema:

- **`documents`** — every record in the graph: name, jurisdiction, fee in cents (nullable — see above), whether a waiver program exists, and the citation behind both.
- **`prerequisites`** — the dependency edges between documents. A document can require several others before it's obtainable.
- **`organizations`** — a verifying org and the list of states it holds real standing in.
- **`user_organizations`** — maps a signed-in Auth0 user to the organization they act for. (Auth0 Organizations wasn't available on this tenant, so this table does the same job.)
- **`cases`** — a client's birth state, current state, and goal document.
- **`case_holdings`** — documents a client already has in hand.
- **`attestations`** — a real, recorded act of an organization vouching for a specific document on a specific case, scoped to the jurisdiction it's valid in. This table is what separates "waived" from "could theoretically be waived."
- **`payments`** — Stripe payment records, tied to a case and a document.

Every user gets an **isolated workspace** on first sign-in: a private organization and a private clone of the demo cases, generated fresh rather than sharing the seeded originals. Nobody's attestations or test payments leak into anyone else's view, and every case-scoped query filters by the caller's own organization at the database level — so another user's case ID is indistinguishable from one that simply doesn't exist.

## API

All routes live under `/api`; everything else falls through to the client's `index.html` (client-side routing).

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/config` | Public Auth0 config for the browser (never baked into the build) |
| `GET /api/me` | The signed-in user and their organization |
| `GET /api/cases` | This organization's cases |
| `GET /api/graph` | The full document graph and headline stats |
| `GET /api/cases/:id/plan` | The resolved chain for a case — **recomputed from the database on every call, never cached**, so an attestation changes the answer on the very next request |
| `POST /api/cases/:id/attest` | Record a real vouch. Rejects with 403 if the organization has no standing in that document's jurisdiction — that rejection is the point |
| `POST /api/cases/:id/pay` | Start a Stripe Checkout session for one document's fee |
| `POST /api/organizations/:id/subscribe` | Start a Stripe subscription Checkout session |
| `GET /api/cases/:id/affidavit/:documentId` | The signed record behind a "waived" step — printable, citing the actual statute |

The plan endpoint also accepts live overrides as query parameters (`born_in`, `living_in`, `goal`, `holds`, `standing`) that recompute the chain against hypothetical values without writing anything to the database — this is what powers the on-screen control strip. Those overrides are read-only by design: the attest endpoint always checks an organization's *real* recorded standing, never a value supplied as a query parameter, so the what-if controls can't be used to grant an organization authority it doesn't actually have.

## Running it locally

```bash
npm install          # installs root + client + server (npm workspaces)
npm run seed          # builds a fresh SQLite demo database
npm run dev            # client on :5173, server on :3000, together
```

Then visit `http://localhost:5173`. `PORT=3100 npm run dev` moves both the server and the Vite proxy target together, for when something else already owns 3000.

```bash
npm run build          # builds the client, then compiles the server
npm start               # single production process on $PORT
npm test                 # 32 tests: the resolver, override parsing, workspace isolation
npm run typecheck    # both workspaces
```

A `.env` file at the repo root holds `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, and `STRIPE_SECRET_KEY` (test mode). None of it is ever exposed to the client bundle — Vite only surfaces variables explicitly prefixed `VITE_`, and Auth0 config is instead served at runtime from `/api/config`.

## Design notes

The visual language is deliberately not any of the three defaults an AI-generated interface tends to land on — cream-and-serif, near-black-with-one-accent, or broadsheet hairlines. The reference points instead are **transit-line diagrams and administrative docket sheets**: the actual visual world of forms, filing systems, and case dockets this product lives in, without leaning on kitsch like fake rubber stamps or manila-folder textures.

The chain is drawn as a single vertical spine running through numbered gates rather than a stack of cards, so it reads as a ladder to climb rather than a list to skim. Every one of the six states carries **both** a distinct color and a distinct shape — a solid circle, a hollow ring, or a square — specifically so the states stay distinguishable in grayscale, on a bad projector, or to a colorblind viewer. When an organization vouches for a document, the total doesn't just re-render; it animates downward and settles, because the whole point of the interaction is that a caseworker should *feel* the number change.

## What's not built yet

Being direct about the edges: there's no Stripe webhook, so a payment only settles when the browser completes the redirect back from Checkout — a client who closes the tab mid-payment leaves a pending record rather than a failed one. Railway's filesystem is ephemeral without an attached volume, so demo data is rebuilt fresh on every deploy rather than persisting indefinitely. And the model currently covers three states; the fourth-largest source of "where do I even start" friction in this space — a state not yet in the graph — is an unsourced fee away from being wrong, which is exactly why new states go in one cited row at a time rather than in bulk.

## Where this could go

The mechanism here — a jurisdiction-scoped dependency graph plus a real, checkable authorization model — doesn't stop being useful at three states. The same shape shows up anywhere a benefit or a document depends on *both* which government issued the underlying record *and* who has the standing to vouch for the person asking: immigration paperwork, veterans' benefits, occupational licensing, court fee waivers. None of that is built. But the part that took the actual thought — modeling "a waiver is not real until someone with real authority signs it," and refusing to collapse two different states' rules into one flag — is already load-bearing infrastructure, not a demo shortcut. Extending the graph is future work; getting that rule right the first time was the actual project.

## Credits and sources

Built with [React](https://react.dev/), [Vite](https://vitejs.dev/), [Express](https://expressjs.com/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [TypeScript](https://www.typescriptlang.org/), [Auth0](https://auth0.com/docs/quickstart/spa/react), and [Stripe](https://stripe.com/docs/payments/checkout), deployed on [Railway](https://docs.railway.com/).

Every fee and waiver figure is drawn from a primary or government source, checked directly rather than taken from a summary of a summary:

- California: [California Legislative Information](https://leginfo.legislature.ca.gov/) (AB 1733, AB 2490), [California DMV](https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/), [California Department of Public Health](https://www.cdph.ca.gov/Programs/CHSI/Pages/Vital-Records-Fees.aspx)
- Michigan: [Michigan Legal Help](https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card), [Michigan Coalition Against Homelessness](https://www.mihomeless.org/vital-documents/), [VitalChek](https://www.vitalchek.com/v/birth-certificates/michigan/michigan-vital-records) (Michigan's own vital-records ordering vendor)
- Washington: [Washington State Legislature](https://app.leg.wa.gov/RCW/) (RCW 46.20.195, RCW 70.58A.560), [Washington State Department of Health](https://doh.wa.gov/licenses-permits-and-certificates/vital-records/ordering-vital-record/birth-record), [Washington State Department of Licensing](https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees)
- Federal: [Social Security Administration Office of the Inspector General](https://oig.ssa.gov/scam-alerts/2026-03-10-ssa-provides-new-and-replacement-social-security-cards-for-free/); the federal definition of homelessness used throughout follows the [McKinney-Vento Homeless Assistance Act](https://nche.ed.gov/mckinney-vento-definition/)

One Michigan source (a county-clerk vital-records provider guide, hosted at miboscoc.com) is occasionally blocked by corporate or school network filters that flag the domain; it loads normally on an unfiltered connection and was verified directly against its content before being cited.

Where a real figure could not be confirmed against one of the sources above, it is stored as unverified rather than estimated — see the Michigan county-copy fee, above.
