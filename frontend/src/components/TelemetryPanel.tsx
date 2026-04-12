import type { SimulationState } from "../types";

type Props = {
  state: SimulationState | null;
};

function formatVector(value: { x: number; y: number } | null): string {
  if (!value) {
    return "n/a";
  }
  return `${value.x.toFixed(1)}, ${value.y.toFixed(1)}`;
}

export default function TelemetryPanel({ state }: Props) {
  if (!state) {
    return (
      <section className="panel compactPanel telemetry">
        <div className="panelTopline">
          <h2>Telemetry</h2>
        </div>
        <p>Waiting for backend.</p>
      </section>
    );
  }

  const activeInterceptors = state.interceptors.filter((interceptor) => interceptor.active);
  const activeTargets = state.targets.filter((target) => !target.destroyed);
  const shortCount = activeInterceptors.filter(
    (interceptor) => interceptor.interceptor_class === "short",
  ).length;
  const mediumCount = activeInterceptors.filter(
    (interceptor) => interceptor.interceptor_class === "medium",
  ).length;
  const hypersonicCount = activeInterceptors.filter(
    (interceptor) => interceptor.interceptor_class === "hypersonic",
  ).length;

  return (
    <section className="panel compactPanel telemetry">
      <div className="panelTopline">
        <h2>Telemetry</h2>
        <span className="panelTag">Live Feed</span>
      </div>
      <p className="panelNote">
        Track quality, interceptor mix, and current mission state across the active battlespace.
      </p>
      <dl>
        <div className="telemetryWide">
          <dt>Status</dt>
          <dd>{state.status}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{state.phase}</dd>
        </div>
        <div>
          <dt>Sim time</dt>
          <dd>{state.time.toFixed(2)} s</dd>
        </div>
        <div>
          <dt>Active threats</dt>
          <dd>{state.active_threat_count}</dd>
        </div>
        <div>
          <dt>Interceptors</dt>
          <dd>{state.active_interceptor_count}</dd>
        </div>
        <div className="telemetryWide">
          <dt>Doctrine mix</dt>
          <dd>{`SR ${shortCount} / MR ${mediumCount} / HY ${hypersonicCount}`}</dd>
        </div>
        <div>
          <dt>Intercepted</dt>
          <dd>{state.intercepted_count}</dd>
        </div>
        <div>
          <dt>Impacted</dt>
          <dd>{state.impacted_count}</dd>
        </div>
        <div>
          <dt>Tracks locked</dt>
          <dd>{state.radar_tracks.filter((track) => track.track_locked).length}</dd>
        </div>
        <div>
          <dt>Helicopters</dt>
          <dd>{activeTargets.length}</dd>
        </div>
        <div>
          <dt>Lead threat</dt>
          <dd>
            {state.threats.find((threat) => threat.active)?.id
              ? `T${state.threats.find((threat) => threat.active)?.id}`
              : "n/a"}
          </dd>
        </div>
        <div className="telemetryWide">
          <dt>Lead position</dt>
          <dd>{formatVector(state.threats.find((threat) => threat.active)?.position ?? null)}</dd>
        </div>
        <div className="telemetryWide">
          <dt>Lead helicopter</dt>
          <dd>{formatVector(activeTargets[0]?.position ?? null)}</dd>
        </div>
      </dl>
    </section>
  );
}
