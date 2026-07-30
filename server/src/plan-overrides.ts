/**
 * Live overrides supplied as query parameters on the plan request.
 *
 * These change one computation and nothing else — never written to the
 * database, so a refresh returns to stored state. Deliberately read-only: the
 * attest route ignores them entirely and always uses the organization's real
 * standing, so a caller cannot widen their own authority by asking for a plan
 * with extra jurisdictions.
 */
export type PlanOverrides = {
  birth_jurisdiction?: string;
  current_jurisdiction?: string;
  goal_document_id?: string;
  holdings?: string[];
  standing?: string[];
};

function csv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function overridesFrom(query: Record<string, unknown>): PlanOverrides {
  const overrides: PlanOverrides = {};

  if (typeof query.born_in === "string" && query.born_in) {
    overrides.birth_jurisdiction = query.born_in.toUpperCase();
  }
  if (typeof query.living_in === "string" && query.living_in) {
    overrides.current_jurisdiction = query.living_in.toUpperCase();
  }
  if (typeof query.goal === "string" && query.goal) {
    overrides.goal_document_id = query.goal;
  }
  // Presence matters, not truthiness: `holds=` means "holds nothing", and
  // `standing=` means "cannot vouch anywhere". Both are meaningful states the
  // control strip can produce by unticking everything.
  if (query.holds !== undefined) {
    overrides.holdings = csv(query.holds);
  }
  if (query.standing !== undefined) {
    overrides.standing = csv(query.standing).map((code) => code.toUpperCase());
  }

  return overrides;
}
