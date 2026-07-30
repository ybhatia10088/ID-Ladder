import type { CaseSummary, Plan, PlanStep, StepLabel } from "./api";
import { money } from "./api";

/**
 * Each state gets its own hue AND its own node treatment — filled circle,
 * hollow ring, or square — so the six read apart at projector distance and
 * survive being photographed or printed in greyscale.
 */
type Presentation = {
  tone: string;
  status: string;
  shape: "round" | "square";
  fill: "solid" | "hollow";
  glyph: string;
};

const PRESENTATION: Record<StepLabel, Presentation> = {
  HELD: { tone: "var(--held)", status: "Already on file", shape: "round", fill: "solid", glyph: "✓" },
  PAID: { tone: "var(--paid)", status: "Paid", shape: "round", fill: "solid", glyph: "✓" },
  WAIVED: { tone: "var(--waived)", status: "Fee waived", shape: "round", fill: "solid", glyph: "✓" },
  WAIVABLE_PENDING: {
    tone: "var(--pending)",
    status: "Needs a voucher",
    shape: "round",
    fill: "hollow",
    glyph: "!",
  },
  PAYABLE: { tone: "var(--payable)", status: "Fee due", shape: "round", fill: "hollow", glyph: "$" },
  PAYABLE_UNVERIFIED: {
    tone: "var(--payable)",
    status: "Fee unknown",
    shape: "round",
    fill: "hollow",
    glyph: "?",
  },
  BLOCKED_JURISDICTION: {
    tone: "var(--blocked)",
    status: "Out of reach",
    shape: "square",
    fill: "solid",
    glyph: "✕",
  },
};

const SETTLED: StepLabel[] = ["HELD", "PAID", "WAIVED"];

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
 * One plain-language line explaining why a step is stuck. A caseworker should
 * understand the constraint without knowing what "standing" means.
 */
function blockedExplanation(step: PlanStep, standing: string[], caseSummary?: CaseSummary): string {
  const holder = jurisdictionName(step.jurisdiction);
  const yours = standing.map(jurisdictionName).join(" and ") || "your";
  const born = caseSummary ? jurisdictionName(caseSummary.birth_jurisdiction) : holder;

  return (
    `${holder} holds this record because your client was born there, and only a verifier ` +
    `approved in ${holder} can vouch for the fee waiver. Your ${yours} approval does not carry ` +
    `across the state line, so this step stays ${step.fee_cents === null ? "unpriced" : money(step.fee_cents)} ` +
    `until a ${born} partner signs it — or you pay it.`
  );
}

type ChainProps = {
  plan: Plan;
  standing: string[];
  caseSummary?: CaseSummary;
  busyDocumentId: string | null;
  onVouch: (documentId: string) => void;
  onPay: (documentId: string) => void;
};

export default function Chain({
  plan,
  standing,
  caseSummary,
  busyDocumentId,
  onVouch,
  onPay,
}: ChainProps) {
  return (
    <section className="chain">
      <header className="chain-head">
        <h2 className="label" style={{ margin: 0 }}>
          What this client needs
        </h2>
        <span>{plan.steps.length} steps, in order — each one unlocks the next</span>
      </header>

      {plan.steps.map((step, index) => {
        // A $0 document is still a step the client has to produce, but calling
        // it "Fee due" next to "No fee" reads as a contradiction.
        const presentation =
          step.label === "PAYABLE" && step.fee_cents === 0
            ? { ...PRESENTATION.PAYABLE, status: "Nothing to pay", glyph: "–" }
            : PRESENTATION[step.label];
        const settled = SETTLED.includes(step.label);
        const isBlocked = step.label === "BLOCKED_JURISDICTION";
        const busy = busyDocumentId === step.document_id;

        // The spine below a step takes that step's colour once it is settled,
        // so cleared runs read as one continuous solid line.
        const segment = settled ? presentation.tone : "var(--line)";

        return (
          <div
            key={step.document_id}
            className={`rung${settled ? "" : " rung--dashed"}`}
            style={
              {
                "--tone": presentation.tone,
                "--seg": segment,
              } as React.CSSProperties
            }
          >
            <div
              className={[
                "node",
                presentation.shape === "square" ? "node--square" : "node--round",
                presentation.fill === "solid" && presentation.shape !== "square"
                  ? "node--solid"
                  : "",
                step.label === "WAIVABLE_PENDING" ? "node--waiting" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            >
              {presentation.glyph}
            </div>

            <div className={`gate${settled ? "" : " gate--open"}`}>
              <div className="gate-main">
                <div className="gate-status">
                  {index + 1} · {presentation.status}
                </div>
                <h3 className="gate-name">{step.name}</h3>

                <div className="gate-meta">
                  <span className="chip">{jurisdictionName(step.jurisdiction)}</span>
                  {step.substituted_for ? (
                    <span>Held by {jurisdictionName(step.jurisdiction)}, not by your state</span>
                  ) : null}
                </div>

                {isBlocked ? (
                  <p className="gate-why">{blockedExplanation(step, standing, caseSummary)}</p>
                ) : null}
              </div>

              <div className="gate-side">
                {step.fee_cents === null ? (
                  <div className="gate-fee--none mono">Fee not published</div>
                ) : step.fee_cents === 0 ? (
                  <div className="gate-fee--none">No fee</div>
                ) : (
                  <div
                    className={`gate-fee mono${settled ? " gate-fee--struck" : ""}`}
                    aria-label={settled ? `${money(step.fee_cents)}, waived` : money(step.fee_cents)}
                  >
                    {money(step.fee_cents)}
                  </div>
                )}

                {step.label === "WAIVABLE_PENDING" ? (
                  <button
                    className="btn btn--vouch"
                    onClick={() => onVouch(step.document_id)}
                    disabled={busy}
                  >
                    {busy ? "Signing…" : "Vouch for this client"}
                  </button>
                ) : null}

                {(step.label === "PAYABLE" || step.label === "BLOCKED_JURISDICTION") &&
                step.fee_cents !== null &&
                step.fee_cents > 0 ? (
                  <button
                    className="btn btn--pay"
                    onClick={() => onPay(step.document_id)}
                    disabled={busy}
                  >
                    {busy ? "Opening…" : `Pay ${money(step.fee_cents)}`}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <div className="legend">
        {(
          [
            "WAIVED",
            "WAIVABLE_PENDING",
            "PAYABLE",
            "PAID",
            "HELD",
            "BLOCKED_JURISDICTION",
          ] as StepLabel[]
        ).map((label) => {
          const presentation = PRESENTATION[label];
          return (
            <span
              key={label}
              className="legend-item"
              style={{ "--tone": presentation.tone } as React.CSSProperties}
            >
              <i
                className={[
                  "legend-dot",
                  presentation.shape === "square"
                    ? "legend-dot--square"
                    : presentation.fill === "solid"
                      ? "legend-dot--solid"
                      : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              {presentation.status}
            </span>
          );
        })}
      </div>
    </section>
  );
}
