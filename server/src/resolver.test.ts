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
    ...overrides,
  };
}

function labelOf(plan: ReturnType<typeof resolvePlan>, documentId: string): string | undefined {
  return plan.steps.find((s) => s.document_id === documentId)?.label;
}

test("WAIVABLE: waiver exists and the org has standing in that jurisdiction", () => {
  const plan = resolvePlan(buildInput());

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "WAIVABLE");
  assert.equal(labelOf(plan, "ca-id-card"), "WAIVABLE");
});

test("PAYABLE: a fee with no waiver available, and it sums into the total", () => {
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
  // The birth record is still waivable, so only the $11.00 card is charged.
  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "WAIVABLE");
  assert.equal(plan.total_cost_cents, 1100);
});

test("HELD: a document already in case_holdings is never charged or attested", () => {
  const plan = resolvePlan(buildInput({ holdings: ["ca-birth-certificate-state"] }));

  assert.equal(labelOf(plan, "ca-birth-certificate-state"), "HELD");
  assert.equal(plan.total_cost_cents, 0);
});

test("BLOCKED_JURISDICTION: waiver exists but the org lacks standing there", () => {
  const plan = resolvePlan(
    buildInput({
      caseRecord: {
        id: "case-mi-born-in-ca",
        birth_jurisdiction: "MI",
        current_jurisdiction: "CA",
        goal_document_id: "ca-id-card",
      },
    }),
  );

  assert.equal(labelOf(plan, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
});

test("case-mi-born-in-ca blocks on the Michigan birth record; case-ca-native does not", () => {
  const californiaBorn = resolvePlan(buildInput());
  const michiganBorn = resolvePlan(
    buildInput({
      caseRecord: {
        id: "case-mi-born-in-ca",
        birth_jurisdiction: "MI",
        current_jurisdiction: "CA",
        goal_document_id: "ca-id-card",
      },
    }),
  );

  // The CA-standing org cannot attest for a Michigan-held record.
  assert.equal(labelOf(michiganBorn, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
  assert.ok(michiganBorn.steps.some((s) => s.label === "BLOCKED_JURISDICTION"));

  // Same org, same goal, born in state: nothing is blocked.
  assert.equal(labelOf(californiaBorn, "ca-birth-certificate-state"), "WAIVABLE");
  assert.ok(!californiaBorn.steps.some((s) => s.label === "BLOCKED_JURISDICTION"));
});

test("birth record is substituted to the jurisdiction that holds it", () => {
  const plan = resolvePlan(
    buildInput({
      caseRecord: {
        id: "case-mi-born-in-ca",
        birth_jurisdiction: "MI",
        current_jurisdiction: "CA",
        goal_document_id: "ca-id-card",
      },
    }),
  );

  // The CA birth record is not in the plan at all; Michigan's replaced it.
  assert.equal(labelOf(plan, "ca-birth-certificate-state"), undefined);
  const substituted = plan.steps.find((s) => s.document_id === "mi-birth-certificate-state");
  assert.equal(substituted?.substituted_for, "ca-birth-certificate-state");
});

test("granting Michigan standing turns the blocked step waivable", () => {
  const michiganCase = {
    id: "case-mi-born-in-ca",
    birth_jurisdiction: "MI",
    current_jurisdiction: "CA",
    goal_document_id: "ca-id-card",
  };

  const blocked = resolvePlan(buildInput({ caseRecord: michiganCase }));
  const unblocked = resolvePlan(
    buildInput({ caseRecord: michiganCase, standingJurisdictions: ["CA", "MI"] }),
  );

  assert.equal(labelOf(blocked, "mi-birth-certificate-state"), "BLOCKED_JURISDICTION");
  assert.equal(labelOf(unblocked, "mi-birth-certificate-state"), "WAIVABLE");
});

test("an attestation visibly lowers the total: standing flips PAYABLE to WAIVABLE", () => {
  // Strip the waiver-bearing org standing so the CA ID has to be paid for.
  const withoutStanding = resolvePlan(buildInput({ standingJurisdictions: [] }));
  const withStanding = resolvePlan(buildInput({ standingJurisdictions: ["CA"] }));

  // Without standing both waivable documents are blocked, so nothing is
  // payable — blocked work is not silently billed.
  assert.equal(labelOf(withoutStanding, "ca-id-card"), "BLOCKED_JURISDICTION");
  assert.equal(labelOf(withStanding, "ca-id-card"), "WAIVABLE");
  assert.equal(withStanding.total_cost_cents, 0);
});

test("PAYABLE_UNVERIFIED: a NULL fee never silently counts as 0", () => {
  // Force the county record to have no waiver, so it falls through to the fee
  // branch with fee_cents NULL.
  const documentsWithoutWaiver: ResolverDocument[] = documents.map((d) =>
    d.id === "mi-birth-certificate-county" ? { ...d, waiver_available: 0 as const } : d,
  );

  const plan = resolvePlan(
    buildInput({
      documents: documentsWithoutWaiver,
      prerequisites: [
        { document_id: "ca-id-card", requires_document_id: "mi-birth-certificate-county", attestable: 0 },
      ],
      caseRecord: {
        id: "case-unverified",
        birth_jurisdiction: "CA",
        current_jurisdiction: "CA",
        goal_document_id: "ca-id-card",
      },
    }),
  );

  const step = plan.steps.find((s) => s.document_id === "mi-birth-certificate-county");
  assert.equal(step?.label, "PAYABLE_UNVERIFIED");
  assert.equal(step?.fee_cents, null);
  assert.equal(step?.counts_toward_total, false);
  assert.equal(plan.has_unverified_costs, true);
  // The unknown fee contributed nothing rather than a fabricated 0.
  assert.equal(plan.total_cost_cents, 0);
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
