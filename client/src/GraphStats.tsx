import type { Graph } from "./api";

const JURISDICTION_NAMES: Record<string, string> = {
  CA: "California",
  MI: "Michigan",
  WA: "Washington",
  US: "Federal",
};

/**
 * Evidence that the graph is bigger than the chain on screen — read live from
 * the database, not written down. Deliberately quiet: it sits below the legend
 * and must never pull attention from the ladder or the total.
 */
export default function GraphStats({ graph }: { graph: Graph | null }) {
  if (!graph) return null;

  const { stats } = graph;

  return (
    <section className="stats" aria-label="Document graph">
      <span className="stats-lead">In the graph</span>
      <span className="stats-item">
        <b className="mono">{stats.documents}</b> documents
      </span>
      <span className="stats-item">
        <b className="mono">{stats.prerequisites}</b> prerequisite links
      </span>
      {stats.by_jurisdiction.map((row) => (
        <span key={row.jurisdiction} className="stats-item">
          <b className="mono">{row.documents}</b>{" "}
          {JURISDICTION_NAMES[row.jurisdiction] ?? row.jurisdiction}
        </span>
      ))}
    </section>
  );
}
