type Props = {
  pingMs: number | null;
};

function getPingTone(pingMs: number | null): {
  label: string;
  className: string;
  detail: string;
} {
  if (pingMs == null) {
    return {
      label: "Offline",
      className: "pingBadge pingBadgeOffline",
      detail: "Awaiting live link",
    };
  }

  if (pingMs < 90) {
    return {
      label: "Stable",
      className: "pingBadge pingBadgeStable",
      detail: "Low-latency feed",
    };
  }

  if (pingMs < 180) {
    return {
      label: "Watch",
      className: "pingBadge pingBadgeWatch",
      detail: "Moderate delay",
    };
  }

  return {
    label: "Slow",
    className: "pingBadge pingBadgeSlow",
    detail: "High latency link",
  };
}

export default function PingCard({ pingMs }: Props) {
  const tone = getPingTone(pingMs);

  return (
    <section className="panel compactPanel pingCard">
      <div className="panelTopline">
        <h2>Network Ping</h2>
        <span className={tone.className}>{tone.label}</span>
      </div>
      <div className="pingCardBody">
        <strong>{pingMs == null ? "--" : `${Math.round(pingMs)} ms`}</strong>
        <span>{tone.detail}</span>
      </div>
    </section>
  );
}
