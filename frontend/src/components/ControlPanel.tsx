type Props = {
  speed: number;
  angleDeg: number;
  threatCount: number;
  environmentMode: "day" | "night";
  loading: boolean;
  onSpeedChange: (value: number) => void;
  onAngleChange: (value: number) => void;
  onThreatCountChange: (value: number) => void;
  onEnvironmentModeChange: (value: "day" | "night") => void;
  onLaunch: () => void;
  onLaunchTargeted: () => void;
  onLaunchFast: () => void;
  onLaunchSuper: () => void;
  onLaunchHypersonic: () => void;
  onLaunchMultiple: () => void;
  onLaunchPreset: (preset: "single_arc" | "saturation" | "mixed_wave" | "dual_axis") => void;
  onReset: () => void;
};

export default function ControlPanel(props: Props) {
  const {
    speed,
    angleDeg,
    threatCount,
    environmentMode,
    loading,
    onSpeedChange,
    onAngleChange,
    onThreatCountChange,
    onEnvironmentModeChange,
    onLaunch,
    onLaunchTargeted,
    onLaunchFast,
    onLaunchSuper,
    onLaunchHypersonic,
    onLaunchMultiple,
    onLaunchPreset,
    onReset,
  } = props;

  return (
    <section className="panel compactPanel controlPanel">
      <div className="panelTopline">
        <h2>Engagement Controls</h2>
        <span className="panelTag">Weapons</span>
      </div>
      <p className="panelNote">
        Configure launch parameters, select tactical presets, and trigger engagement patterns against the active air picture.
      </p>
      <div className="controlSection">
        <span className="sectionLabel">Threat Profile</span>
        <label>
          Threat speed
          <input
            type="range"
            min="45"
            max="80"
            step="1"
            value={speed}
            onChange={(event) => onSpeedChange(Number(event.target.value))}
          />
          <span>{speed.toFixed(0)} km/s</span>
        </label>
        <label>
          Launch angle
          <input
            type="range"
            min="20"
            max="70"
            step="1"
            value={angleDeg}
            onChange={(event) => onAngleChange(Number(event.target.value))}
          />
          <span>{angleDeg.toFixed(0)} deg</span>
        </label>
        <label>
          Threat count
          <input
            className="countInput"
            type="number"
            min="1"
            max="12"
            step="1"
            value={threatCount}
            onChange={(event) => onThreatCountChange(Number(event.target.value) || 1)}
          />
          <span>{threatCount} threats</span>
        </label>
      </div>
      <div className="controlSection">
        <span className="sectionLabel">Quick Threat Classes</span>
        <div className="threatModes">
          <button className="modeButton" disabled={loading} onClick={onLaunchFast}>
            Fast
          </button>
          <button className="modeButton dangerButton" disabled={loading} onClick={onLaunchSuper}>
            Super
          </button>
          <button className="modeButton extremeButton" disabled={loading} onClick={onLaunchHypersonic}>
            Hypersonic
          </button>
        </div>
      </div>
      <div className="controlSection">
        <span className="sectionLabel">Environment</span>
        <div className="environmentToggle">
          <button
            className={`presetButton ${environmentMode === "day" ? "" : "ghost"}`}
            disabled={loading}
            onClick={() => onEnvironmentModeChange("day")}
          >
            Day
          </button>
          <button
            className={`presetButton ${environmentMode === "night" ? "" : "ghost"}`}
            disabled={loading}
            onClick={() => onEnvironmentModeChange("night")}
          >
            Night
          </button>
        </div>
      </div>
      <div className="controlSection">
        <span className="sectionLabel">Scenario Presets</span>
        <div className="presetGrid">
          <button className="presetButton ghost" disabled={loading} onClick={() => onLaunchPreset("single_arc")}>
            Single Arc
          </button>
          <button className="presetButton ghost" disabled={loading} onClick={() => onLaunchPreset("saturation")}>
            Saturation
          </button>
          <button className="presetButton ghost" disabled={loading} onClick={() => onLaunchPreset("mixed_wave")}>
            Mixed Wave
          </button>
          <button className="presetButton ghost" disabled={loading} onClick={() => onLaunchPreset("dual_axis")}>
            Dual Axis
          </button>
        </div>
      </div>
      <div className="controlSection actionSection">
        <span className="sectionLabel">Mission Actions</span>
        <div className="buttonRow">
          <button disabled={loading} onClick={onLaunch}>
            Launch Threat
          </button>
          <button disabled={loading} onClick={onLaunchTargeted}>
            Strike Both Targets
          </button>
          <button disabled={loading} onClick={onLaunchMultiple}>
            Auto Launch {threatCount}
          </button>
          <button className="ghost" disabled={loading} onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
