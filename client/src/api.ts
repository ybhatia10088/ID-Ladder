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

export type Plan = {
  case_id: string;
  goal_document_id: string;
  steps: PlanStep[];
  total_cost_cents: number;
  has_unverified_costs: boolean;
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

  plan: (token: string, caseId: string) =>
    request<Plan>(`/api/cases/${encodeURIComponent(caseId)}/plan`, token),

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
