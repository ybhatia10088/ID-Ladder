import { useCallback, useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";

import Chain from "./Chain";
import Total from "./Total";
import { ApiError, api } from "./api";
import type { CaseSummary, Me, Plan } from "./api";

const JURISDICTION_NAMES: Record<string, string> = {
  CA: "California",
  MI: "Michigan",
  WA: "Washington",
  US: "Federal",
};

function jurisdictionName(code: string): string {
  return JURISDICTION_NAMES[code] ?? code;
}

function Wordmark() {
  return (
    <div className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      ID Ladder
    </div>
  );
}

/** Signed-out state. Auth0 Universal Login is hosted — we never draw a form. */
function Gateway() {
  const { loginWithRedirect } = useAuth0();

  return (
    <div className="gateway">
      <div className="gateway-card">
        <Wordmark />
        <h1>Get your clients their documents, without paying for what a waiver covers.</h1>
        <p>
          ID Ladder traces the chain of records a client needs to reach a state ID, shows which
          fees your organization can waive by vouching, and charges only for what is genuinely
          owed. Currently modeling California, Michigan, and Washington.
        </p>
        <button className="btn" onClick={() => void loginWithRedirect()}>
          Sign in to continue
        </button>
      </div>
    </div>
  );
}

/**
 * Stripe sends the browser back to `/?payment=succeeded&case_id=…&document_id=…`.
 * Read once in a state initialiser — before any effect can run — then clear the
 * query string so a refresh does not replay the confirmation.
 */
function useReturnFromCheckout() {
  const [params] = useState(() => {
    const search = new URLSearchParams(window.location.search);
    return {
      paid: search.get("payment") === "succeeded",
      caseId: search.get("case_id") || null,
      documentId: search.get("document_id") || null,
    };
  });

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return params;
}

export default function App() {
  const { isLoading, isAuthenticated, logout, getAccessTokenSilently } = useAuth0();
  const returned = useReturnFromCheckout();

  const [me, setMe] = useState<Me | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(returned.caseId);
  const [paidDocumentId, setPaidDocumentId] = useState<string | null>(
    returned.paid ? returned.documentId : null,
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = useCallback(() => getAccessTokenSilently(), [getAccessTokenSilently]);

  useEffect(() => {
    if (!paidDocumentId) return;
    const timer = window.setTimeout(() => setPaidDocumentId(null), 12000);
    return () => window.clearTimeout(timer);
  }, [paidDocumentId]);

  // Load identity and caseload once signed in.
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    void (async () => {
      try {
        const accessToken = await token();
        const [profile, caseList] = await Promise.all([
          api.me(accessToken),
          api.cases(accessToken),
        ]);
        if (cancelled) return;
        setMe(profile);
        setCases(caseList.cases);
        setActiveCaseId((current) => {
          const known = caseList.cases.some((entry) => entry.id === current);
          return known ? current : (caseList.cases[0]?.id ?? null);
        });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token]);

  // The plan is always refetched, never derived locally, so the server stays
  // the single source of truth after an attestation or payment.
  useEffect(() => {
    if (!isAuthenticated || !activeCaseId) return;

    let cancelled = false;
    void (async () => {
      try {
        const next = await api.plan(await token(), activeCaseId);
        if (!cancelled) setPlan(next);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activeCaseId, token]);

  const onVouch = async (documentId: string) => {
    if (!activeCaseId) return;
    setBusyDocumentId(documentId);
    setError(null);
    try {
      setPlan(await api.attest(await token(), activeCaseId, documentId));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 403
          ? "Your organization is not approved in that state, so it cannot vouch for this record."
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setBusyDocumentId(null);
    }
  };

  const onPay = async (documentId: string) => {
    if (!activeCaseId) return;
    setBusyDocumentId(documentId);
    setError(null);
    try {
      const { checkout_url } = await api.pay(await token(), activeCaseId, documentId);
      window.location.href = checkout_url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusyDocumentId(null);
    }
  };

  const onSubscribe = async () => {
    if (!me) return;
    try {
      const { checkout_url } = await api.subscribe(await token(), me.organization.id);
      window.location.href = checkout_url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (isLoading) {
    return <div className="spinner">Checking your session…</div>;
  }

  if (!isAuthenticated) {
    return <Gateway />;
  }

  const activeCase = cases.find((c) => c.id === activeCaseId);

  return (
    <div className="page">
      <header className="masthead">
        <Wordmark />
        <div className="masthead-right">
          <div className="who">
            <strong>{me?.organization.name ?? "Loading…"}</strong>
            <span>
              {me
                ? `Approved to vouch in ${me.organization.standing_jurisdictions
                    .map(jurisdictionName)
                    .join(", ")}`
                : ""}
            </span>
          </div>
          <button className="btn btn--ghost" onClick={() => void onSubscribe()}>
            Upgrade — $49/mo
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="casebar" aria-label="Your caseload">
        {cases.map((entry) => (
          <button
            key={entry.id}
            className="casetab"
            aria-pressed={entry.id === activeCaseId}
            onClick={() => setActiveCaseId(entry.id)}
          >
            <div className="casetab-ref mono">{entry.client_ref}</div>
            <div className="casetab-route">
              Born in <b>{jurisdictionName(entry.birth_jurisdiction)}</b>, living in{" "}
              <b>{jurisdictionName(entry.current_jurisdiction)}</b>
            </div>
          </button>
        ))}
      </nav>

      {activeCase && plan ? (
        <>
          <section className="ribbon">
            <div>
              <div className="label">Goal</div>
              <h1 className="ribbon-goal">{activeCase.goal_document_name}</h1>
              <p className="ribbon-sub">
                {activeCase.birth_jurisdiction === activeCase.current_jurisdiction
                  ? `Everything ${activeCase.client_ref} needs sits inside ${jurisdictionName(activeCase.current_jurisdiction)}, so you can vouch for all of it.`
                  : `${activeCase.client_ref} lives in ${jurisdictionName(activeCase.current_jurisdiction)} but was born in ${jurisdictionName(activeCase.birth_jurisdiction)}, so one record sits outside the states you cover.`}
              </p>
            </div>
            <Total cents={plan.total_cost_cents} hasUnverified={plan.has_unverified_costs} />
          </section>

          {error ? <p className="notice">{error}</p> : null}

          <Chain
            plan={plan}
            standing={me?.organization.standing_jurisdictions ?? []}
            caseSummary={activeCase}
            busyDocumentId={busyDocumentId}
            paidDocumentId={paidDocumentId}
            onVouch={(id) => void onVouch(id)}
            onPay={(id) => void onPay(id)}
          />
        </>
      ) : (
        <div className="spinner">Opening the case…</div>
      )}
    </div>
  );
}
