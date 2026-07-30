/**
 * Boot-time database bootstrap. Runs before the server listens (see the
 * `prestart` script), so a fresh Railway container comes up with a schema and
 * reference data instead of an empty filesystem.
 *
 * SAFE TO RUN ON EVERY BOOT — and deliberately different from `npm run seed`:
 *
 *   npm run seed   deletes the database file and rebuilds it. Destructive.
 *                  For local demo resets only.
 *   bootstrap      creates what is missing and refreshes reference data.
 *                  Never deletes a case, attestation, or payment.
 *
 * That distinction matters. Wiring the destructive reset into `npm start`
 * would drop every case, attestation, and payment on each deploy or restart —
 * fine today because production is empty, silently catastrophic the moment it
 * is not. So the boot path only ever adds and updates.
 *
 * Reference data (documents, prerequisites) is refreshed to match seed-data.ts,
 * because a stale fee or prerequisite edge would give caseworkers wrong
 * answers. Demo data (organizations, cases, holdings) is inserted only when
 * absent, so edits made in the running app survive a redeploy.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type BetterSqlite3 from "better-sqlite3";

import { DB_PATH, SCHEMA_PATH, openDatabase } from "./index.js";
import {
  caseHoldings,
  cases,
  documents,
  organizations,
  prerequisites,
} from "./seed-data.js";

export type BootstrapResult = {
  documentsUpserted: number;
  prerequisitesReplaced: number;
  organizationsInserted: number;
  casesInserted: number;
  holdingsInserted: number;
};

export function bootstrap(db: BetterSqlite3.Database): BootstrapResult {
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  // Reference data: keep in sync with seed-data.ts.
  const upsertDocument = db.prepare(
    `INSERT INTO documents (id, name, jurisdiction, fee_cents, waiver_available)
     VALUES (@id, @name, @jurisdiction, @fee_cents, @waiver_available)
     ON CONFLICT(id) DO UPDATE SET
       name             = excluded.name,
       jurisdiction     = excluded.jurisdiction,
       fee_cents        = excluded.fee_cents,
       waiver_available = excluded.waiver_available`,
  );
  // Prerequisites are pure reference data that nothing references, so a full
  // replace is the simplest way to drop edges removed from seed-data.ts.
  const clearPrerequisites = db.prepare(`DELETE FROM prerequisites`);
  const insertPrerequisite = db.prepare(
    `INSERT INTO prerequisites (document_id, requires_document_id, attestable)
     VALUES (@document_id, @requires_document_id, @attestable)`,
  );

  // Demo data: only fill gaps, never overwrite.
  const insertOrganization = db.prepare(
    `INSERT OR IGNORE INTO organizations (id, auth0_org_id, name, standing_jurisdictions)
     VALUES (@id, @auth0_org_id, @name, @standing_jurisdictions)`,
  );
  const insertCase = db.prepare(
    `INSERT OR IGNORE INTO cases (id, organization_id, client_ref, birth_jurisdiction,
                                  current_jurisdiction, goal_document_id, created_at)
     VALUES (@id, @organization_id, @client_ref, @birth_jurisdiction,
             @current_jurisdiction, @goal_document_id, @created_at)`,
  );
  const insertHolding = db.prepare(
    `INSERT OR IGNORE INTO case_holdings (case_id, document_id)
     VALUES (@case_id, @document_id)`,
  );

  return db.transaction((): BootstrapResult => {
    for (const row of documents) upsertDocument.run(row);

    clearPrerequisites.run();
    for (const row of prerequisites) insertPrerequisite.run(row);

    let organizationsInserted = 0;
    for (const row of organizations) {
      organizationsInserted += insertOrganization.run(row).changes;
    }
    let casesInserted = 0;
    for (const row of cases) {
      casesInserted += insertCase.run(row).changes;
    }
    let holdingsInserted = 0;
    for (const row of caseHoldings) {
      holdingsInserted += insertHolding.run(row).changes;
    }

    return {
      documentsUpserted: documents.length,
      prerequisitesReplaced: prerequisites.length,
      organizationsInserted,
      casesInserted,
      holdingsInserted,
    };
  })();
}

/** CLI entry point used by the server's `prestart` script. */
function main(): void {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = openDatabase();
  try {
    const result = bootstrap(db);
    console.log(`[bootstrap] database ready at ${DB_PATH}`);
    console.log(`[bootstrap] ${JSON.stringify(result)}`);
  } finally {
    db.close();
  }
}

// Only run when executed directly, so importing `bootstrap` from seed.ts or
// the server does not trigger the CLI side effects.
const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main();
}
