import { useEffect, useState } from "react";

import type { Affidavit as AffidavitRecord } from "./api";
import { money } from "./api";

const JURISDICTION_NAMES: Record<string, string> = {
  CA: "California",
  MI: "Michigan",
  WA: "Washington",
  US: "Federal",
};

function jurisdictionName(code: string): string {
  return JURISDICTION_NAMES[code] ?? code;
}

/**
 * Document names carry the issuing body in a trailing parenthetical — "(State
 * Registrar, VS 111)", "(MDHHS Vital Records)", "(DMV)". Naming the agency
 * outright is the point of the field; falling back to the state alone would
 * make the affidavit vaguer than the record it is about.
 */
function issuingAgency(documentName: string, jurisdiction: string): string {
  const match = /\(([^)]+)\)\s*$/.exec(documentName);
  const state = jurisdictionName(jurisdiction);
  return match ? `${match[1]} · ${state}` : state;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })} at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="af-field">
      <div className="af-field-label">{label}</div>
      <div className="af-field-value">{value}</div>
    </div>
  );
}

/**
 * The signed affidavit, as a document rather than app UI: ruled boxes, a
 * docket number, a statutory recital, and a signature block. Printing it is
 * the point, so everything else on the page is hidden at print time.
 */
export default function Affidavit({
  record,
  onClose,
}: {
  record: AffidavitRecord;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const signer = record.attested_by_name ?? record.attested_by_email ?? record.attested_by_user_id;
  const state = jurisdictionName(record.valid_in_jurisdiction);

  return (
    <div className="af-backdrop" role="dialog" aria-modal="true" aria-label="Affidavit">
      <div className="af-controls">
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <article className="af-sheet">
        <header className="af-head">
          <div>
            <div className="af-issuer">{state} · Fee waiver</div>
            <h1 className="af-title">Affidavit of homeless status</h1>
          </div>
          <div className="af-docket">
            <div className="af-field-label">Docket</div>
            <div className="mono af-docket-number">{record.id.slice(0, 8).toUpperCase()}</div>
          </div>
        </header>

        <div className="af-rule" />

        <section className="af-grid">
          <Field label="Record requested" value={record.document_name} />
          <Field
            label="Issuing agency"
            value={issuingAgency(record.document_name, record.document_jurisdiction)}
          />
          <Field label="Client reference" value={record.client_ref} />
          <Field
            label="Fee waived"
            value={record.fee_cents === null ? "Not published" : money(record.fee_cents)}
          />
          <Field label="Verifying organization" value={record.organization_name} />
          <Field
            label="Approved to vouch in"
            value={record.standing_jurisdictions.map(jurisdictionName).join(", ") || "—"}
          />
        </section>

        <div className="af-rule" />

        <section className="af-recital">
          <div className="af-field-label">Attestation</div>
          <p>
            The undersigned, acting for <strong>{record.organization_name}</strong>, a verifier
            approved in <strong>{state}</strong>, attests that the client identified above as{" "}
            <strong>{record.client_ref}</strong> is experiencing homelessness, and requests that
            the fee for the record named above be waived under{" "}
            <strong>
              {record.waiver_statute ?? `the applicable ${state} fee-waiver provision`}
            </strong>
            .
          </p>
          {record.source_note ? <p className="af-note">{record.source_note}</p> : null}
        </section>

        <div className="af-rule" />

        <section className="af-signature">
          <div className="af-sign-block">
            <div className="af-sign-line">{signer}</div>
            <div className="af-field-label">Signed by</div>
            {record.attested_by_email ? (
              <div className="af-sign-meta">{record.attested_by_email}</div>
            ) : null}
          </div>
          <div className="af-sign-block">
            <div className="af-sign-line mono">{formatTimestamp(record.created_at)}</div>
            <div className="af-field-label">Date signed</div>
          </div>
        </section>

        <footer className="af-foot">
          <span>
            Recorded by ID Ladder · account {record.attested_by_user_id}
          </span>
          {record.source_url ? <span className="af-foot-url">{record.source_url}</span> : null}
        </footer>
      </article>
    </div>
  );
}

/** Small hook so the case view can open an affidavit without extra plumbing. */
export function useAffidavit(
  load: (documentId: string) => Promise<AffidavitRecord>,
): {
  record: AffidavitRecord | null;
  open: (documentId: string) => void;
  close: () => void;
  error: string | null;
} {
  const [record, setRecord] = useState<AffidavitRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  return {
    record,
    error,
    open: (documentId: string) => {
      setError(null);
      void load(documentId)
        .then(setRecord)
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        );
    },
    close: () => setRecord(null),
  };
}
