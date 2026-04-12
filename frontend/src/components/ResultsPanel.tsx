import type { SimulationState } from "../types";

type Props = {
  state: SimulationState | null;
};

function successRate(state: SimulationState | null) {
  if (!state) {
    return "0%";
  }
  const resolved = state.intercepted_count + state.impacted_count;
  if (resolved === 0) {
    return "0%";
  }
  return `${((state.intercepted_count / resolved) * 100).toFixed(1)}%`;
}

export default function ResultsPanel({ state }: Props) {
  return (
    <section className="panel compactPanel resultsPanel">
      <div className="resultsGrid">
        <div className="resultTile">
          <span>Kill</span>
          <strong>{state?.intercepted_count ?? 0}</strong>
        </div>
        <div className="resultTile">
          <span>Fail</span>
          <strong>{state?.impacted_count ?? 0}</strong>
        </div>
        <div className="resultTile resultWide">
          <span>Success</span>
          <strong>{successRate(state)}</strong>
        </div>
      </div>
    </section>
  );
}
