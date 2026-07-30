import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// DB_PATH is captured at module load, so the temp database has to be chosen
// before anything under ./db is imported.
const workspace = mkdtempSync(path.join(tmpdir(), "id-ladder-test-"));
process.env.DATABASE_PATH = path.join(workspace, "test.db");

type Db = import("better-sqlite3").Database;

let db: Db;
let provisionWorkspace: typeof import("./auth.js").provisionWorkspace;
let templateOrganizationId: string;

before(async () => {
  const { openDatabase } = await import("./db/index.js");
  const { bootstrap } = await import("./db/bootstrap.js");
  ({ provisionWorkspace } = await import("./auth.js"));

  db = openDatabase();
  bootstrap(db);

  templateOrganizationId = (
    db.prepare(`SELECT id FROM organizations ORDER BY id LIMIT 1`).get() as { id: string }
  ).id;
});

after(() => {
  db?.close();
  rmSync(workspace, { recursive: true, force: true });
});

function casesFor(organizationId: string) {
  return db
    .prepare(`SELECT id, client_ref, birth_jurisdiction FROM cases WHERE organization_id = ?`)
    .all(organizationId) as { id: string; client_ref: string; birth_jurisdiction: string }[];
}

test("first sign-in creates a private organization with cloned cases", () => {
  const organizationId = provisionWorkspace(db, { sub: "auth0|alice", email: "alice@example.com" });
  assert.ok(organizationId);
  assert.notEqual(organizationId, templateOrganizationId);

  const templateCases = casesFor(templateOrganizationId);
  const cloned = casesFor(organizationId!);

  assert.equal(cloned.length, templateCases.length);
  assert.equal(cloned.length, 2);

  // Same client references and jurisdictions, brand new case ids.
  assert.deepEqual(
    cloned.map((c) => c.client_ref).sort(),
    templateCases.map((c) => c.client_ref).sort(),
  );
  for (const clonedCase of cloned) {
    assert.ok(!templateCases.some((t) => t.id === clonedCase.id));
  }

  // The cross-jurisdiction case survives the clone; it is the demo.
  assert.ok(cloned.some((c) => c.birth_jurisdiction === "MI"));
  assert.ok(cloned.some((c) => c.birth_jurisdiction === "CA"));
});

test("the new organization inherits California standing", () => {
  const organizationId = provisionWorkspace(db, { sub: "auth0|carol" });
  const row = db
    .prepare(`SELECT standing_jurisdictions FROM organizations WHERE id = ?`)
    .get(organizationId!) as { standing_jurisdictions: string };

  assert.deepEqual(JSON.parse(row.standing_jurisdictions), ["CA"]);
});

test("two users get completely separate organizations and cases", () => {
  const alice = provisionWorkspace(db, { sub: "auth0|alice" });
  const bob = provisionWorkspace(db, { sub: "auth0|bob", email: "bob@example.com" });

  assert.notEqual(alice, bob);

  const aliceCases = casesFor(alice!).map((c) => c.id);
  const bobCases = casesFor(bob!).map((c) => c.id);

  assert.equal(aliceCases.length, 2);
  assert.equal(bobCases.length, 2);
  assert.equal(aliceCases.filter((id) => bobCases.includes(id)).length, 0);
});

test("signing in again reuses the same workspace instead of cloning more", () => {
  const first = provisionWorkspace(db, { sub: "auth0|dave" });
  const casesAfterFirst = casesFor(first!).length;

  const second = provisionWorkspace(db, { sub: "auth0|dave" });

  assert.equal(second, first);
  assert.equal(casesFor(first!).length, casesAfterFirst);
});

test("one user's attestation cannot be seen from another user's case", () => {
  const alice = provisionWorkspace(db, { sub: "auth0|alice" });
  const bob = provisionWorkspace(db, { sub: "auth0|bob" });

  const aliceCase = casesFor(alice!)[0]!;
  const bobCase = casesFor(bob!)[0]!;

  db.prepare(
    `INSERT INTO attestations (id, case_id, document_id, organization_id,
                               attested_by_user_id, valid_in_jurisdiction, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "att-isolation-test",
    aliceCase.id,
    "ca-id-card",
    alice!,
    "auth0|alice",
    "CA",
    new Date().toISOString(),
  );

  const bobAttestations = db
    .prepare(`SELECT id FROM attestations WHERE case_id = ?`)
    .all(bobCase.id);

  assert.equal(bobAttestations.length, 0);
});

test("the template organization keeps its own untouched cases", () => {
  provisionWorkspace(db, { sub: "auth0|erin" });

  const templateCases = casesFor(templateOrganizationId);
  assert.equal(templateCases.length, 2);

  const templateAttestations = db
    .prepare(
      `SELECT a.id FROM attestations a
       JOIN cases c ON c.id = a.case_id
       WHERE c.organization_id = ?`,
    )
    .all(templateOrganizationId);
  assert.equal(templateAttestations.length, 0);
});
