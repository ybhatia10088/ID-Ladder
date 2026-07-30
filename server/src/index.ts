import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { openDatabase } from "./db/index.js";
import { resolvePlan } from "./resolver.js";
import type { ResolverDocument, ResolverPrerequisite } from "./resolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** standing_jurisdictions is stored as a JSON array string, e.g. '["CA"]'. */
function parseStandingJurisdictions(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const PORT = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";

// From server/dist/index.js (built) or server/src/index.ts (tsx), both are two
// levels below the repo root.
const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// The plan is recomputed from the database on every request and never cached:
// writing an attestation has to change the answer on the very next call.
app.get("/api/cases/:id/plan", (req, res) => {
  const db = openDatabase();
  try {
    const caseRecord = db
      .prepare(
        `SELECT id, organization_id, birth_jurisdiction, current_jurisdiction, goal_document_id
         FROM cases WHERE id = ?`,
      )
      .get(req.params.id) as
      | {
          id: string;
          organization_id: string;
          birth_jurisdiction: string;
          current_jurisdiction: string;
          goal_document_id: string;
        }
      | undefined;

    if (!caseRecord) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const organization = db
      .prepare(`SELECT standing_jurisdictions FROM organizations WHERE id = ?`)
      .get(caseRecord.organization_id) as { standing_jurisdictions: string } | undefined;

    const documents = db
      .prepare(`SELECT id, name, jurisdiction, fee_cents, waiver_available FROM documents`)
      .all() as ResolverDocument[];
    const prerequisites = db
      .prepare(`SELECT document_id, requires_document_id, attestable FROM prerequisites`)
      .all() as ResolverPrerequisite[];
    const holdings = (
      db.prepare(`SELECT document_id FROM case_holdings WHERE case_id = ?`).all(caseRecord.id) as {
        document_id: string;
      }[]
    ).map((row) => row.document_id);

    res.json(
      resolvePlan({
        caseRecord,
        documents,
        prerequisites,
        holdings,
        standingJurisdictions: parseStandingJurisdictions(organization?.standing_jurisdictions),
      }),
    );
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
