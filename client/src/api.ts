export type StepLabel =
  | "HELD"
  | "PAID"
  | "WAIVED"
  | "WAIVABLE_PENDING"
  | "PAYABLE"
  | "PAYABLE_UNVERIFIED"
  | "BLOCKED_JURISDICTION";

export type PlanStep = {
  document_id: string;
  name: string;
  jurisdiction: string;
  label: StepLabel;
  fee_cents: number | null;
  chargeable: boolean;
  counts_toward_total: boolean;
  substituted_for?: string;
};

export type PlanControls = {
  birth_jurisdiction: string;
  current_jurisdiction: string;
  goal_document_id: string;
  holdings: string[];
  standing: string[];
  stored: {
    birth_jurisdiction: string;
    current_jurisdiction: string;
    goal_document_id: string;
  };
  organization_standing: string[];
  overridden: boolean;
};

export type Plan = {
  case_id: string;
  goal_document_id: string;
  steps: PlanStep[];
  total_cost_cents: number;
  has_unverified_costs: boolean;
  controls: PlanControls;
};

/** What the control strip sends back as query parameters. */
export type ControlState = {
  born_in?: string;
  living_in?: string;
  goal?: string;
  holds?: string[];
  standing?: string[];
};

export type GraphDocument = {
  id: string;
  name: string;
  jurisdiction: string;
  fee_cents: number | null;
  waiver_available: 0 | 1;
  source_url: string | null;
  source_note: string | null;
  has_prerequisites: number;
};

export type Graph = {
  documents: GraphDocument[];
  stats: {
    documents: number;
    prerequisites: number;
    by_jurisdiction: { jurisdiction: string; documents: number }[];
  };
};

export type Affidavit = {
  id: string;
  created_at: string;
  attested_by_user_id: string;
  attested_by_name: string | null;
  attested_by_email: string | null;
  valid_in_jurisdiction: string;
  client_ref: string;
  document_name: string;
  document_jurisdiction: string;
  fee_cents: number | null;
  source_url: string | null;
  source_note: string | null;
  waiver_statute: string | null;
  organization_name: string;
  standing_jurisdictions: string[];
};

export type CaseSummary = {
  id: string;
  client_ref: string;
  birth_jurisdiction: string;
  current_jurisdiction: string;
  goal_document_id: string;
  goal_document_name: string;
};

export type Me = {
  user: { sub: string; email?: string; name?: string };
  organization: { id: string; name: string; standing_jurisdictions: string[] };
};

export type Auth0Config = {
  domain: string | null;
  clientId: string | null;
  redirectUri: string;
};

export async function fetchConfig(): Promise<Auth0Config> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Could not load configuration");
  }
  const body = (await response.json()) as { auth0: Auth0Config };
  return body.auth0;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, (body ?? {}) as Record<string, unknown>);
  }
  return body as T;
}

export const api = {
  me: (token: string) => request<Me>("/api/me", token),

  cases: (token: string) => request<{ cases: CaseSummary[] }>("/api/cases", token),

  graph: (token: string) => request<Graph>("/api/graph", token),

  plan: (token: string, caseId: string, controls: ControlState = {}) => {
    const params = new URLSearchParams();
    if (controls.born_in) params.set("born_in", controls.born_in);
    if (controls.living_in) params.set("living_in", controls.living_in);
    if (controls.goal) params.set("goal", controls.goal);
    // Sent even when empty: an empty list is a meaningful instruction.
    if (controls.holds) params.set("holds", controls.holds.join(","));
    if (controls.standing) params.set("standing", controls.standing.join(","));
    const query = params.toString();
    return request<Plan>(
      `/api/cases/${encodeURIComponent(caseId)}/plan${query ? `?${query}` : ""}`,
      token,
    );
  },

  attest: (token: string, caseId: string, documentId: string) =>
    request<Plan>(`/api/cases/${encodeURIComponent(caseId)}/attest`, token, {
      method: "POST",
      body: JSON.stringify({ document_id: documentId }),
    }),

  pay: (token: string, caseId: string, documentId: string) =>
    request<{ checkout_url: string; amount_cents: number }>(
      `/api/cases/${encodeURIComponent(caseId)}/pay`,
      token,
      { method: "POST", body: JSON.stringify({ document_id: documentId }) },
    ),

  affidavit: (token: string, caseId: string, documentId: string) =>
    request<Affidavit>(
      `/api/cases/${encodeURIComponent(caseId)}/affidavit/${encodeURIComponent(documentId)}`,
      token,
    ),

  subscribe: (token: string, organizationId: string) =>
    request<{ checkout_url: string }>(
      `/api/organizations/${encodeURIComponent(organizationId)}/subscribe`,
      token,
      { method: "POST" },
    ),
};

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
