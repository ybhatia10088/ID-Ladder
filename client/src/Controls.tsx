import type { ControlState, Graph, Plan } from "./api";

/**
 * The control strip.
 *
 * The resolver's inputs are otherwise invisible constants, which makes the
 * whole thing look like fixed data. Every input it actually consumes is
 * exposed here, and changing any of them recomputes the ladder against the
 * live graph — as query parameters, so nothing is written to the database and
 * a refresh returns to stored state.
 */

const JURISDICTIONS = ["CA", "MI", "WA"] as const;

const JURISDICTION_NAMES: Record<string, string> = {
  CA: "California",
  MI: "Michigan",
  WA: "Washington",
  US: "Federal",
};

function Segmented({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="control">
      <div className="label">{legend}</div>
      <div className="segmented" role="group" aria-label={legend}>
        {JURISDICTIONS.map((code) => (
          <button
            key={code}
            type="button"
            className="segment"
            aria-pressed={value === code}
            onClick={() => onChange(code)}
          >
            {JURISDICTION_NAMES[code]}
          </button>
        ))}
      </div>
    </div>
  );
}

type ControlsProps = {
  plan: Plan;
  graph: Graph | null;
  controls: ControlState;
  onChange: (next: ControlState) => void;
  onReset: () => void;
};

export default function Controls({ plan, graph, controls, onChange, onReset }: ControlsProps) {
  const effective = plan.controls;

  // Goals are documents that actually have prerequisites — anything else has
  // no chain to draw.
  const goalOptions = (graph?.documents ?? []).filter((d) => d.has_prerequisites);

  // Checkboxes cover what is in the chain now, plus anything already ticked —
  // otherwise ticking a document would remove its own checkbox as it prunes.
  const holdable = Array.from(
    new Map(
      [
        ...plan.steps.map((s) => [s.document_id, s.name] as const),
        ...effective.holdings.map(
          (id) =>
            [id, graph?.documents.find((d) => d.id === id)?.name ?? id] as const,
        ),
      ].map(([id, name]) => [id, name]),
    ).entries(),
  );

  const standing = effective.standing;

  const toggleStanding = (code: string) => {
    const next = standing.includes(code)
      ? standing.filter((c) => c !== code)
      : [...standing, code];
    onChange({ ...controls, standing: next });
  };

  const toggleHolding = (documentId: string) => {
    const current = effective.holdings;
    const next = current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId];
    onChange({ ...controls, holds: next });
  };

  return (
    <section className="controls" aria-label="Plan inputs">
      <header className="controls-head">
        <h2 className="label" style={{ margin: 0 }}>
          Change any of these and the ladder recomputes
        </h2>
        {effective.overridden ? (
          <button type="button" className="controls-reset" onClick={onReset}>
            Reset to this case
          </button>
        ) : null}
      </header>

      <div className="controls-grid">
        <Segmented
          legend="Born in"
          value={effective.birth_jurisdiction}
          onChange={(next) => onChange({ ...controls, born_in: next })}
        />

        <Segmented
          legend="Living in"
          value={effective.current_jurisdiction}
          onChange={(next) => onChange({ ...controls, living_in: next })}
        />

        <div className="control">
          <div className="label">Goal</div>
          <select
            className="control-select"
            value={effective.goal_document_id}
            onChange={(event) => onChange({ ...controls, goal: event.target.value })}
          >
            {goalOptions.length === 0 ? (
              <option value={effective.goal_document_id}>Loading…</option>
            ) : (
              goalOptions.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.name}
                </option>
              ))
            )}
          </select>
        </div>

        {/* The thesis: widen where this organization can vouch and a blocked
            step becomes vouchable. */}
        <div className="control control--wide">
          <div className="label">This organization can vouch in</div>
          <div className="chips">
            {JURISDICTIONS.map((code) => (
              <button
                key={code}
                type="button"
                className="toggle"
                aria-pressed={standing.includes(code)}
                onClick={() => toggleStanding(code)}
              >
                {JURISDICTION_NAMES[code]}
              </button>
            ))}
          </div>
        </div>

        <div className="control control--wide">
          <div className="label">Already has</div>
          {holdable.length === 0 ? (
            <p className="controls-empty">Nothing in this chain yet.</p>
          ) : (
            <div className="checks">
              {holdable.map(([documentId, name]) => (
                <label key={documentId} className="check">
                  <input
                    type="checkbox"
                    checked={effective.holdings.includes(documentId)}
                    onChange={() => toggleHolding(documentId)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
