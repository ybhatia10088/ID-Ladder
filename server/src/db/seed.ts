/**
 * DESTRUCTIVE local reset: deletes the database file and rebuilds it, so
 * `npm run seed` always lands on the same clean demo state.
 *
 * Do not wire this into the production start path — it would drop every case,
 * attestation, and payment on each boot. `bootstrap.ts` is the safe boot-time
 * equivalent.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { DB_PATH, openDatabase } from "./index.js";
import { bootstrap } from "./bootstrap.js";
import { documents } from "./seed-data.js";

function seed(): void {
  // Drop the database and its WAL sidecars so repeated runs converge.
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${DB_PATH}${suffix}`;
    if (existsSync(file)) {
      rmSync(file);
    }
  }
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = openDatabase();
  try {
    const result = bootstrap(db);
    const unverified = documents.filter((d) => d.fee_cents === null).map((d) => d.id);

    console.log(`[seed] rebuilt ${DB_PATH}`);
    console.log(`[seed] ${JSON.stringify(result)}`);
    console.log(
      `[seed] fees UNVERIFIED (fee_cents IS NULL): ${
        unverified.length > 0 ? unverified.join(", ") : "none"
      }`,
    );
  } finally {
    db.close();
  }
}

seed();
