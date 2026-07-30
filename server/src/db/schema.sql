-- ID-Ladder schema.
--
-- Money is ALWAYS integer cents. The typeof() CHECK constraints below are load
-- bearing: SQLite is dynamically typed and would happily store 31.0 in an
-- INTEGER column, so the constraint is what actually keeps floats out.
--
-- fee_cents is nullable on purpose. NULL means "we could not verify a real
-- figure" — never a guess, never zero-as-unknown. Zero means genuinely free.

PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  -- Two-letter state code, or 'US' for federally issued records.
  jurisdiction     TEXT NOT NULL,
  -- Integer cents. NULL = unverified (see seed comments), 0 = genuinely free.
  fee_cents        INTEGER,
  waiver_available INTEGER NOT NULL DEFAULT 0,

  CHECK (fee_cents IS NULL OR (typeof(fee_cents) = 'integer' AND fee_cents >= 0)),
  CHECK (waiver_available IN (0, 1))
);

-- A document's prerequisite chain. `attestable` marks a prerequisite that a
-- verified homeless services provider can satisfy by attestation instead of
-- the client producing the physical document (e.g. proof of residency via a
-- shelter letter). It does NOT mean the prerequisite is optional.
CREATE TABLE prerequisites (
  document_id          TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  requires_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attestable           INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (document_id, requires_document_id),
  CHECK (attestable IN (0, 1)),
  CHECK (document_id <> requires_document_id)
);

CREATE TABLE organizations (
  id                     TEXT PRIMARY KEY,
  auth0_org_id           TEXT UNIQUE,
  name                   TEXT NOT NULL,
  -- JSON array of jurisdiction codes this org is a verified provider in,
  -- e.g. '["CA"]'. Standing is per-state: a CA-verified org cannot attest
  -- for a Michigan-held record.
  standing_jurisdictions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE cases (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Caseworker-facing reference, not PII.
  client_ref           TEXT NOT NULL,
  -- Where the client was born: determines which state HOLDS the birth record.
  birth_jurisdiction   TEXT NOT NULL,
  -- Where the client lives now: determines which state issues the ID.
  current_jurisdiction TEXT NOT NULL,
  goal_document_id     TEXT NOT NULL REFERENCES documents(id),
  created_at           TEXT NOT NULL
);

CREATE TABLE case_holdings (
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  PRIMARY KEY (case_id, document_id)
);

-- An attestation is scoped to the jurisdiction it is valid in, because an
-- org's standing in one state does not carry into another.
CREATE TABLE attestations (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attested_by_user_id   TEXT NOT NULL,
  valid_in_jurisdiction TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE TABLE payments (
  id                       TEXT PRIMARY KEY,
  case_id                  TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id              TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- Integer cents. Stripe uses the same representation, so amounts pass
  -- through untouched.
  amount_cents             INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  status                   TEXT NOT NULL,
  created_at               TEXT NOT NULL,

  CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  CHECK (status IN ('requires_payment', 'processing', 'succeeded', 'failed', 'refunded', 'waived'))
);

CREATE INDEX idx_prerequisites_document ON prerequisites(document_id);
CREATE INDEX idx_cases_organization ON cases(organization_id);
CREATE INDEX idx_case_holdings_case ON case_holdings(case_id);
CREATE INDEX idx_attestations_case ON attestations(case_id);
CREATE INDEX idx_payments_case ON payments(case_id);
