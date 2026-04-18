import { useEffect, useRef, useState } from "react";
import ControlPanel from "./components/ControlPanel";
import ResultsPanel from "./components/ResultsPanel";
import SimulationCanvas from "./components/SimulationCanvas";
import TelemetryPanel from "./components/TelemetryPanel";
import {
  getState,
  launchThreat,
  resetSimulation,
  strikeAllTargets,
  stepSimulation,
} from "./api/client";
import type { SimulationState } from "./types";

const BATCH_LAUNCH_DELAY_MS = 500;
const SIM_STEP_INTERVAL_MS = 50;
const MAX_POLL_STEPS_PER_TICK = 8;
const FAST_THREAT = { speed: 95, angle: 34 };
const SUPER_THREAT = { speed: 135, angle: 28 };
const HYPERSONIC_THREAT = { speed: 220, angle: 18 };
const BRAND_LOGO_PATH = "/branding/missile-logo.png?v=20260409";
type ScenarioPreset = "single_arc" | "saturation" | "mixed_wave" | "dual_axis";
type EnvironmentMode = "day" | "night";

export default function App() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [speed, setSpeed] = useState(62);
  const [angleDeg, setAngleDeg] = useState(42);
  const [threatCount, setThreatCount] = useState(3);
  const [environmentMode, setEnvironmentMode] = useState<EnvironmentMode>("day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenActionMenuOpen, setIsFullscreenActionMenuOpen] = useState(false);
  const [isFullscreenThreatProfileExpanded, setIsFullscreenThreatProfileExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [mobileSidebarTab, setMobileSidebarTab] = useState<"telemetry" | "controls">(
    "telemetry",
  );
  const tacticalStageRef = useRef<HTMLDivElement | null>(null);
  const latestStateTimeRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const lastPollAtRef = useRef<number | null>(null);

  function applySimulationState(next: SimulationState, source: "bootstrap" | "poll" | "action") {
    if (
      source !== "action" &&
      next.phase !== "idle" &&
      next.time < latestStateTimeRef.current
    ) {
      return;
    }

    latestStateTimeRef.current = next.time;
    setState(next);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNextPoll = () => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(runPoll, 50);
    };

    const runPoll = async () => {
      if (cancelled) {
        return;
      }

      if (pollInFlightRef.current) {
        scheduleNextPoll();
        return;
      }

      pollInFlightRef.current = true;
      const pollStartedAt = performance.now();
      const elapsedMs =
        lastPollAtRef.current == null ? SIM_STEP_INTERVAL_MS : pollStartedAt - lastPollAtRef.current;
      const steps = Math.max(
        1,
        Math.min(MAX_POLL_STEPS_PER_TICK, Math.round(elapsedMs / SIM_STEP_INTERVAL_MS)),
      );

      try {
        const next = await stepSimulation(steps);
        if (!cancelled) {
          lastPollAtRef.current = pollStartedAt;
          applySimulationState(next, "poll");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        pollInFlightRef.current = false;
        scheduleNextPoll();
      }
    };

    void getState()
      .then((next) => {
        if (!cancelled) {
          applySimulationState(next, "bootstrap");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        scheduleNextPoll();
      });

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      const fullscreen = document.fullscreenElement === tacticalStageRef.current;
      setIsFullscreen(fullscreen);
      if (fullscreen) {
        setIsFullscreenActionMenuOpen(true);
        setIsFullscreenThreatProfileExpanded(false);
      } else {
        setIsFullscreenActionMenuOpen(false);
        setIsFullscreenThreatProfileExpanded(false);
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  async function withLoading(action: () => Promise<SimulationState>) {
    setLoading(true);
    try {
      const next = await action();
      applySimulationState(next, "action");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function launchMultipleThreats() {
    setLoading(true);
    try {
      let nextState: SimulationState | null = null;
      for (let index = 0; index < threatCount; index += 1) {
        const speedOffset = Math.round((Math.random() * 16 - 8) * 10) / 10;
        const angleOffset = Math.round((Math.random() * 18 - 9) * 10) / 10;
        const variedSpeed = Math.min(80, Math.max(45, speed + speedOffset));
        const variedAngle = Math.min(70, Math.max(20, angleDeg + angleOffset));
        nextState = await launchThreat(variedSpeed, variedAngle);
        if (index < threatCount - 1) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, BATCH_LAUNCH_DELAY_MS);
          });
        }
      }

      if (nextState) {
        applySimulationState(nextState, "action");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function launchPreset(preset: ScenarioPreset) {
    const patterns: Record<ScenarioPreset, Array<{ speed: number; angle: number; delay: number }>> = {
      single_arc: [
        { speed: 58, angle: 46, delay: 0 },
        { speed: 62, angle: 42, delay: 350 },
        { speed: 66, angle: 38, delay: 350 },
      ],
      saturation: [
        { speed: 72, angle: 40, delay: 0 },
        { speed: 74, angle: 37, delay: 180 },
        { speed: 70, angle: 44, delay: 180 },
        { speed: 76, angle: 34, delay: 180 },
        { speed: 73, angle: 41, delay: 180 },
      ],
      mixed_wave: [
        { speed: FAST_THREAT.speed, angle: FAST_THREAT.angle, delay: 0 },
        { speed: 68, angle: 48, delay: 320 },
        { speed: SUPER_THREAT.speed, angle: SUPER_THREAT.angle, delay: 420 },
        { speed: 64, angle: 36, delay: 260 },
      ],
      dual_axis: [
        { speed: 61, angle: 52, delay: 0 },
        { speed: 88, angle: 24, delay: 240 },
        { speed: 67, angle: 46, delay: 240 },
        { speed: HYPERSONIC_THREAT.speed, angle: HYPERSONIC_THREAT.angle, delay: 420 },
      ],
    };

    setLoading(true);
    try {
      let nextState: SimulationState | null = null;
      for (const pattern of patterns[preset]) {
        nextState = await launchThreat(pattern.speed, pattern.angle);
        if (pattern !== patterns[preset][patterns[preset].length - 1]) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, pattern.delay);
          });
        }
      }
      if (nextState) {
        applySimulationState(nextState, "action");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }


  async function toggleFullscreen() {
    if (!tacticalStageRef.current) {
      return;
    }

    if (document.fullscreenElement === tacticalStageRef.current) {
      await document.exitFullscreen();
      return;
    }

    await tacticalStageRef.current.requestFullscreen();
  }

  function handlePanGesture(delta: number) {
    const dynamicPanLimit = Math.max(220, 220 * zoom);
    setPanX((value) =>
      Math.max(
        -dynamicPanLimit,
        Math.min(dynamicPanLimit, Number((value + delta * 0.18).toFixed(2))),
      ),
    );
  }

  return (
    <main className="appShell">
      <section className="commandLayout">
        <aside className="sidebar">
          <div className="panel sidebarBrand">
            <img className="brandMark" src={BRAND_LOGO_PATH} alt="Air Defense logo" />
            <div className="brandCopy">
              <p className="eyebrow">Integrated Air Defense Network</p>
              <h1>Command Console</h1>
              <p className="brandNote">
                Live interception, air picture tracking, and engagement control for the tactical battlespace.
              </p>
              <div className="brandMeta">
                <span className="brandChip">C2 Node</span>
                <span className="brandChip brandChipMuted">Desktop Ops</span>
              </div>
            </div>
          </div>
          <div className="sidebarTabs">
            <button
              className={`sidebarTab ${mobileSidebarTab === "telemetry" ? "activeTab" : "ghost"}`}
              onClick={() => setMobileSidebarTab("telemetry")}
            >
              Telemetry
            </button>
            <button
              className={`sidebarTab ${mobileSidebarTab === "controls" ? "activeTab" : "ghost"}`}
              onClick={() => setMobileSidebarTab("controls")}
            >
              Controls
            </button>
          </div>
          <div className={mobileSidebarTab === "telemetry" ? "sidebarPanel activePanel" : "sidebarPanel"}>
            <TelemetryPanel state={state} />
          </div>
          <div className={mobileSidebarTab === "controls" ? "sidebarPanel activePanel" : "sidebarPanel"}>
          <ControlPanel
            speed={speed}
            angleDeg={angleDeg}
            threatCount={threatCount}
            environmentMode={environmentMode}
            loading={loading}
            onSpeedChange={setSpeed}
            onAngleChange={setAngleDeg}
            onThreatCountChange={(value) => setThreatCount(Math.min(12, Math.max(1, value)))}
            onEnvironmentModeChange={setEnvironmentMode}
            onLaunch={() => void withLoading(() => launchThreat(speed, angleDeg))}
            onLaunchTargeted={() => void withLoading(() => strikeAllTargets())}
            onLaunchFast={() => void withLoading(() => launchThreat(FAST_THREAT.speed, FAST_THREAT.angle))}
            onLaunchSuper={() => void withLoading(() => launchThreat(SUPER_THREAT.speed, SUPER_THREAT.angle))}
          onLaunchHypersonic={() =>
            void withLoading(() => {
              const spread = (Math.random() * 30 - 15); // -15 to +15 deg
              const variedAngle = Math.max(6, Math.min(40, HYPERSONIC_THREAT.angle + spread));
              return launchThreat(HYPERSONIC_THREAT.speed, Number(variedAngle.toFixed(1)));
            })
          }
          onLaunchMultiple={() => void launchMultipleThreats()}
          onLaunchPreset={(preset) => void launchPreset(preset)}
          onReset={() => void withLoading(() => resetSimulation())}
        />
      </div>
          <div className="sidebarStatus">
            <div className="footerLine">
              <span>System Status</span>
              <strong>{state?.status ?? "Waiting for backend"}</strong>
            </div>
            {error ? <p className="error">Backend: {error}</p> : null}
          </div>
        </aside>

        <section className="displayStage" ref={tacticalStageRef}>
          <header className="stageHeader">
            <div className="appBrandBadge">
              <img className="brandBadgeMark" src={BRAND_LOGO_PATH} alt="" aria-hidden="true" />
              <div className="stageBrandText">
                <strong>Air Defense</strong>
              </div>
            </div>
            <div className="stageActions">
              <div className="environmentHeaderToggle">
                <button
                  className={`ghost environmentHeaderButton ${environmentMode === "day" ? "activeEnvironmentHeaderButton" : ""}`}
                  onClick={() => setEnvironmentMode("day")}
                >
                  Day
                </button>
                <button
                  className={`ghost environmentHeaderButton ${environmentMode === "night" ? "activeEnvironmentHeaderButton" : ""}`}
                  onClick={() => setEnvironmentMode("night")}
                >
                  Night
                </button>
              </div>
              <div className="statusBadge">{state?.phase ?? "idle"}</div>
              <button className="ghost stageButton" onClick={() => void toggleFullscreen()}>
                {isFullscreen ? "Exit Full Screen" : "Full Screen"}
              </button>
            </div>
          </header>

          <div className="stageCanvasWrap">
            <SimulationCanvas
              state={state}
              zoom={zoom}
              panX={panX}
              environmentMode={environmentMode}
              isFullscreen={isFullscreen}
              onPanGesture={handlePanGesture}
            />
          </div>

          <div className="resultsOverlay">
            <ResultsPanel state={state} />
          </div>

          {isFullscreen ? (
            <div className="fullscreenActionDock">
              <button
                className="ghost fullscreenActionToggle"
                onClick={() => setIsFullscreenActionMenuOpen((value) => !value)}
              >
                {isFullscreenActionMenuOpen ? "Hide Controls" : "Show Controls"}
              </button>
              {isFullscreenActionMenuOpen ? (
                <div className="fullscreenActionPanel">
                  <div className="fullscreenControlCard">
                    <div className="fullscreenControlSection fullscreenThreatCard">
                      <div className="fullscreenSectionHeader">
                        <span className="fullscreenSectionTitle">Threat Profile</span>
                        <button
                          className="ghost fullscreenExpandButton"
                          aria-label={isFullscreenThreatProfileExpanded ? "Collapse threat profile" : "Expand threat profile"}
                          onClick={() =>
                            setIsFullscreenThreatProfileExpanded((value) => !value)
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            className={`fullscreenExpandIcon ${isFullscreenThreatProfileExpanded ? "expanded" : ""}`}
                          >
                            <path d="M8 10.2 12 14l4-3.8 1.4 1.4L12 17 6.6 11.6 8 10.2Z" fill="currentColor" />
                          </svg>
                        </button>
                      </div>
                      <div className="fullscreenThreatSummary">
                        <span>{speed.toFixed(0)} km/s</span>
                        <span>{angleDeg.toFixed(0)} deg</span>
                        <span>{threatCount} threats</span>
                      </div>
                      {isFullscreenThreatProfileExpanded ? (
                        <>
                          <label className="fullscreenRangeField">
                            <span>Threat speed</span>
                            <input
                              type="range"
                              min="45"
                              max="80"
                              step="1"
                              value={speed}
                              onChange={(event) => setSpeed(Number(event.target.value))}
                            />
                            <strong>{speed.toFixed(0)} km/s</strong>
                          </label>
                          <label className="fullscreenRangeField">
                            <span>Launch angle</span>
                            <input
                              type="range"
                              min="20"
                              max="70"
                              step="1"
                              value={angleDeg}
                              onChange={(event) => setAngleDeg(Number(event.target.value))}
                            />
                            <strong>{angleDeg.toFixed(0)} deg</strong>
                          </label>
                          <label className="fullscreenRangeField">
                            <span>Threat count</span>
                            <input
                              className="countInput fullscreenCountInput"
                              type="number"
                              min="1"
                              max="12"
                              step="1"
                              value={threatCount}
                              onChange={(event) =>
                                setThreatCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))
                              }
                            />
                            <strong>{threatCount} threats</strong>
                          </label>
                        </>
                      ) : null}
                    </div>

                    <div className="fullscreenControlSection">
                      <span className="fullscreenSectionTitle">Mission Actions</span>
                      <div className="fullscreenPrimaryActions">
                        <button
                          className="fullscreenLaunchButton"
                          disabled={loading}
                          onClick={() => void withLoading(() => launchThreat(speed, angleDeg))}
                        >
                          Launch Threat
                        </button>
                        <button
                          className="ghost"
                          disabled={loading}
                          onClick={() => void withLoading(() => strikeAllTargets())}
                        >
                          Strike Both Targets
                        </button>
                        <button
                          className="ghost"
                          disabled={loading}
                          onClick={() => void launchMultipleThreats()}
                        >
                          Auto Launch {threatCount}
                        </button>
                      </div>
                      <button
                        className="fullscreenResetButton"
                        disabled={loading}
                        onClick={() => void withLoading(() => resetSimulation())}
                      >
                        Reset Simulation
                      </button>
                    </div>

                    <div className="fullscreenPresetCard">
                      <span className="fullscreenSectionTitle">Scenario Presets</span>
                      <div className="fullscreenPresetGrid">
                        <button className="ghost" disabled={loading} onClick={() => void launchPreset("single_arc")}>
                          Single Arc
                        </button>
                        <button className="ghost" disabled={loading} onClick={() => void launchPreset("saturation")}>
                          Saturation
                        </button>
                        <button className="ghost" disabled={loading} onClick={() => void launchPreset("mixed_wave")}>
                          Mixed Wave
                        </button>
                        <button className="ghost" disabled={loading} onClick={() => void launchPreset("dual_axis")}>
                          Dual Axis
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
