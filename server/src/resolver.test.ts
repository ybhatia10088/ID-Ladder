import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePlan } from "./resolver.js";
import type { ResolverDocument, ResolverInput, ResolverPrerequisite } from "./resolver.js";

// A trimmed copy of the seeded reference data. Kept local so the resolver
// tests do not need a database.
const documents: ResolverDocument[] = [
  { id: "us-ssn-card", name: "Social Security Card", jurisdiction: "US", fee_cents: 0, waiver_available: 0 },
  {
    id: "ca-birth-certificate-state",
    name: "CA Certified Birth Record",
    jurisdiction: "CA",
    fee_cents: 3100,
    waiver_available: 1,
  },
  {
    id: "mi-birth-certificate-state",
    name: "MI Certified Birth Record",
    jurisdiction: "MI",
    fee_cents: 3400,
    waiver_available: 1,
  },
  {
    id: "mi-birth-certificate-county",
    name: "MI Certified Birth Record (County Clerk)",
    jurisdiction: "MI",
    fee_cents: null,
    waiver_available: 1,
  },
  { id: "ca-id-card", name: "CA Identification Card", jurisdiction: "CA", fee_cents: 4000, waiver_available: 1 },
  {
    id: "ca-reduced-fee-id-card",
    name: "CA Reduced-Fee Identification Card",
    jurisdiction: "CA",
    fee_cents: 1100,
    waiver_available: 0,
  },
  {
    id: "ca-proof-of-residency",
    name: "CA Proof of Residency",
    jurisdiction: "CA",
    fee_cents: 0,
    waiver_available: 0,
  },
];

const prerequisites: ResolverPrerequisite[] = [
  { document_id: "ca-id-card", requires_document_id: "ca-birth-certificate-state", attestable: 0 },
  { document_id: "ca-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  { document_id: "ca-id-card", requires_document_id: "ca-proof-of-residency", attestable: 1 },
  { document_id: "ca-reduced-fee-id-card", requires_document_id: "ca-birth-certificate-state", attestable: 0 },
];

const MICHIGAN_BORN_CASE = {
  id: "case-mi-born-in-ca",
  birth_jurisdiction: "MI",
  current_jurisdiction: "CA",
  goal_document_id: "ca-id-card",
};

function buildInput(overrides: Partial<ResolverInput> = {}): ResolverInput {
  return {
    caseRecord: {
      id: "case-ca-native",
      birth_jurisdiction: "CA",
      current_jurisdiction: "CA",
      goal_document_id: "ca-id-card",
    },
    documents,
    prerequisites,
    holdings: [],
    standingJurisdictions: ["CA"],
    attestations: [],
    payments: [],
    ...overrides,
  };
}

function labelOf(plan: ReturnType<typeof resolvePlan>, documentId: string): string | undefined {
  return plan.steps.find((s) => s.document_id === documentId)?.label;
}

test("WAIVABLE_PENDING: standing but no signature yet, so the fee still stands", () => {
  const plan = resolvePlan(buildInput());

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "WAIVABLE_PENDING");
  assert.equal(labelOf(plan, "ca-id-card"), "WAIVABLE_PENDING");

  // A waiver is not real until a provider signs: birth $31 + ID $40.
  assert.equal(plan.total_cost_cents, 7100);
});

test("WAIVED: an attestation in the document's jurisdiction zeroes the fee", () => {
  const plan = resolvePlan(
    buildInput({
      attestations: [{ document_id: "ca-birth-certificate-state", valid_in_jurisdiction: "CA" }],
    }),
  );

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "WAIVED");
  // Only the ID card is still unsigned.
  assert.equal(plan.total_cost_cents, 4000);
});

test("attesting flips PENDING to WAIVED and drops the total to zero", () => {
  const before = resolvePlan(buildInput());
  const after = resolvePlan(
    buildInput({
      attestations: [
        { document_id: "ca-birth-certificate-state", valid_in_jurisdiction: "CA" },
        { document_id: "ca-id-card", valid_in_jurisdiction: "CA" },
      ],
    }),
  );

  assert.equal(before.total_cost_cents, 7100);
  assert.equal(after.total_cost_cents, 0);

  assert.equal(labelOf(before, "ca-birth-certificate-state"), "WAIVABLE_PENDING");
  assert.equal(labelOf(after, "ca-birth-certificate-state"), "WAIVED");
  assert.equal(labelOf(before, "ca-id-card"), "WAIVABLE_PENDING");
  assert.equal(labelOf(after, "ca-id-card"), "WAIVED");
});

test("an attestation from the wrong jurisdiction does not clear the fee", () => {
  const plan = resolvePlan(
    buildInput({
      caseRecord: MICHIGAN_BORN_CASE,
      // A California attestation cannot clear a Michigan-held record.
      attestations: [{ document_id: "mi-birth-certificate-state", valid_in_jurisdiction: "CA" }],
    }),
  );

  assert.equal(labelOf(plan, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
});

test("BLOCKED_JURISDICTION is payable: no attestation possible, so someone pays", () => {
  const plan = resolvePlan(buildInput({ caseRecord: MICHIGAN_BORN_CASE }));

  const step = plan.steps.find((s) => s.document_id === "mi-birth-certificate-state");
  assert.equal(step?.label, "BLOCKED_JURISDICTION");
  assert.equal(step?.fee_cents, 3400);
  assert.equal(step?.counts_toward_total, true);

  // $34 Michigan record that no California attestation can clear, plus the
  // still-unsigned $40 California ID.
  assert.equal(plan.total_cost_cents, 7400);
});

test("case-mi-born-in-ca blocks on the Michigan birth record; case-ca-native does not", () => {
  const californiaBorn = resolvePlan(buildInput());
  const michiganBorn = resolvePlan(buildInput({ caseRecord: MICHIGAN_BORN_CASE }));

  assert.equal(labelOf(michiganBorn, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
  assert.ok(michiganBorn.steps.some((s) => s.label === "BLOCKED_JURISDICTION"));

  assert.equal(labelOf(californiaBorn, "ca-birth-certificate-state"), "WAIVABLE_PENDING");
  assert.ok(!californiaBorn.steps.some((s) => s.label === "BLOCKED_JURISDICTION"));
});

test("no California attestation can clear the Michigan record, but a Michigan one can", () => {
  const blocked = resolvePlan(buildInput({ caseRecord: MICHIGAN_BORN_CASE }));
  const withMichiganStanding = resolvePlan(
    buildInput({ caseRecord: MICHIGAN_BORN_CASE, standingJurisdictions: ["CA", "MI"] }),
  );
  const attestedInMichigan = resolvePlan(
    buildInput({
      caseRecord: MICHIGAN_BORN_CASE,
      standingJurisdictions: ["CA", "MI"],
      attestations: [{ document_id: "mi-birth-certificate-state", valid_in_jurisdiction: "MI" }],
    }),
  );

  assert.equal(labelOf(blocked, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
  assert.equal(labelOf(withMichiganStanding, "mi-birth-certificate-state"), "WAIVABLE_PENDING");
  assert.equal(labelOf(attestedInMichigan, "mi-birth-certificate-state"), "WAIVED");

  // The $34 comes off only once a Michigan provider actually signs.
  assert.equal(blocked.total_cost_cents, 7400);
  assert.equal(withMichiganStanding.total_cost_cents, 7400);
  assert.equal(attestedInMichigan.total_cost_cents, 4000);
});

test("HELD: a document already in case_holdings is never charged or attested", () => {
  const plan = resolvePlan(buildInput({ holdings: ["ca-birth-certificate-state"] }));

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "HELD");
  assert.equal(plan.total_cost_cents, 4000);
});

test("PAID: a succeeded payment settles the step and stops charging for it", () => {
  const plan = resolvePlan(
    buildInput({
      payments: [{ document_id: "ca-birth-certificate-state", status: "succeeded" }],
    }),
  );

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "PAID");
  assert.equal(plan.total_cost_cents, 4000);
});

test("a pending payment does not settle the step", () => {
  const plan = resolvePlan(
    buildInput({
      payments: [{ document_id: "ca-birth-certificate-state", status: "requires_payment" }],
    }),
  );

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "WAIVABLE_PENDING");
  assert.equal(plan.total_cost_cents, 7100);
});

test("PAYABLE: a fee with no waiver available sums into the total", () => {
  const plan = resolvePlan(
    buildInput({
      caseRecord: {
        id: "case-reduced-fee",
        birth_jurisdiction: "CA",
        current_jurisdiction: "CA",
        goal_document_id: "ca-reduced-fee-id-card",
      },
    }),
  );

  assert.equal(labelOf(plan, "ca-reduced-fee-id-card"), "PAYABLE");
  // Birth record $31 unsigned + reduced-fee card $11.
  assert.equal(plan.total_cost_cents, 4200);
});

test("PAYABLE_UNVERIFIED: a NULL fee never silently counts as 0", () => {
  const documentsWithoutWaiver: ResolverDocument[] = documents.map((d) =>
    d.id === "mi-birth-certificate-county" ? { ...d, waiver_available: 0 as const } : d,
  );

  const plan = resolvePlan(
    buildInput({
      documents: documentsWithoutWaiver,
      prerequisites: [
        { document_id: "ca-id-card", requires_document_id: "mi-birth-certificate-county", attestable: 0 },
      ],
    }),
  );

  const step = plan.steps.find((s) => s.document_id === "mi-birth-certificate-county");
  assert.equal(step?.label, "PAYABLE_UNVERIFIED");
  assert.equal(step?.counts_toward_total, false);
  assert.equal(plan.has_unverified_costs, true);
  // Only the $40 ID card is counted; the unknown fee contributed nothing.
  assert.equal(plan.total_cost_cents, 4000);
});

test("a blocked step with an unverified fee is flagged rather than counted as 0", () => {
  const plan = resolvePlan(
    buildInput({
      // County record is MI, org has CA standing only -> BLOCKED_JURISDICTION,
      // and its fee is NULL.
      prerequisites: [
        { document_id: "ca-id-card", requires_document_id: "mi-birth-certificate-county", attestable: 0 },
      ],
    }),
  );

  const step = plan.steps.find((s) => s.document_id === "mi-birth-certificate-county");
  assert.equal(step?.label, "BLOCKED_JURISDICTION");
  assert.equal(step?.chargeable, true);
  assert.equal(step?.counts_toward_total, false);
  assert.equal(plan.has_unverified_costs, true);
});

test("birth record is substituted to the jurisdiction that holds it", () => {
  const plan = resolvePlan(buildInput({ caseRecord: MICHIGAN_BORN_CASE }));

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), undefined);
  const substituted = plan.steps.find((s) => s.document_id === "mi-birth-certificate-state");
  assert.equal(substituted?.substituted_for, "ca-birth-certificate-state");
});

test("steps are ordered dependencies first, goal last", () => {
  const plan = resolvePlan(buildInput());

  const goalIndex = plan.steps.findIndex((s) => s.document_id === "ca-id-card");
  assert.equal(goalIndex, plan.steps.length - 1);

  for (const dependencyId of ["ca-birth-certificate-state", "us-ssn-card", "ca-proof-of-residency"]) {
    const index = plan.steps.findIndex((s) => s.document_id === dependencyId);
    assert.ok(index >= 0 && index < goalIndex, `${dependencyId} must precede the goal`);
  }
});

test("a cycle in the prerequisites graph terminates instead of hanging", () => {
  const plan = resolvePlan(
    buildInput({
      prerequisites: [
        { document_id: "ca-id-card", requires_document_id: "ca-birth-certificate-state", attestable: 0 },
        { document_id: "ca-birth-certificate-state", requires_document_id: "ca-id-card", attestable: 0 },
      ],
    }),
  );

  assert.equal(plan.steps.length, 2);
});
