/**
 * The resolver: given a case and the requesting organization's standing, walk
 * backwards over the prerequisites graph from the goal document and produce an
 * ordered plan.
 *
 * Pure function. No database access, no I/O, no clock. The route loads rows
 * and calls this; that is what makes it trivially testable and what lets the
 * plan be recomputed from scratch on every request.
 */

export type StepLabel =
  | "HELD"
  | "PAID"
  | "WAIVED"
  | "WAIVABLE_PENDING"
  | "PAYABLE"
  | "PAYABLE_UNVERIFIED"
  | "BLOCKED_JURISDICTION";

export type ResolverDocument = {
  id: string;
  name: string;
  jurisdiction: string;
  fee_cents: number | null;
  waiver_available: 0 | 1;
};

export type ResolverPrerequisite = {
  document_id: string;
  requires_document_id: string;
  attestable: 0 | 1;
};

export type ResolverCase = {
  id: string;
  birth_jurisdiction: string;
  current_jurisdiction: string;
  goal_document_id: string;
};

export type ResolverAttestation = {
  document_id: string;
  valid_in_jurisdiction: string;
};

export type ResolverPayment = {
  document_id: string;
  status: string;
};

export type ResolverInput = {
  caseRecord: ResolverCase;
  documents: ResolverDocument[];
  prerequisites: ResolverPrerequisite[];
  /** Document ids already in case_holdings. */
  holdings: string[];
  /** Jurisdictions the requesting organization is a verified provider in. */
  standingJurisdictions: string[];
  /** Attestations already on file for this case. */
  attestations: ResolverAttestation[];
  /** Payments already recorded for this case. */
  payments: ResolverPayment[];
};

export type PlanStep = {
  document_id: string;
  name: string;
  jurisdiction: string;
  label: StepLabel;
  fee_cents: number | null;
  /** True when this step still costs money — i.e. it is not already settled. */
  chargeable: boolean;
  /** True for chargeable steps with a known fee — the ones actually summed. */
  counts_toward_total: boolean;
  /** Set when the document was swapped for the client's birth jurisdiction. */
  substituted_for?: string;
};

export type Plan = {
  case_id: string;
  goal_document_id: string;
  steps: PlanStep[];
  /** Sum of PAYABLE steps only, in integer cents. */
  total_cost_cents: number;
  /** True when some step's real cost is unknown, so the total is a floor. */
  has_unverified_costs: boolean;
};

/**
 * A birth record must come from the state that HOLDS it — the state the client
 * was born in — not the state issuing the goal document. The prerequisite
 * graph is written from the common case (born where you live), so the resolver
 * rewrites any birth-record prerequisite to the case's birth_jurisdiction.
 *
 * This substitution is the whole reason a client living in California but born
 * in Michigan is a different problem from one born in California.
 *
 * Kept as an explicit map rather than inferred from names or id prefixes: it
 * is short, it is obvious what it does, and a wrong guess here would quietly
 * route someone to a state that does not hold their record.
 */
const BIRTH_RECORD_BY_JURISDICTION: Record<string, string> = {
  CA: "ca-birth-certificate-state",
  MI: "mi-birth-certificate-state",
  WA: "wa-birth-certificate",
};

const BIRTH_RECORD_IDS = new Set(Object.values(BIRTH_RECORD_BY_JURISDICTION));

/** Labels that no longer cost anything: already settled one way or another. */
const SETTLED_LABELS = new Set<StepLabel>(["HELD", "PAID", "WAIVED"]);

function labelFor(
  document: ResolverDocument,
  holdings: Set<string>,
  standing: Set<string>,
  attestedJurisdictions: Map<string, Set<string>>,
  paidDocumentIds: Set<string>,
): StepLabel {
  // Already in hand — nothing to pay, nothing to attest.
  if (holdings.has(document.id)) {
    return "HELD";
  }

  // Money already changed hands for this document.
  if (paidDocumentIds.has(document.id)) {
    return "PAID";
  }

  if (document.waiver_available === 1) {
    // A waiver is not real until a provider signs. An attestation only counts
    // if it was issued for the jurisdiction that actually holds the document —
    // a California attestation cannot clear a Michigan record.
    if (attestedJurisdictions.get(document.id)?.has(document.jurisdiction)) {
      return "WAIVED";
    }

    // The org could sign but has not yet, so the fee still stands. Charging
    // full price here is what makes attesting visibly drop the total.
    if (standing.has(document.jurisdiction)) {
      return "WAIVABLE_PENDING";
    }

    // A waiver exists in principle, but this org cannot obtain it. Someone
    // still has to pay, so this counts toward the total.
    return "BLOCKED_JURISDICTION";
  }

  // No waiver exists. A NULL fee means we never verified a real figure, so it
  // must not be summed as 0 — that would understate the plan's cost.
  if (document.fee_cents === null) {
    return "PAYABLE_UNVERIFIED";
  }

  return "PAYABLE";
}

export function resolvePlan(input: ResolverInput): Plan {
  const {
    caseRecord,
    documents,
    prerequisites,
    holdings,
    standingJurisdictions,
    attestations,
    payments,
  } = input;

  const documentsById = new Map(documents.map((d) => [d.id, d]));
  const heldIds = new Set(holdings);
  const standing = new Set(standingJurisdictions);

  // document_id -> the jurisdictions it has been attested for on this case.
  const attestedJurisdictions = new Map<string, Set<string>>();
  for (const attestation of attestations) {
    const existing = attestedJurisdictions.get(attestation.document_id);
    if (existing) {
      existing.add(attestation.valid_in_jurisdiction);
    } else {
      attestedJurisdictions.set(
        attestation.document_id,
        new Set([attestation.valid_in_jurisdiction]),
      );
    }
  }

  const paidDocumentIds = new Set(
    payments.filter((p) => p.status === "succeeded").map((p) => p.document_id),
  );

  const requiredBy = new Map<string, string[]>();
  for (const edge of prerequisites) {
    const existing = requiredBy.get(edge.document_id);
    if (existing) {
      existing.push(edge.requires_document_id);
    } else {
      requiredBy.set(edge.document_id, [edge.requires_document_id]);
    }
  }

  // Rewrite a birth-record prerequisite to the state that actually holds it.
  function resolveId(documentId: string): string {
    if (!BIRTH_RECORD_IDS.has(documentId)) {
      return documentId;
    }
    return BIRTH_RECORD_BY_JURISDICTION[caseRecord.birth_jurisdiction] ?? documentId;
  }

  const steps: PlanStep[] = [];
  const emitted = new Set<string>();
  const inProgress = new Set<string>();

  // Depth-first post-order: a document is emitted only after everything it
  // depends on, so the plan reads dependencies-first.
  function visit(rawId: string): void {
    const documentId = resolveId(rawId);
    if (emitted.has(documentId) || inProgress.has(documentId)) {
      return; // already placed, or a cycle — do not recurse forever
    }
    inProgress.add(documentId);

    for (const dependencyId of requiredBy.get(documentId) ?? []) {
      visit(dependencyId);
    }

    inProgress.delete(documentId);

    const document = documentsById.get(documentId);
    if (!document) {
      return; // unknown document id; nothing meaningful to say about it
    }

    const label = labelFor(document, heldIds, standing, attestedJurisdictions, paidDocumentIds);
    const chargeable = !SETTLED_LABELS.has(label);
    const step: PlanStep = {
      document_id: document.id,
      name: document.name,
      jurisdiction: document.jurisdiction,
      label,
      fee_cents: document.fee_cents,
      chargeable,
      // A chargeable step with an unverified fee contributes nothing rather
      // than a fabricated 0; has_unverified_costs flags that the total is a
      // floor, not the real number.
      counts_toward_total: chargeable && document.fee_cents !== null,
    };
    if (documentId !== rawId) {
      step.substituted_for = rawId;
    }

    steps.push(step);
    emitted.add(documentId);
  }

  visit(caseRecord.goal_document_id);

  let total_cost_cents = 0;
  for (const step of steps) {
    if (step.counts_toward_total && step.fee_cents !== null) {
      total_cost_cents += step.fee_cents;
    }
  }

  return {
    case_id: caseRecord.id,
    goal_document_id: caseRecord.goal_document_id,
    steps,
    total_cost_cents,
    has_unverified_costs: steps.some((s) => s.chargeable && s.fee_cents === null),
  };
}
