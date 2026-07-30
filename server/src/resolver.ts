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
  | "WAIVABLE"
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

export type ResolverInput = {
  caseRecord: ResolverCase;
  documents: ResolverDocument[];
  prerequisites: ResolverPrerequisite[];
  /** Document ids already in case_holdings. */
  holdings: string[];
  /** Jurisdictions the requesting organization is a verified provider in. */
  standingJurisdictions: string[];
};

export type PlanStep = {
  document_id: string;
  name: string;
  jurisdiction: string;
  label: StepLabel;
  fee_cents: number | null;
  /** True only for PAYABLE steps — the ones summed into total_cost_cents. */
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

function labelFor(
  document: ResolverDocument,
  holdings: Set<string>,
  standing: Set<string>,
): StepLabel {
  // Already in hand — nothing to pay, nothing to attest.
  if (holdings.has(document.id)) {
    return "HELD";
  }

  // Cost minimisation is exactly this: prefer a waiver over paying, whenever
  // the organization has standing in the document's own jurisdiction. This is
  // the single rule that makes an attestation change the total.
  if (document.waiver_available === 1) {
    return standing.has(document.jurisdiction) ? "WAIVABLE" : "BLOCKED_JURISDICTION";
  }

  // No waiver exists. A NULL fee means we never verified a real figure, so it
  // must not be summed as 0 — that would understate the plan's cost.
  if (document.fee_cents === null) {
    return "PAYABLE_UNVERIFIED";
  }

  return "PAYABLE";
}

export function resolvePlan(input: ResolverInput): Plan {
  const { caseRecord, documents, prerequisites, holdings, standingJurisdictions } = input;

  const documentsById = new Map(documents.map((d) => [d.id, d]));
  const heldIds = new Set(holdings);
  const standing = new Set(standingJurisdictions);

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

    const label = labelFor(document, heldIds, standing);
    const step: PlanStep = {
      document_id: document.id,
      name: document.name,
      jurisdiction: document.jurisdiction,
      label,
      fee_cents: document.fee_cents,
      counts_toward_total: label === "PAYABLE",
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
    has_unverified_costs: steps.some((s) => s.label === "PAYABLE_UNVERIFIED"),
  };
}
