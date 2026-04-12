import { Suspense, useState } from "react";
import type { SimulationState } from "../types";
import ThreeTacticalScene from "../sim/ThreeTacticalScene";

type Props = {
  state: SimulationState | null;
  zoom: number;
  panX: number;
  environmentMode: "day" | "night";
  isFullscreen: boolean;
  onPanGesture: (delta: number) => void;
};

type CameraPreset = "tower" | "tactical" | "follow" | "free";

export default function SimulationCanvas({
  state,
  zoom,
  panX,
  environmentMode,
  isFullscreen,
  onPanGesture,
}: Props) {
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("tower");
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);

  return (
    <div
      className="sceneHost"
      onWheel={(event) => {
        const horizontalDelta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
        const shiftedVerticalDelta = event.shiftKey ? event.deltaY : 0;
        const delta = horizontalDelta || shiftedVerticalDelta;
        if (!delta) {
          return;
        }
        event.preventDefault();
        onPanGesture(delta);
      }}
    >
      {isFullscreen ? (
        <div className="cameraControls fullscreenCameraControls">
          <button
            className="ghost cameraIconButton"
            aria-label="Camera controls"
            onClick={() => setIsCameraMenuOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="cameraIconSvg">
              <path
                d="M8 6.5 9.2 5h5.6L16 6.5h2.6A2.4 2.4 0 0 1 21 8.9v7.2a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 16.1V8.9a2.4 2.4 0 0 1 2.4-2.4H8Zm4 2.4a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2Zm0 1.8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z"
                fill="currentColor"
              />
            </svg>
          </button>
          {isCameraMenuOpen ? (
            <div className="cameraMenuCard">
              <button
                className={`ghost cameraPresetButton ${cameraPreset === "tower" ? "activeCameraPreset" : ""}`}
                onClick={() => {
                  setCameraPreset("tower");
                  setIsCameraMenuOpen(false);
                }}
              >
                Tower View
              </button>
              <button
                className={`ghost cameraPresetButton ${cameraPreset === "tactical" ? "activeCameraPreset" : ""}`}
                onClick={() => {
                  setCameraPreset("tactical");
                  setIsCameraMenuOpen(false);
                }}
              >
                Tactical
              </button>
              <button
                className={`ghost cameraPresetButton ${cameraPreset === "follow" ? "activeCameraPreset" : ""}`}
                onClick={() => {
                  setCameraPreset("follow");
                  setIsCameraMenuOpen(false);
                }}
              >
                Follow
              </button>
              <button
                className="ghost cameraPresetButton cameraResetButton"
                onClick={() => {
                  setCameraPreset("free");
                  setIsCameraMenuOpen(false);
                }}
              >
                Reset View
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="cameraControls">
          <button
            className={`ghost cameraPresetButton ${cameraPreset === "tower" ? "activeCameraPreset" : ""}`}
            onClick={() => setCameraPreset("tower")}
          >
            Tower View
          </button>
          <button
            className={`ghost cameraPresetButton ${cameraPreset === "tactical" ? "activeCameraPreset" : ""}`}
            onClick={() => setCameraPreset("tactical")}
          >
            Tactical
          </button>
          <button
            className={`ghost cameraPresetButton ${cameraPreset === "follow" ? "activeCameraPreset" : ""}`}
            onClick={() => setCameraPreset("follow")}
          >
            Follow
          </button>
          <button
            className="ghost cameraPresetButton cameraResetButton"
            onClick={() => setCameraPreset("free")}
          >
            Reset View
          </button>
        </div>
      )}
      <Suspense fallback={<div className="sceneOverlay">Loading 3D scene...</div>}>
        <ThreeTacticalScene
          state={state}
          zoom={zoom}
          panX={panX}
          environmentMode={environmentMode}
          cameraPreset={cameraPreset}
        />
      </Suspense>
    </div>
  );
}
