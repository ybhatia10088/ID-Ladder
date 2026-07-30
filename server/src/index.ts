import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Request, Response } from "express";

import { requireAuth } from "./auth.js";
import { overridesFrom } from "./plan-overrides.js";
import type { PlanOverrides } from "./plan-overrides.js";
import { openDatabase } from "./db/index.js";
import { loadEnv } from "./env.js";
import { resolvePlan } from "./resolver.js";
import type {
  Plan,
  ResolverAttestation,
  ResolverDocument,
  ResolverPayment,
  ResolverPrerequisite,
} from "./resolver.js";
import { baseUrl, getStripe } from "./stripe.js";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";

// From server/dist/index.js (built) or server/src/index.ts (tsx), both are two
// levels below the repo root.
const clientDist = path.resolve(__dirname, "../../client/dist");

type CaseRow = {
  id: string;
  organization_id: string;
  birth_jurisdiction: string;
  current_jurisdiction: string;
  goal_document_id: string;
};

type DatabaseHandle = ReturnType<typeof openDatabase>;

/**
 * Builds the plan straight from the database. Called on every request — never
 * cached — so an attestation or payment written a moment ago is reflected in
 * the very next answer.
 */
function buildPlan(
  db: DatabaseHandle,
  caseId: string,
  organizationId: string,
  standingJurisdictions: string[],
  overrides: PlanOverrides = {},
): Plan | null {
  // Scoped by organization: a case id belonging to someone else must be
  // indistinguishable from one that does not exist.
  const caseRecord = db
    .prepare(
      `SELECT id, organization_id, birth_jurisdiction, current_jurisdiction, goal_document_id
       FROM cases WHERE id = ? AND organization_id = ?`,
    )
    .get(caseId, organizationId) as CaseRow | undefined;

  if (!caseRecord) {
    return null;
  }

  const effectiveCase = {
    ...caseRecord,
    birth_jurisdiction: overrides.birth_jurisdiction ?? caseRecord.birth_jurisdiction,
    current_jurisdiction: overrides.current_jurisdiction ?? caseRecord.current_jurisdiction,
    goal_document_id: overrides.goal_document_id ?? caseRecord.goal_document_id,
  };

  const storedHoldings = (
    db.prepare(`SELECT document_id FROM case_holdings WHERE case_id = ?`).all(caseId) as {
      document_id: string;
    }[]
  ).map((row) => row.document_id);

  return resolvePlan({
    caseRecord: effectiveCase,
    documents: db
      .prepare(`SELECT id, name, jurisdiction, fee_cents, waiver_available FROM documents`)
      .all() as ResolverDocument[],
    prerequisites: db
      .prepare(`SELECT document_id, requires_document_id, attestable FROM prerequisites`)
      .all() as ResolverPrerequisite[],
    holdings: overrides.holdings ?? storedHoldings,
    standingJurisdictions: overrides.standing ?? standingJurisdictions,
    attestations: db
      .prepare(`SELECT document_id, valid_in_jurisdiction FROM attestations WHERE case_id = ?`)
      .all(caseId) as ResolverAttestation[],
    payments: db
      .prepare(`SELECT document_id, status FROM payments WHERE case_id = ?`)
      .all(caseId) as ResolverPayment[],
  });
}

const app = express();

// Railway terminates TLS upstream; without this req.protocol is always http
// and Stripe redirect URLs come back wrong.
app.set("trust proxy", 1);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Public Auth0 configuration for the browser.
 *
 * Served at runtime rather than baked in at build time so the callback URL
 * comes from APP_BASE_URL (or the request origin) and is never hardcoded —
 * the same build works on localhost and in production.
 */
app.get("/api/config", (req, res) => {
  res.json({
    auth0: {
      domain: process.env.AUTH0_DOMAIN ?? null,
      clientId: process.env.AUTH0_CLIENT_ID ?? null,
      redirectUri: baseUrl(req),
    },
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: req.user, organization: req.organization });
});

app.get("/api/cases", requireAuth, (req, res) => {
  const db = openDatabase();
  try {
    res.json({
      cases: db
        .prepare(
          `SELECT c.id, c.client_ref, c.birth_jurisdiction, c.current_jurisdiction,
                  c.goal_document_id, d.name AS goal_document_name
           FROM cases c
           JOIN documents d ON d.id = c.goal_document_id
           WHERE c.organization_id = ?
           ORDER BY c.client_ref`,
        )
        .all(req.organization!.id),
    });
  } finally {
    db.close();
  }
});

/**
 * The document graph: goal options for the control strip, and headline counts
 * showing the graph is larger than any single chain.
 */
app.get("/api/graph", requireAuth, (_req, res) => {
  const db = openDatabase();
  try {
    res.json({
      documents: db
        .prepare(
          `SELECT d.id, d.name, d.jurisdiction, d.fee_cents, d.waiver_available,
                  d.source_url, d.source_note,
                  EXISTS (SELECT 1 FROM prerequisites p WHERE p.document_id = d.id)
                    AS has_prerequisites
           FROM documents d
           ORDER BY d.jurisdiction, d.name`,
        )
        .all(),
      stats: {
        documents: (db.prepare(`SELECT COUNT(*) AS n FROM documents`).get() as { n: number }).n,
        prerequisites: (
          db.prepare(`SELECT COUNT(*) AS n FROM prerequisites`).get() as { n: number }
        ).n,
        by_jurisdiction: db
          .prepare(
            `SELECT jurisdiction, COUNT(*) AS documents
             FROM documents GROUP BY jurisdiction ORDER BY jurisdiction`,
          )
          .all(),
      },
    });
  } finally {
    db.close();
  }
});

app.get("/api/cases/:id/plan", requireAuth, (req, res) => {
  const db = openDatabase();
  try {
    const overrides = overridesFrom(req.query as Record<string, unknown>);
    const plan = buildPlan(
      db,
      req.params.id,
      req.organization!.id,
      req.organization!.standing_jurisdictions,
      overrides,
    );
    if (!plan) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const stored = db
      .prepare(
        `SELECT birth_jurisdiction, current_jurisdiction, goal_document_id
         FROM cases WHERE id = ?`,
      )
      .get(req.params.id) as {
      birth_jurisdiction: string;
      current_jurisdiction: string;
      goal_document_id: string;
    };

    // Echo what the plan was actually computed with, so the controls can render
    // in sync and show when they diverge from what is stored.
    res.json({
      ...plan,
      controls: {
        birth_jurisdiction: overrides.birth_jurisdiction ?? stored.birth_jurisdiction,
        current_jurisdiction: overrides.current_jurisdiction ?? stored.current_jurisdiction,
        goal_document_id: overrides.goal_document_id ?? stored.goal_document_id,
        holdings: overrides.holdings ?? [],
        standing: overrides.standing ?? req.organization!.standing_jurisdictions,
        stored,
        organization_standing: req.organization!.standing_jurisdictions,
        overridden: Object.keys(overrides).length > 0,
      },
    });
  } finally {
    db.close();
  }
});

/**
 * Records a provider attestation, then returns the recomputed plan.
 *
 * The standing check is the point of the product: an organization may only
 * attest in a jurisdiction it is verified in. A California provider signing
 * for a Michigan-held birth record is exactly the thing that must fail.
 */
app.post("/api/cases/:id/attest", requireAuth, (req, res) => {
  const db = openDatabase();
  try {
    const caseRecord = db
      .prepare(`SELECT id, organization_id FROM cases WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, req.organization!.id) as
      | Pick<CaseRow, "id" | "organization_id">
      | undefined;

    if (!caseRecord) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const body = req.body as { document_id?: unknown };
    const documentId = typeof body.document_id === "string" ? body.document_id : null;
    if (!documentId) {
      res.status(400).json({ error: "document_id is required" });
      return;
    }

    const document = db
      .prepare(`SELECT id, name, jurisdiction, waiver_available FROM documents WHERE id = ?`)
      .get(documentId) as
      | { id: string; name: string; jurisdiction: string; waiver_available: number }
      | undefined;

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (document.waiver_available !== 1) {
      res.status(422).json({
        error: "No fee waiver exists for this document, so there is nothing to attest",
        document_id: document.id,
      });
      return;
    }

    // Standing comes from the signed-in user's organization, not the case's.
    const organization = req.organization!;
    const standing = organization.standing_jurisdictions;

    if (!standing.includes(document.jurisdiction)) {
      res.status(403).json({
        error: "Organization has no verified standing in this document's jurisdiction",
        document_id: document.id,
        document_jurisdiction: document.jurisdiction,
        organization_id: organization.id,
        organization_name: organization.name,
        organization_standing: standing,
      });
      return;
    }

    // Idempotent: re-attesting the same document on the same case is a no-op
    // rather than a duplicate row.
    const existing = db
      .prepare(
        `SELECT id FROM attestations
         WHERE case_id = ? AND document_id = ? AND organization_id = ?`,
      )
      .get(caseRecord.id, document.id, organization.id) as { id: string } | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO attestations (id, case_id, document_id, organization_id,
                                   attested_by_user_id, attested_by_name,
                                   attested_by_email, valid_in_jurisdiction, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        caseRecord.id,
        document.id,
        organization.id,
        req.user!.sub,
        req.user!.name ?? null,
        req.user!.email ?? null,
        document.jurisdiction,
        new Date().toISOString(),
      );
    }

    res.json(buildPlan(db, caseRecord.id, organization.id, standing));
  } finally {
    db.close();
  }
});

/**
 * Everything printed on a signed affidavit. Scoped to the caller's
 * organization, so an affidavit for someone else's case is a 404.
 */
app.get("/api/cases/:id/affidavit/:documentId", requireAuth, (req, res) => {
  const db = openDatabase();
  try {
    const record = db
      .prepare(
        `SELECT a.id, a.created_at, a.attested_by_user_id, a.attested_by_name,
                a.attested_by_email, a.valid_in_jurisdiction,
                c.client_ref, c.birth_jurisdiction, c.current_jurisdiction,
                d.name AS document_name, d.jurisdiction AS document_jurisdiction,
                d.fee_cents, d.source_url, d.source_note, d.waiver_statute,
                o.name AS organization_name, o.standing_jurisdictions
         FROM attestations a
         JOIN cases c ON c.id = a.case_id
         JOIN documents d ON d.id = a.document_id
         JOIN organizations o ON o.id = a.organization_id
         WHERE a.case_id = ? AND a.document_id = ? AND c.organization_id = ?
         ORDER BY a.created_at DESC
         LIMIT 1`,
      )
      .get(req.params.id, req.params.documentId, req.organization!.id) as
      | Record<string, unknown>
      | undefined;

    if (!record) {
      res.status(404).json({ error: "No signed affidavit for this document" });
      return;
    }

    res.json({
      ...record,
      standing_jurisdictions: JSON.parse(
        (record.standing_jurisdictions as string | null) ?? "[]",
      ) as string[],
    });
  } finally {
    db.close();
  }
});

/**
 * Starts a Stripe hosted Checkout session for one document's fee and records a
 * pending payment row. Hosted Checkout only — this project never collects card
 * details itself.
 */
app.post("/api/cases/:id/pay", requireAuth, async (req: Request, res: Response) => {
  const db = openDatabase();
  try {
    const plan = buildPlan(
      db,
      req.params.id,
      req.organization!.id,
      req.organization!.standing_jurisdictions,
    );
    if (!plan) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const body = req.body as { document_id?: unknown };
    const documentId = typeof body.document_id === "string" ? body.document_id : null;
    if (!documentId) {
      res.status(400).json({ error: "document_id is required" });
      return;
    }

    const step = plan.steps.find((s) => s.document_id === documentId);
    if (!step) {
      res.status(404).json({ error: "Document is not part of this case's plan" });
      return;
    }
    if (!step.chargeable) {
      res.status(422).json({
        error: `Nothing to pay: this step is already ${step.label}`,
        document_id: documentId,
        label: step.label,
      });
      return;
    }
    if (step.fee_cents === null) {
      res.status(422).json({
        error: "This document's fee is unverified, so it cannot be charged",
        document_id: documentId,
      });
      return;
    }
    if (step.fee_cents === 0) {
      res.status(422).json({ error: "This document is free", document_id: documentId });
      return;
    }

    const base = baseUrl(req);
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: step.name,
              description: `${step.jurisdiction} · case ${plan.case_id}`,
            },
            // Integer cents straight through — Stripe uses the same units.
            unit_amount: step.fee_cents,
          },
          quantity: 1,
        },
      ],
      success_url: `${base}/api/payments/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?payment=cancelled&case_id=${encodeURIComponent(plan.case_id)}`,
      metadata: { case_id: plan.case_id, document_id: documentId },
    });

    const paymentId = randomUUID();
    db.prepare(
      `INSERT INTO payments (id, case_id, document_id, amount_cents,
                             stripe_payment_intent_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      // The session id is the only handle available before checkout completes;
      // the return handler swaps in the real PaymentIntent id.
    ).run(
      paymentId,
      plan.case_id,
      documentId,
      step.fee_cents,
      session.id,
      "requires_payment",
      new Date().toISOString(),
    );

    res.json({
      payment_id: paymentId,
      checkout_url: session.url,
      amount_cents: step.fee_cents,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    db.close();
  }
});

/** Where Stripe sends the browser back after hosted Checkout. */
app.get("/api/payments/return", async (req: Request, res: Response) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : null;
  if (!sessionId) {
    res.redirect("/?payment=unknown");
    return;
  }

  const db = openDatabase();
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const caseId = session.metadata?.case_id ?? "";
    // Carried back so the UI can reopen the right case and point at the step
    // that was just paid for.
    const documentId = session.metadata?.document_id ?? "";

    if (session.payment_status === "paid") {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.id;

      db.prepare(
        `UPDATE payments SET status = 'succeeded', stripe_payment_intent_id = ?
         WHERE stripe_payment_intent_id = ?`,
      ).run(paymentIntentId, sessionId);

      res.redirect(
        `/?payment=succeeded&case_id=${encodeURIComponent(caseId)}` +
          `&document_id=${encodeURIComponent(documentId)}`,
      );
      return;
    }

    res.redirect(`/?payment=${session.payment_status}&case_id=${encodeURIComponent(caseId)}`);
  } catch (error) {
    console.error("[payments/return]", error);
    res.redirect("/?payment=error");
  } finally {
    db.close();
  }
});

/** Org-level subscription: "ID Ladder Pro", $49/mo, hosted Checkout. */
app.post("/api/organizations/:id/subscribe", requireAuth, async (req: Request, res: Response) => {
  const db = openDatabase();
  try {
    // You may only subscribe your own organization.
    if (req.params.id !== req.organization!.id) {
      res.status(403).json({ error: "You can only manage your own organization" });
      return;
    }
    const organization = req.organization!;

    const base = baseUrl(req);
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "ID Ladder Pro" },
            unit_amount: 4900, // $49.00/mo in integer cents
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${base}/?subscription=succeeded&organization_id=${encodeURIComponent(organization.id)}`,
      cancel_url: `${base}/?subscription=cancelled`,
      metadata: { organization_id: organization.id },
    });

    res.json({ checkout_url: session.url, amount_cents: 4900, interval: "month" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    db.close();
  }
});

// Unmatched API routes must 404 as JSON rather than falling through to the SPA.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// In development the Vite dev server owns the client and proxies /api here, so
// there is nothing static to serve.
if (isProduction) {
  if (!existsSync(clientDist)) {
    console.warn(
      `[server] client build not found at ${clientDist} — run \`npm run build\` first`,
    );
  }

  app.use(express.static(clientDist));

  // SPA fallback: any non-API route renders the client and lets it route.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(
    `[server] listening on http://localhost:${PORT} (${isProduction ? "production" : "development"})`,
  );
});
