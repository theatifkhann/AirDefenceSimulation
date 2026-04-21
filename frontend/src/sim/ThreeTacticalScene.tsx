import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Clone, Line, OrbitControls, PerspectiveCamera, Sky, Stars } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  Box3,
  Color,
  Group,
  MathUtils,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BodyState, SimulationState, Vector2 } from "../types";

type Props = {
  state: SimulationState | null;
  zoom: number;
  panX: number;
  environmentMode: "day" | "night";
  cameraPreset: "tower" | "tactical" | "follow" | "free";
};

type WorldPoint = {
  x: number;
  y: number;
  z: number;
};

type ExplosionRecord = {
  key: string;
  point: Vector2;
  laneZ: number;
  color: string;
  startedAt: number;
};
let sharedCollisionBlastAudioContext: AudioContext | null = null;
let sharedCollisionBlastBuffer: AudioBuffer | null = null;
let sharedCollisionBlastAudioPromise: Promise<AudioBuffer | null> | null = null;
let sharedMissileLaunchBuffer: AudioBuffer | null = null;
let sharedMissileLaunchAudioPromise: Promise<AudioBuffer | null> | null = null;
let sharedHypersonicMissileLaunchBuffer: AudioBuffer | null = null;
let sharedHypersonicMissileLaunchAudioPromise: Promise<AudioBuffer | null> | null = null;
let hypersonicMissileLaunchAudioUnavailable = false;
let sharedAudioUnlockBound = false;
const activeMissileLaunchSources = new Set<{
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  nominalGain: number;
}>();
const COLLISION_BLAST_AUDIO_PATH = "/audio/collision-blast.m4a";
const COLLISION_BLAST_AUDIO_OFFSET_SECONDS = 0.12;
const MISSILE_LAUNCH_AUDIO_PATH = "/audio/missile-launch.m4a";
const HYPERSONIC_MISSILE_LAUNCH_AUDIO_PATH = "/audio/hypersonic-missile-launch.webm";
const MISSILE_LAUNCH_DUCK_SECONDS = 0.16;
const COLLISION_BLAST_COOLDOWN_MS = 180;
const MAX_DEFERRED_AUDIO_LATENCY_MS = 140;
let lastCollisionBlastStartedAtMs = -Infinity;
let launchAudioEpoch = 0;
type EnvironmentMode = "day" | "night";
const MAX_CLIENT_MOTION_LOOKAHEAD_SECONDS = 0.85;

function predictedSnapshotAgeSeconds(snapshotReceivedAtMs: number | null) {
  if (snapshotReceivedAtMs == null) {
    return 0;
  }

  return Math.min(
    MAX_CLIENT_MOTION_LOOKAHEAD_SECONDS,
    Math.max(0, (performance.now() - snapshotReceivedAtMs) / 1000),
  );
}

function extrapolatePoint(
  point: Vector2,
  velocity: Vector2 | null,
  secondsAhead: number,
): Vector2 {
  if (!velocity || secondsAhead <= 0) {
    return point;
  }

  return {
    x: point.x + velocity.x * secondsAhead,
    y: Math.max(0, point.y + velocity.y * secondsAhead),
  };
}

const ENVIRONMENT_PRESETS = {
  day: {
    background: "#8ea3b8",
    fog: "#aab8c4",
    fogNear: 230,
    fogFar: 860,
    ambientIntensity: 0.38,
    hemisphereSky: "#dbeeff",
    hemisphereGround: "#223142",
    hemisphereIntensity: 1.04,
    sunColor: "#fff1c9",
    sunIntensity: 1.9,
    sunPosition: [220, 240, -140] as [number, number, number],
    fillColor: "#7db8e4",
    fillIntensity: 0.26,
    fillPosition: [-180, 120, 210] as [number, number, number],
    skySunPosition: [210, 84, -150] as [number, number, number],
    turbidity: 6.8,
    rayleigh: 1.45,
    mieCoefficient: 0.01,
    mieDirectionalG: 0.8,
    shellColor: "#b9c8d4",
    shellOpacity: 0.045,
    groundColor: "#2f3d49",
    gridMajor: "#587997",
    gridMinor: "#27384a",
    hazeLayers: [
      { y: 5, radius: 270, opacity: 0.04, color: "#dde3e8" },
      { y: 14, radius: 340, opacity: 0.024, color: "#cfd8de" },
      { y: 26, radius: 410, opacity: 0.012, color: "#b8c6d1" },
    ],
    hazeRingColor: "#dde3e7",
    hazeRingOpacity: 0.016,
    showStars: false,
  },
  night: {
    background: "#030915",
    fog: "#0b1625",
    fogNear: 70,
    fogFar: 20,
    ambientIntensity: 0.1,
    hemisphereSky: "#324862",
    hemisphereGround: "#06101a",
    hemisphereIntensity: 0.42,
    sunColor: "#d9e5f4",
    sunIntensity: 0.74,
    sunPosition: [210, 240, -250] as [number, number, number],
    fillColor: "#8eb6da",
    fillIntensity: 0.08,
    fillPosition: [-180, 102, 230] as [number, number, number],
    skySunPosition: [180, 12, -220] as [number, number, number],
    turbidity: 1.7,
    rayleigh: 0.08,
    mieCoefficient: 0.0025,
    mieDirectionalG: 0.62,
    shellColor: "#08111d",
    shellOpacity: 0.48,
    groundColor: "#0d1724",
    gridMajor: "#23405a",
    gridMinor: "#0f1f31",
    hazeLayers: [
      { y: 4, radius: 240, opacity: 0.022, color: "#162536" },
      { y: 11, radius: 320, opacity: 0.013, color: "#122030" },
      { y: 20, radius: 390, opacity: 0.007, color: "#0d1826" },
    ],
    hazeRingColor: "#21374d",
    hazeRingOpacity: 0.012,
    showStars: true,
  },
} satisfies Record<EnvironmentMode, {
  background: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  ambientIntensity: number;
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunPosition: [number, number, number];
  fillColor: string;
  fillIntensity: number;
  fillPosition: [number, number, number];
  skySunPosition: [number, number, number];
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  shellColor: string;
  shellOpacity: number;
  groundColor: string;
  gridMajor: string;
  gridMinor: string;
  hazeLayers: Array<{ y: number; radius: number; opacity: number; color: string }>;
  hazeRingColor: string;
  hazeRingOpacity: number;
  showStars: boolean;
}>;

function getSharedAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor = window.AudioContext || (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;

  if (!AudioContextCtor) {
    return null;
  }

  if (!sharedCollisionBlastAudioContext) {
    sharedCollisionBlastAudioContext = new AudioContextCtor();
    sharedCollisionBlastAudioContext.onstatechange = () => {
      if (
        sharedCollisionBlastAudioContext &&
        sharedCollisionBlastAudioContext.state !== "running" &&
        sharedCollisionBlastAudioContext.state !== "closed"
      ) {
        bindSharedAudioUnlock();
      }
    };
  }

  return sharedCollisionBlastAudioContext;
}

function ensureSharedAudioRunning() {
  const context = getSharedAudioContext();
  if (!context || context.state === "running" || context.state === "closed") {
    return context;
  }

  void context.resume().catch(() => {});
  return context;
}

function bindSharedAudioUnlock() {
  if (typeof window === "undefined" || sharedAudioUnlockBound) {
    return;
  }

  sharedAudioUnlockBound = true;
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      unlock();
    }
  };
  const unlock = () => {
    ensureSharedAudioRunning();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("focus", unlock);
    window.removeEventListener("pageshow", unlock);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    sharedAudioUnlockBound = false;
  };

  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("touchstart", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("focus", unlock, { once: true });
  window.addEventListener("pageshow", unlock, { once: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function warmCollisionBlastAudio() {
  const context = getSharedAudioContext();
  if (!context) {
    return;
  }

  bindSharedAudioUnlock();

  if (sharedCollisionBlastBuffer) {
    return;
  }

  if (sharedCollisionBlastAudioPromise) {
    return;
  }

  sharedCollisionBlastAudioPromise = fetch(COLLISION_BLAST_AUDIO_PATH)
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((audioBuffer) => {
      sharedCollisionBlastBuffer = audioBuffer;
      sharedCollisionBlastAudioPromise = null;
      return audioBuffer;
    })
    .catch(() => {
      sharedCollisionBlastAudioPromise = null;
      return null;
    });
}

function warmMissileLaunchAudio() {
  const context = getSharedAudioContext();
  if (!context) {
    return;
  }

  bindSharedAudioUnlock();

  if (sharedMissileLaunchBuffer) {
    return;
  }

  if (sharedMissileLaunchAudioPromise) {
    return;
  }

  sharedMissileLaunchAudioPromise = fetch(MISSILE_LAUNCH_AUDIO_PATH)
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((audioBuffer) => {
      sharedMissileLaunchBuffer = audioBuffer;
      sharedMissileLaunchAudioPromise = null;
      return audioBuffer;
    })
    .catch(() => {
      sharedMissileLaunchAudioPromise = null;
      return null;
    });
}

function warmHypersonicMissileLaunchAudio() {
  const context = getSharedAudioContext();
  if (!context || hypersonicMissileLaunchAudioUnavailable) {
    return;
  }

  bindSharedAudioUnlock();

  if (sharedHypersonicMissileLaunchBuffer) {
    return;
  }

  if (sharedHypersonicMissileLaunchAudioPromise) {
    return;
  }

  sharedHypersonicMissileLaunchAudioPromise = fetch(HYPERSONIC_MISSILE_LAUNCH_AUDIO_PATH)
    .then((response) => response.arrayBuffer())
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((audioBuffer) => {
      sharedHypersonicMissileLaunchBuffer = audioBuffer;
      sharedHypersonicMissileLaunchAudioPromise = null;
      return audioBuffer;
    })
    .catch(() => {
      sharedHypersonicMissileLaunchAudioPromise = null;
      hypersonicMissileLaunchAudioUnavailable = true;
      return null;
    });
}

function stopActiveMissileLaunchSounds() {
  launchAudioEpoch += 1;
  activeMissileLaunchSources.forEach(({ source, gainNode }) => {
    try {
      gainNode.gain.cancelScheduledValues(0);
      gainNode.gain.value = 0.0001;
      source.stop();
    } catch {
      // Audio source may already be stopped; this is best-effort cleanup.
    }
  });
  activeMissileLaunchSources.clear();
}

function playCollisionBlastSoundNow(context: AudioContext, buffer: AudioBuffer) {
  const blastStartedAtMs = performance.now();
  if (blastStartedAtMs - lastCollisionBlastStartedAtMs < COLLISION_BLAST_COOLDOWN_MS) {
    return;
  }
  lastCollisionBlastStartedAtMs = blastStartedAtMs;
  launchAudioEpoch += 1;
  const duckAt = context.currentTime;
  activeMissileLaunchSources.forEach(({ source, gainNode, nominalGain }) => {
    gainNode.gain.cancelScheduledValues(duckAt);
    gainNode.gain.setValueAtTime(gainNode.gain.value, duckAt);
    gainNode.gain.linearRampToValueAtTime(
      Math.max(0.04, nominalGain * 0.18),
      duckAt + MISSILE_LAUNCH_DUCK_SECONDS * 0.25,
    );
    gainNode.gain.linearRampToValueAtTime(0.0001, duckAt + MISSILE_LAUNCH_DUCK_SECONDS);
    try {
      source.stop(duckAt + MISSILE_LAUNCH_DUCK_SECONDS + 0.02);
    } catch {
      // Source may already be ending; stopping is best-effort only.
    }
  });

  const source = context.createBufferSource();
  const gainNode = context.createGain();
  gainNode.gain.value = 0.9;
  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(context.destination);
  source.start(
    0,
    Math.min(
      COLLISION_BLAST_AUDIO_OFFSET_SECONDS,
      Math.max(0, buffer.duration - 0.05),
    ),
  );
}

function playCollisionBlastSound() {
  warmCollisionBlastAudio();
  const context = ensureSharedAudioRunning();
  if (!context) {
    return;
  }

  if (sharedCollisionBlastBuffer) {
    playCollisionBlastSoundNow(context, sharedCollisionBlastBuffer);
    return;
  }

  if (sharedCollisionBlastAudioPromise) {
    const requestedAtMs = performance.now();
    void sharedCollisionBlastAudioPromise.then((buffer) => {
      const readyContext = ensureSharedAudioRunning();
      if (
        !readyContext ||
        !buffer ||
        performance.now() - requestedAtMs > MAX_DEFERRED_AUDIO_LATENCY_MS
      ) {
        return;
      }
      playCollisionBlastSoundNow(readyContext, buffer);
    });
  }
}

function playMissileLaunchSoundNow(
  context: AudioContext,
  buffer: AudioBuffer,
  kind: "threat" | "interceptor",
  isHypersonic: boolean,
) {
  const source = context.createBufferSource();
  const gainNode = context.createGain();
  const nominalGain = isHypersonic ? 0.78 : kind === "interceptor" ? 0.52 : 0.68;
  gainNode.gain.value = nominalGain;
  source.buffer = buffer;
  source.playbackRate.value =
    isHypersonic
      ? MathUtils.randFloat(0.92, 0.98)
      : kind === "interceptor"
        ? MathUtils.randFloat(1.02, 1.11)
        : MathUtils.randFloat(0.96, 1.04);
  source.connect(gainNode);
  gainNode.connect(context.destination);
  const activeLaunchSource = { source, gainNode, nominalGain };
  activeMissileLaunchSources.add(activeLaunchSource);
  source.onended = () => {
    activeMissileLaunchSources.delete(activeLaunchSource);
  };
  source.start(0);
}

function playMissileLaunchSound({
  kind,
  isHypersonic = false,
}: {
  kind: "threat" | "interceptor";
  isHypersonic?: boolean;
}) {
  warmMissileLaunchAudio();
  if (isHypersonic) {
    warmHypersonicMissileLaunchAudio();
  }
  const context = ensureSharedAudioRunning();
  const selectedBuffer =
    isHypersonic && sharedHypersonicMissileLaunchBuffer
      ? sharedHypersonicMissileLaunchBuffer
      : sharedMissileLaunchBuffer;
  if (!context) {
    return;
  }

  if (selectedBuffer) {
    playMissileLaunchSoundNow(context, selectedBuffer, kind, isHypersonic);
    return;
  }

  const requestedEpoch = launchAudioEpoch;
  const pendingPromise =
    isHypersonic && !hypersonicMissileLaunchAudioUnavailable
      ? sharedHypersonicMissileLaunchAudioPromise ?? sharedMissileLaunchAudioPromise
      : sharedMissileLaunchAudioPromise;

  if (pendingPromise) {
    const requestedAtMs = performance.now();
    void pendingPromise.then(() => {
      const readyContext = ensureSharedAudioRunning();
      const readyBuffer =
        isHypersonic && sharedHypersonicMissileLaunchBuffer
          ? sharedHypersonicMissileLaunchBuffer
          : sharedMissileLaunchBuffer;
      if (
        !readyContext ||
        !readyBuffer ||
        requestedEpoch !== launchAudioEpoch ||
        performance.now() - requestedAtMs > MAX_DEFERRED_AUDIO_LATENCY_MS
      ) {
        return;
      }
      playMissileLaunchSoundNow(readyContext, readyBuffer, kind, isHypersonic);
    });
  }
}

function toWorld(point: Vector2, laneZ = 0): WorldPoint {
  return {
    x: point.x,
    y: Math.max(0, point.y),
    z: laneZ,
  };
}

function threatLane(threatId: number | null | undefined, fallbackIndex = 0) {
  const index = threatId ? Math.max(0, threatId - 1) : fallbackIndex;
  return -8 - index * 2.2;
}

function targetLane(targetId: number | null | undefined, fallbackIndex = 0) {
  const index = targetId ? Math.max(0, targetId - 1) : fallbackIndex;
  return 14 + index * 8;
}

function targetLaneAtTime(
  targetId: number | null | undefined,
  time: number,
  fallbackIndex = 0,
) {
  const baseLane = targetLane(targetId, fallbackIndex);
  if (targetId === 1) {
    return baseLane + Math.sin(time * 0.42) * 6;
  }
  return baseLane;
}

function threatVisualLane(threat: BodyState | undefined, fallbackIndex = 0) {
  return threatLane(threat?.id, fallbackIndex);
}

function GroundPlane({ environmentMode }: { environmentMode: EnvironmentMode }) {
  const environment = ENVIRONMENT_PRESETS[environmentMode];
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.25, 0]}>
      <planeGeometry args={[900, 900, 36, 36]} />
      <meshStandardMaterial
        color={environment.groundColor}
        roughness={0.97}
        metalness={0.03}
      />
    </mesh>
  );
}

function RadarRing({
  center,
  radius,
  environmentMode,
}: {
  center: Vector2;
  radius: number;
  environmentMode: EnvironmentMode;
}) {
  const world = toWorld(center);
  const isNight = environmentMode === "night";

  return (
    <group position={[world.x, 0.1, world.z]}>
      {isNight ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius - 2.5, radius + 1.5, 96]} />
          <meshBasicMaterial color="#63d5ff" transparent opacity={0.14} side={2} />
        </mesh>
      ) : null}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 1.6, radius, 96]} />
        <meshBasicMaterial
          color={isNight ? "#7ce0ff" : "#5cc8ff"}
          transparent
          opacity={isNight ? 0.38 : 0.24}
          side={2}
        />
      </mesh>
    </group>
  );
}

function GridLayer({ environmentMode }: { environmentMode: EnvironmentMode }) {
  const environment = ENVIRONMENT_PRESETS[environmentMode];
  return (
    <gridHelper
      args={[900, 45, environment.gridMajor, environment.gridMinor]}
      position={[0, 0.02, 0]}
    />
  );
}

function MoonFallback() {
  return (
    <group position={[250, 190, -320]}>
      <mesh>
        <sphereGeometry args={[22, 28, 28]} />
        <meshBasicMaterial color="#e6eaef" />
      </mesh>
    </group>
  );
}

function MoonModel() {
  const gltf = useLoader(GLTFLoader, "/models/the_moon.glb");
  const asset = gltf.scene as Group;

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    return {
      offset: new Vector3(-center.x, -center.y, -center.z),
      scale: 42 / Math.max(size.x, size.y, size.z, 1),
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
        material?:
          | {
              clone?: () => unknown;
              emissive?: { copy: (color: Color) => void };
              emissiveIntensity?: number;
              metalness?: number;
              roughness?: number;
            }
          | Array<{
              clone?: () => unknown;
              emissive?: { copy: (color: Color) => void };
              emissiveIntensity?: number;
              metalness?: number;
              roughness?: number;
            }>;
      };

      if (!mesh.isMesh || !mesh.material) {
        return;
      }

      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const tunedMaterials = materials.map((material) => {
        const nextMaterial =
          typeof material.clone === "function"
            ? (material.clone() as typeof material)
            : material;

        nextMaterial.emissive?.copy(new Color("#7c8794"));
        nextMaterial.emissiveIntensity = 0.18;
        if (typeof nextMaterial.metalness === "number") {
          nextMaterial.metalness = 0;
        }
        if (typeof nextMaterial.roughness === "number") {
          nextMaterial.roughness = 1;
        }
        return nextMaterial;
      });

      mesh.material = Array.isArray(mesh.material) ? tunedMaterials : tunedMaterials[0];
    });
  }, [asset]);

  return (
    <group position={[250, 190, -320]} rotation={[0, Math.PI * 0.16, 0]}>
      <group scale={assetTransform.scale}>
        <group position={assetTransform.offset}>
          <Clone object={asset} />
        </group>
      </group>
    </group>
  );
}

class MoonBoundary extends Component<{}, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <MoonFallback />;
    }

    return (
      <Suspense fallback={<MoonFallback />}>
        <MoonModel />
      </Suspense>
    );
  }
}

function EnvironmentBackdrop({ environmentMode }: { environmentMode: EnvironmentMode }) {
  const environment = ENVIRONMENT_PRESETS[environmentMode];
  const isNight = environmentMode === "night";
  return (
    <>
      <Sky
        distance={380000}
        sunPosition={environment.skySunPosition}
        turbidity={environment.turbidity}
        rayleigh={environment.rayleigh}
        mieCoefficient={environment.mieCoefficient}
        mieDirectionalG={environment.mieDirectionalG}
      />
      {environment.showStars ? (
        <Stars
          radius={360}
          depth={160}
          count={isNight ? 2400 : 1200}
          factor={isNight ? 4.2 : 3}
          saturation={0}
          fade
        />
      ) : null}
      {isNight ? (
        <MoonBoundary />
      ) : null}
      <mesh position={[60, 115, 0]}>
        <sphereGeometry args={[430, 32, 24]} />
        <meshBasicMaterial
          color={environment.shellColor}
          transparent
          opacity={environment.shellOpacity}
          side={BackSide}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function AtmosphereHaze({ environmentMode }: { environmentMode: EnvironmentMode }) {
  const environment = ENVIRONMENT_PRESETS[environmentMode];
  return (
    <group>
      {environment.hazeLayers.map((layer) => (
        <mesh
          key={`${layer.y}-${layer.radius}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[70, layer.y, 6]}
        >
          <circleGeometry args={[layer.radius, 64]} />
          <meshBasicMaterial
            color={layer.color}
            transparent
            opacity={layer.opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[110, 1.2, 8]}>
        <ringGeometry args={[120, 320, 72]} />
        <meshBasicMaterial
          color={environment.hazeRingColor}
          transparent
          opacity={environment.hazeRingOpacity}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function TerrainFallback({ environmentMode }: { environmentMode: EnvironmentMode }) {
  return (
    <>
      <GroundPlane environmentMode={environmentMode} />
      <GridLayer environmentMode={environmentMode} />
    </>
  );
}

function TerrainModel({ environmentMode }: { environmentMode: EnvironmentMode }) {
  const gltf = useLoader(GLTFLoader, "/models/saudi_arabia__neom_city_terrain_tile_n26e36-2.glb");
  const asset = gltf.scene as Group;

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const horizontalSpan = Math.max(size.x, size.z, 1);

    return {
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
      scale: 1100 / horizontalSpan,
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [asset]);

  return (
    <group position={[0, -2.8, 0]}>
      <group scale={assetTransform.scale}>
        <group position={assetTransform.offset}>
          <Clone object={asset} />
        </group>
      </group>
    </group>
  );
}

class TerrainBoundary extends Component<
  { environmentMode: EnvironmentMode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(
    prevProps: Readonly<{ environmentMode: EnvironmentMode }>,
  ) {
    if (
      this.state.hasError &&
      prevProps.environmentMode !== this.props.environmentMode
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    const fallbackTerrain = <TerrainFallback environmentMode={this.props.environmentMode} />;

    if (this.state.hasError) {
      return fallbackTerrain;
    }

    return (
      <Suspense fallback={fallbackTerrain}>
        <TerrainModel environmentMode={this.props.environmentMode} />
      </Suspense>
    );
  }
}

function RadarTruckFallback({
  point,
  environmentMode,
}: {
  point: Vector2;
  environmentMode: EnvironmentMode;
}) {
  const world = toWorld(point);
  const isNight = environmentMode === "night";

  return (
    <group position={[world.x, 0, world.z]}>
      <mesh receiveShadow position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 28]} />
        <meshStandardMaterial
          color={isNight ? "#24465b" : "#3f5c70"}
          emissive={isNight ? "#214d67" : "#000000"}
          emissiveIntensity={isNight ? 0.2 : 0}
          roughness={0.92}
          metalness={0.06}
        />
      </mesh>
      <mesh castShadow position={[0, 2.2, 0]}>
        <boxGeometry args={[10, 3.2, 4.8]} />
        <meshStandardMaterial color="#556a4f" roughness={0.72} metalness={0.12} />
      </mesh>
      <mesh castShadow position={[1.2, 5.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.22, 0.22, 5.4, 12]} />
        <meshStandardMaterial color="#8391a0" roughness={0.44} metalness={0.22} />
      </mesh>
      <mesh castShadow position={[2.8, 7.2, 0]}>
        <boxGeometry args={[4.6, 2.4, 0.24]} />
        <meshStandardMaterial color="#b4cad8" roughness={0.42} metalness={0.18} />
      </mesh>
    </group>
  );
}

function RadarTruckModel({
  point,
  environmentMode,
}: {
  point: Vector2;
  environmentMode: EnvironmentMode;
}) {
  const gltf = useLoader(GLTFLoader, "/models/renault_trm_radar_truck-2.glb");
  const asset = gltf.scene as Group;
  const world = toWorld(point);
  const isNight = environmentMode === "night";

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    return {
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
      scale: 28 / Math.max(size.x, size.y, size.z, 1),
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [asset]);

  return (
    <group position={[world.x, 0, world.z]} rotation={[0, Math.PI / 2, 0]}>
      <mesh receiveShadow position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[10.2, 30]} />
        <meshStandardMaterial
          color={isNight ? "#21485c" : "#425f73"}
          emissive={isNight ? "#1f5069" : "#000000"}
          emissiveIntensity={isNight ? 0.18 : 0}
          roughness={0.94}
          metalness={0.06}
        />
      </mesh>
      <group scale={assetTransform.scale}>
        <group position={assetTransform.offset}>
          <Clone object={asset} />
        </group>
      </group>
    </group>
  );
}

class RadarTruckBoundary extends Component<
  { point: Vector2; environmentMode: EnvironmentMode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(
    prevProps: Readonly<{ point: Vector2; environmentMode: EnvironmentMode }>,
  ) {
    if (
      this.state.hasError &&
      (prevProps.point.x !== this.props.point.x ||
        prevProps.point.y !== this.props.point.y ||
        prevProps.environmentMode !== this.props.environmentMode)
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    const fallbackMarker = (
      <RadarTruckFallback
        point={this.props.point}
        environmentMode={this.props.environmentMode}
      />
    );

    if (this.state.hasError) {
      return fallbackMarker;
    }

    return (
      <Suspense fallback={fallbackMarker}>
        <RadarTruckModel
          point={this.props.point}
          environmentMode={this.props.environmentMode}
        />
      </Suspense>
    );
  }
}

function LaunchPadMarker({
  point,
  color,
  height,
  environmentMode,
}: {
  point: Vector2;
  color: string;
  height: number;
  environmentMode: EnvironmentMode;
}) {
  const world = toWorld(point);
  const isNight = environmentMode === "night";

  return (
    <mesh castShadow position={[world.x, height / 2, world.z]}>
      <boxGeometry args={[10, height, 10]} />
      <meshStandardMaterial
        color={color}
        emissive={isNight ? color : "#000000"}
        emissiveIntensity={isNight ? 0.18 : 0}
        roughness={0.58}
        metalness={0.18}
      />
    </mesh>
  );
}

function MissileBatteryMarker({
  point,
  yaw,
  padColor,
  environmentMode,
}: {
  point: Vector2;
  yaw: number;
  padColor: string;
  environmentMode: EnvironmentMode;
}) {
  const gltf = useLoader(GLTFLoader, "/models/missile_battery.glb");
  const asset = gltf.scene as Group;
  const world = toWorld(point, 0);
  const isNight = environmentMode === "night";

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const longestSide = Math.max(size.x, size.y, size.z, 1);
    return {
      scale: 20 / longestSide,
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [asset]);

  return (
    <group position={[world.x, 0, world.z]} rotation={[0, yaw, 0]}>
      <mesh receiveShadow position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[8.5, 28]} />
        <meshStandardMaterial
          color={padColor}
          emissive={isNight ? padColor : "#000000"}
          emissiveIntensity={isNight ? 0.22 : 0}
          roughness={0.9}
          metalness={0.08}
        />
      </mesh>
      {isNight ? (
        <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[10.4, 32]} />
          <meshBasicMaterial color={padColor} transparent opacity={0.08} />
        </mesh>
      ) : null}
      <group scale={assetTransform.scale}>
        <group position={assetTransform.offset}>
          <Clone object={asset} />
        </group>
      </group>
    </group>
  );
}

class MissileBatteryBoundary extends Component<
  { point: Vector2; yaw: number; padColor: string; environmentMode: EnvironmentMode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(
    prevProps: Readonly<{
      point: Vector2;
      yaw: number;
      padColor: string;
      environmentMode: EnvironmentMode;
    }>,
  ) {
    if (
      this.state.hasError &&
      (prevProps.point.x !== this.props.point.x ||
        prevProps.point.y !== this.props.point.y ||
        prevProps.yaw !== this.props.yaw ||
        prevProps.padColor !== this.props.padColor ||
        prevProps.environmentMode !== this.props.environmentMode)
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    const fallbackMarker = (
      <LaunchPadMarker
        point={this.props.point}
        color={this.props.padColor}
        height={12}
        environmentMode={this.props.environmentMode}
      />
    );

    if (this.state.hasError) {
      return fallbackMarker;
    }

    return (
      <Suspense fallback={fallbackMarker}>
        <MissileBatteryMarker
          point={this.props.point}
          yaw={this.props.yaw}
          padColor={this.props.padColor}
          environmentMode={this.props.environmentMode}
        />
      </Suspense>
    );
  }
}

function TargetFallbackMarker({
  point,
  velocity,
  laneZ,
  destroyed,
  time,
}: {
  point: Vector2;
  velocity: Vector2;
  laneZ: number;
  destroyed: boolean;
  time: number;
}) {
  const snapshotReceivedAtRef = useRef<number>(performance.now());

  useEffect(() => {
    snapshotReceivedAtRef.current = performance.now();
  }, [point.x, point.y, velocity.x, velocity.y, time]);

  const secondsAhead = destroyed ? 0 : predictedSnapshotAgeSeconds(snapshotReceivedAtRef.current);
  const predictedPoint = destroyed ? point : extrapolatePoint(point, velocity, secondsAhead);
  const world = toWorld(predictedPoint, laneZ);
  const renderTime = time + secondsAhead;
  const hover = destroyed ? 0 : Math.sin(renderTime * 1.6 + predictedPoint.x * 0.03) * 1.3;
  const yaw = velocity.x >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const bank = destroyed ? -0.24 : MathUtils.clamp(-velocity.x * 0.015, -0.16, 0.16);
  const bodyColor = destroyed ? "#5f3530" : "#66755b";
  const canopyColor = destroyed ? "#6d4039" : "#2f474f";
  const metalColor = destroyed ? "#74463e" : "#7d8a74";
  const rotorColor = destroyed ? "#50322d" : "#2a2f34";
  const ordnanceColor = destroyed ? "#5f3a31" : "#505c4f";

  return (
    <group position={[world.x, world.y + hover, world.z]} rotation={[0, yaw, bank]}>
      <mesh castShadow position={[-0.2, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[1.5, 8.8, 10, 22]} />
        <meshStandardMaterial color={bodyColor} roughness={0.62} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[4.7, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[1.2, 4.1, 20]} />
        <meshStandardMaterial color={bodyColor} roughness={0.58} metalness={0.14} />
      </mesh>

      <mesh castShadow position={[2.6, 0.6, 0]}>
        <sphereGeometry args={[1.36, 20, 18]} />
        <meshStandardMaterial
          color={canopyColor}
          roughness={0.24}
          metalness={0.12}
          transparent
          opacity={0.92}
        />
      </mesh>

      <mesh castShadow position={[0.7, 1.55, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 1.9, 12]} />
        <meshStandardMaterial color={metalColor} roughness={0.55} metalness={0.2} />
      </mesh>

      <mesh position={[0.7, 2.55, 0]} rotation={[0, time * 4.6, 0]}>
        <boxGeometry args={[13.6, 0.14, 0.62]} />
        <meshStandardMaterial color={rotorColor} roughness={0.38} metalness={0.2} />
      </mesh>

      <mesh castShadow position={[-6.2, 0.18, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.34, 0.54, 8.2, 14]} />
        <meshStandardMaterial color={bodyColor} roughness={0.66} metalness={0.14} />
      </mesh>

      <mesh castShadow position={[-10.2, 0.66, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[2.8, 2.4, 0.42]} />
        <meshStandardMaterial color={bodyColor} roughness={0.62} metalness={0.14} />
      </mesh>

      <mesh position={[-10.85, 0.65, 0]} rotation={[time * 9.2, 0, 0]}>
        <boxGeometry args={[0.12, 2.4, 0.54]} />
        <meshStandardMaterial color={rotorColor} roughness={0.38} metalness={0.2} />
      </mesh>

      <mesh castShadow position={[-1.0, 0.08, 2.45]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[4.2, 0.2, 1.6]} />
        <meshStandardMaterial color={metalColor} roughness={0.58} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[-1.0, 0.08, -2.45]} rotation={[0, 0, 0.08]}>
        <boxGeometry args={[4.2, 0.2, 1.6]} />
        <meshStandardMaterial color={metalColor} roughness={0.58} metalness={0.18} />
      </mesh>

      {[-2.0, -0.6, 0.8].map((x, index) => (
        <mesh
          key={`pod-right-${index}`}
          castShadow
          position={[x, -0.48, 3.08]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.24, 0.24, 1.45, 10]} />
          <meshStandardMaterial color={ordnanceColor} roughness={0.56} metalness={0.16} />
        </mesh>
      ))}

      {[-2.0, -0.6, 0.8].map((x, index) => (
        <mesh
          key={`pod-left-${index}`}
          castShadow
          position={[x, -0.48, -3.08]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.24, 0.24, 1.45, 10]} />
          <meshStandardMaterial color={ordnanceColor} roughness={0.56} metalness={0.16} />
        </mesh>
      ))}

      <mesh castShadow position={[3.95, -0.9, 0]}>
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshStandardMaterial color="#404b43" roughness={0.46} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[-0.2, -1.95, 1.18]} rotation={[0, 0, 0.1]}>
        <cylinderGeometry args={[0.08, 0.08, 5.8, 10]} />
        <meshStandardMaterial color="#bac2b1" roughness={0.48} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[-0.2, -1.95, -1.18]} rotation={[0, 0, -0.1]}>
        <cylinderGeometry args={[0.08, 0.08, 5.8, 10]} />
        <meshStandardMaterial color="#bac2b1" roughness={0.48} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[-3.0, -1.75, 1.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 2.6, 10]} />
        <meshStandardMaterial color="#bac2b1" roughness={0.48} metalness={0.18} />
      </mesh>

      <mesh castShadow position={[-3.0, -1.75, -1.18]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 2.6, 10]} />
        <meshStandardMaterial color="#bac2b1" roughness={0.48} metalness={0.18} />
      </mesh>

      {!destroyed ? (
        <mesh position={[4.0, 0.78, 0.72]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#8ce8ff" />
        </mesh>
      ) : null}

      {!destroyed ? (
        <mesh position={[4.0, 0.78, -0.72]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#8ce8ff" />
        </mesh>
      ) : null}
    </group>
  );
}

function ApacheTargetModel({
  point,
  velocity,
  laneZ,
  destroyed,
  time,
}: {
  point: Vector2;
  velocity: Vector2;
  laneZ: number;
  destroyed: boolean;
  time: number;
}) {
  const gltf = useLoader(GLTFLoader, "/models/apache.glb");
  const asset = gltf.scene as Group;
  const groupRef = useRef<Group | null>(null);
  const initializedRef = useRef(false);
  const snapshotReceivedAtRef = useRef<number>(performance.now());

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const longestSide = Math.max(size.x, size.y, size.z, 1);
    return {
      scale: 1200 / longestSide,
      offset: new Vector3(-center.x, -bounds.min.y, -center.z),
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [asset]);

  useEffect(() => {
    snapshotReceivedAtRef.current = performance.now();
  }, [point.x, point.y, velocity.x, velocity.y, laneZ, destroyed, time]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    const secondsAhead = destroyed ? 0 : predictedSnapshotAgeSeconds(snapshotReceivedAtRef.current);
    const predictedPoint = destroyed ? point : extrapolatePoint(point, velocity, secondsAhead);
    const world = toWorld(predictedPoint, laneZ);
    const renderTime = time + secondsAhead;
    const hover = destroyed ? 0 : Math.sin(renderTime * 1.6 + predictedPoint.x * 0.03) * 1.3;
    const yaw = velocity.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
    const bank = destroyed ? -0.24 : MathUtils.clamp(-velocity.x * 0.012, -0.14, 0.14);
    const targetY = world.y + hover;
    if (!initializedRef.current) {
      group.position.set(world.x, targetY, world.z);
      group.rotation.set(0, yaw, bank);
      initializedRef.current = true;
      return;
    }

    group.position.x = MathUtils.damp(group.position.x, world.x, 10, delta);
    group.position.y = MathUtils.damp(group.position.y, targetY, 10, delta);
    group.position.z = MathUtils.damp(group.position.z, world.z, 10, delta);
    group.rotation.y = MathUtils.damp(group.rotation.y, yaw, 11, delta);
    group.rotation.z = MathUtils.damp(group.rotation.z, bank, 11, delta);
  });

  const initialWorld = toWorld(point, laneZ);
  const initialHover = destroyed ? 0 : Math.sin(time * 1.6 + point.x * 0.03) * 1.3;
  const initialYaw = velocity.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
  const initialBank = destroyed ? -0.24 : MathUtils.clamp(-velocity.x * 0.012, -0.14, 0.14);

  return (
    <group
      ref={groupRef}
      position={[initialWorld.x, initialWorld.y + initialHover, initialWorld.z]}
      rotation={[0, initialYaw, initialBank]}
      scale={destroyed ? assetTransform.scale * 0.96 : assetTransform.scale}
    >
      <group position={assetTransform.offset}>
        <Clone object={asset} />
      </group>
    </group>
  );
}

class TargetRenderBoundary extends Component<
  {
    point: Vector2;
    velocity: Vector2;
    laneZ: number;
    destroyed: boolean;
    time: number;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(
    prevProps: Readonly<{
      point: Vector2;
      velocity: Vector2;
      laneZ: number;
      destroyed: boolean;
      time: number;
    }>,
  ) {
    if (
      this.state.hasError &&
      (prevProps.point.x !== this.props.point.x ||
        prevProps.point.y !== this.props.point.y ||
        prevProps.velocity.x !== this.props.velocity.x ||
        prevProps.velocity.y !== this.props.velocity.y ||
        prevProps.laneZ !== this.props.laneZ ||
        prevProps.destroyed !== this.props.destroyed)
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    const { point, velocity, laneZ, destroyed, time } = this.props;
    const fallbackMarker = (
      <TargetFallbackMarker
        point={point}
        velocity={velocity}
        laneZ={laneZ}
        destroyed={destroyed}
        time={time}
      />
    );

    if (this.state.hasError) {
      return fallbackMarker;
    }

    return (
      <Suspense fallback={fallbackMarker}>
        <ApacheTargetModel
          point={point}
          velocity={velocity}
          laneZ={laneZ}
          destroyed={destroyed}
          time={time}
        />
      </Suspense>
    );
  }
}

type ProjectileProps = {
  point: Vector2 | null;
  velocity: Vector2 | null;
  color: string;
  laneZ: number;
  modelVariant?: "phoenix" | "fateh";
  scale?: number;
};

function ProjectileModel({
  point,
  velocity,
  color,
  laneZ,
  modelVariant = "phoenix",
  scale = 1,
}: ProjectileProps) {
  const modelPath =
    modelVariant === "fateh"
      ? "/models/missile_fateh_110.glb"
      : "/models/missile.glb";
  const gltf = useLoader(GLTFLoader, modelPath);
  const asset = gltf.scene as Group;

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const axisLengths = [
      { axis: "x", length: size.x },
      { axis: "y", length: size.y },
      { axis: "z", length: size.z },
    ].sort((left, right) => right.length - left.length);
    const longestAxis = axisLengths[0]?.axis ?? "x";
    let alignmentRotation: [number, number, number] = [0, 0, 0];

    if (longestAxis === "y") {
      alignmentRotation = [0, 0, -Math.PI / 2];
    } else if (longestAxis === "z") {
      alignmentRotation = [0, Math.PI / 2, 0];
    }

    return {
      alignmentRotation,
      offset: new Vector3(-center.x, -center.y, -center.z),
      scale: 14 / Math.max(size.x, size.y, size.z, 1),
    };
  }, [asset]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [asset]);

  const groupRef = useRef<Group | null>(null);
  const initializedRef = useRef(false);
  const snapshotReceivedAtRef = useRef<number>(performance.now());

  useEffect(() => {
    snapshotReceivedAtRef.current = performance.now();
  }, [point?.x, point?.y, velocity?.x, velocity?.y, laneZ]);

  useFrame((_, delta) => {
    if (!point) {
      initializedRef.current = false;
      return;
    }

    const group = groupRef.current;
    if (!group) {
      return;
    }

    const predictedPoint = extrapolatePoint(
      point,
      velocity,
      predictedSnapshotAgeSeconds(snapshotReceivedAtRef.current),
    );
    const world = toWorld(predictedPoint, laneZ);
    const flightAngle = velocity ? Math.atan2(velocity.y, velocity.x) : 0;

    if (!initializedRef.current) {
      group.position.set(world.x, world.y, world.z);
      group.rotation.set(0, 0, flightAngle);
      initializedRef.current = true;
      return;
    }

    group.position.x = MathUtils.damp(group.position.x, world.x, 12, delta);
    group.position.y = MathUtils.damp(group.position.y, world.y, 12, delta);
    group.position.z = MathUtils.damp(group.position.z, world.z, 12, delta);
    group.rotation.z = MathUtils.damp(group.rotation.z, flightAngle, 12, delta);
  });

  if (!point) {
    return null;
  }

  const world = toWorld(point, laneZ);
  const flightAngle = velocity ? Math.atan2(velocity.y, velocity.x) : 0;

  return (
    <group
      ref={groupRef}
      position={[world.x, world.y, world.z]}
      rotation={[0, 0, flightAngle]}
    >
      <group scale={assetTransform.scale * scale}>
        <group rotation={assetTransform.alignmentRotation}>
          <group position={assetTransform.offset}>
            <Clone object={asset} />
          </group>
        </group>
      </group>
      <mesh position={[-6.5 * scale, 0, 0]}>
        <sphereGeometry args={[0.45 * scale, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ProjectileFallback({
  point,
  velocity,
  color,
  laneZ,
  scale = 1,
}: ProjectileProps) {
  const groupRef = useRef<Group | null>(null);
  const initializedRef = useRef(false);
  const snapshotReceivedAtRef = useRef<number>(performance.now());

  useEffect(() => {
    snapshotReceivedAtRef.current = performance.now();
  }, [point?.x, point?.y, velocity?.x, velocity?.y, laneZ]);

  useFrame((_, delta) => {
    if (!point) {
      initializedRef.current = false;
      return;
    }

    const group = groupRef.current;
    if (!group) {
      return;
    }

    const predictedPoint = extrapolatePoint(
      point,
      velocity,
      predictedSnapshotAgeSeconds(snapshotReceivedAtRef.current),
    );
    const world = toWorld(predictedPoint, laneZ);
    const flightAngle = velocity ? Math.atan2(velocity.y, velocity.x) : 0;

    if (!initializedRef.current) {
      group.position.set(world.x, world.y, world.z);
      group.rotation.set(0, 0, flightAngle);
      initializedRef.current = true;
      return;
    }

    group.position.x = MathUtils.damp(group.position.x, world.x, 12, delta);
    group.position.y = MathUtils.damp(group.position.y, world.y, 12, delta);
    group.position.z = MathUtils.damp(group.position.z, world.z, 12, delta);
    group.rotation.z = MathUtils.damp(group.rotation.z, flightAngle, 12, delta);
  });

  if (!point) {
    return null;
  }

  const world = toWorld(point, laneZ);
  const flightAngle = velocity ? Math.atan2(velocity.y, velocity.x) : 0;
  const accentColor = color;

  return (
    <group
      ref={groupRef}
      position={[world.x, world.y, world.z]}
      rotation={[0, 0, flightAngle]}
      scale={scale}
    >
      <mesh castShadow position={[4.1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[1.16, 4.8, 24]} />
        <meshStandardMaterial color="#f1f3f6" roughness={0.28} metalness={0.34} />
      </mesh>

      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.94, 0.94, 10.4, 24]} />
        <meshStandardMaterial color="#f7f8fb" roughness={0.3} metalness={0.32} />
      </mesh>

      <mesh castShadow position={[-6.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.54, 0.74, 3.9, 18]} />
        <meshStandardMaterial color="#dfe5ee" roughness={0.34} metalness={0.28} />
      </mesh>

      <mesh position={[1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.01, 1.01, 0.24, 24]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.12}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>

      <mesh position={[-2.0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.01, 1.01, 0.24, 24]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.12}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>

      <mesh position={[-5.0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.81, 0.81, 0.22, 24]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.1}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>

      {[
        { y: 0, z: 1.85, rotX: 0 },
        { y: 0, z: -1.85, rotX: Math.PI },
        { y: 1.85, z: 0, rotX: Math.PI / 2 },
        { y: -1.85, z: 0, rotX: -Math.PI / 2 },
      ].map((fin, index) => (
        <mesh
          key={index}
          castShadow
          position={[-4.9, fin.y, fin.z]}
          rotation={[fin.rotX, 0, 0]}
        >
          <boxGeometry args={[2.7, 0.08, 1.5]} />
          <meshStandardMaterial color="#d7dde7" roughness={0.38} metalness={0.22} />
        </mesh>
      ))}
    </group>
  );
}

class ProjectileBoundary extends Component<ProjectileProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Readonly<ProjectileProps>) {
    if (
      this.state.hasError &&
      (prevProps.point?.x !== this.props.point?.x ||
        prevProps.point?.y !== this.props.point?.y ||
        prevProps.velocity?.x !== this.props.velocity?.x ||
        prevProps.velocity?.y !== this.props.velocity?.y ||
        prevProps.color !== this.props.color ||
        prevProps.laneZ !== this.props.laneZ ||
        prevProps.scale !== this.props.scale)
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    const fallbackProjectile = <ProjectileFallback {...this.props} />;

    if (this.state.hasError) {
      return fallbackProjectile;
    }

    return <Suspense fallback={fallbackProjectile}><ProjectileModel {...this.props} /></Suspense>;
  }
}

function Trail3D({
  trail,
  color,
  laneZ,
  environmentMode,
}: {
  trail: Vector2[];
  color: string;
  laneZ: number;
  environmentMode: EnvironmentMode;
}) {
  if (trail.length < 4) {
    return null;
  }
  const isNight = environmentMode === "night";

  const points = useMemo(() => {
    const maxPoints = 80;
    const stride = Math.max(1, Math.ceil(trail.length / maxPoints));
    const sampledTrail = trail.filter((_, index) => index % stride === 0);
    const lastPoint = trail[trail.length - 1];

    if (sampledTrail[sampledTrail.length - 1] !== lastPoint) {
      sampledTrail.push(lastPoint);
    }

    return sampledTrail.map((point) => {
      const world = toWorld(point, laneZ);
      return [world.x, world.y, world.z] as [number, number, number];
    });
  }, [laneZ, trail]);

  return (
    <group>
      {isNight ? (
        <Line
          points={points}
          color={color}
          transparent
          opacity={0.16}
          lineWidth={2.4}
        />
      ) : null}
      <Line
        points={points}
        color={color}
        transparent
        opacity={isNight ? 0.52 : 0.35}
        lineWidth={1.2}
      />
    </group>
  );
}

function BlastEffect({
  point,
  laneZ,
  color,
  age,
}: {
  point: Vector2 | null;
  laneZ: number;
  color: string;
  age: number;
}) {
  if (!point) {
    return null;
  }

  const world = toWorld(point, laneZ);
  const progress = Math.min(Math.max(age / 1.1, 0), 1);
  const fade = 1 - progress;
  const coreScale = 0.7 + progress * 1.6;
  const fireballScale = 1 + progress * 3.6;
  const shellScale = 1.1 + progress * 4.8;
  const shockwaveScale = 0.8 + progress * 7.5;
  const sparkTravel = 1 + progress * 2.8;

  const sparks = Array.from({ length: 8 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 8;
    const radius = 2.4 + (index % 3) * 0.9;
    const height = ((index % 2) * 0.8) + 0.4;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * height,
      z: Math.sin(angle) * radius * 0.65,
    };
  });

  return (
    <group position={[world.x, world.y, world.z]}>
      <mesh scale={[coreScale, coreScale, coreScale]}>
        <sphereGeometry args={[1.15, 18, 18]} />
        <meshBasicMaterial
          color="#fff2b0"
          transparent
          opacity={0.95 * fade}
          depthWrite={false}
        />
      </mesh>

      <mesh scale={[fireballScale, fireballScale, fireballScale]}>
        <sphereGeometry args={[1.55, 22, 22]} />
        <meshBasicMaterial
          color="#ff9a47"
          transparent
          opacity={0.42 * fade}
          depthWrite={false}
        />
      </mesh>

      <mesh scale={[shellScale, shellScale, shellScale]}>
        <sphereGeometry args={[1.9, 20, 20]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.22 * fade}
          depthWrite={false}
          wireframe
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -Math.max(world.y, 0) + 0.18, 0]}
        scale={[shockwaveScale, shockwaveScale, shockwaveScale]}
      >
        <ringGeometry args={[1.2, 1.7, 36]} />
        <meshBasicMaterial
          color="#ffcf8c"
          transparent
          opacity={0.3 * fade}
          depthWrite={false}
          side={2}
        />
      </mesh>

      {sparks.map((spark, index) => (
        <mesh
          key={index}
          position={[
            spark.x * sparkTravel,
            spark.y * (1 + progress * 1.1),
            spark.z * sparkTravel,
          ]}
          scale={[
            0.5 + fade * 0.2,
            0.5 + fade * 0.2,
            0.5 + fade * 0.2,
          ]}
        >
          <sphereGeometry args={[0.45, 12, 12]} />
          <meshBasicMaterial
            color="#ffd786"
            transparent
            opacity={0.6 * fade}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function ExplosionLayer({
  state,
  threatLaneFor,
  interceptorLaneFor,
}: {
  state: SimulationState;
  threatLaneFor: (threat: BodyState, fallbackIndex: number) => number;
  interceptorLaneFor: (interceptor: BodyState, fallbackIndex: number) => number;
}) {
  const explosionsRef = useRef<Map<string, ExplosionRecord>>(new Map());
  const seenExplosionsRef = useRef<Set<string>>(new Set());
  const seenThreatLaunchesRef = useRef<Set<string>>(new Set());
  const seenInterceptorLaunchesRef = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef(state.time);
  const now = state.time;
  const lifetime = 1.1;

  useEffect(() => {
    warmCollisionBlastAudio();
    warmMissileLaunchAudio();
    warmHypersonicMissileLaunchAudio();
  }, []);

  useEffect(() => {
    const explosions = explosionsRef.current;
    if (state.phase === "idle" || now < lastTimeRef.current) {
      stopActiveMissileLaunchSounds();
      explosions.clear();
      seenExplosionsRef.current.clear();
      seenThreatLaunchesRef.current.clear();
      seenInterceptorLaunchesRef.current.clear();
    }
    lastTimeRef.current = now;
    const interceptedThreatIds = new Set(
      state.interceptors
        .filter((interceptor) => interceptor.destroyed && interceptor.assigned_target_id != null)
        .map((interceptor) => interceptor.assigned_target_id as number),
    );

    state.threats.forEach((threat, index) => {
      const launchKey = `threat-${threat.id ?? index}`;
      if (
        threat.active &&
        !threat.destroyed &&
        (threat.position != null || threat.trail.length > 0) &&
        !seenThreatLaunchesRef.current.has(launchKey)
      ) {
        const isHypersonicThreat =
          threat.velocity != null &&
          Math.hypot(threat.velocity.x, threat.velocity.y) >=
            state.config.hypersonic_threat_speed_threshold;
        playMissileLaunchSound({ kind: "threat", isHypersonic: isHypersonicThreat });
        seenThreatLaunchesRef.current.add(launchKey);
      }

      if (!threat.destroyed) {
        return;
      }
      if (threat.id != null && interceptedThreatIds.has(threat.id)) {
        return;
      }
      const point = threat.position ?? threat.trail[threat.trail.length - 1];
      if (!point) {
        return;
      }
      const key = `threat-${threat.id ?? index}`;
      if (!explosions.has(key) && !seenExplosionsRef.current.has(key)) {
        explosions.set(key, {
          key,
          point,
          laneZ: threatLaneFor(threat, index),
          color: "#ff9b6e",
          startedAt: now,
        });
        seenExplosionsRef.current.add(key);
      }
    });

    state.interceptors.forEach((interceptor, index) => {
      const launchKey = `interceptor-launch-${interceptor.id ?? index}`;
      if (
        interceptor.active &&
        !interceptor.destroyed &&
        (interceptor.position != null || interceptor.trail.length > 0) &&
        !seenInterceptorLaunchesRef.current.has(launchKey)
      ) {
        playMissileLaunchSound({
          kind: "interceptor",
          isHypersonic: interceptor.interceptor_class === "hypersonic",
        });
        seenInterceptorLaunchesRef.current.add(launchKey);
      }

      if (!interceptor.destroyed) {
        return;
      }
      const point = interceptor.position ?? interceptor.trail[interceptor.trail.length - 1];
      if (!point) {
        return;
      }
      const key = `interceptor-${interceptor.id ?? index}`;
      if (!explosions.has(key) && !seenExplosionsRef.current.has(key)) {
        playCollisionBlastSound();
        explosions.set(key, {
          key,
          point,
          laneZ: interceptorLaneFor(interceptor, index),
          color: "#9fffe3",
          startedAt: now,
        });
        seenExplosionsRef.current.add(key);
      }
    });

    Array.from(explosions.entries()).forEach(([key, explosion]) => {
      if (now - explosion.startedAt > lifetime) {
        explosions.delete(key);
      }
    });
  }, [now, state]);

  return (
    <>
      {Array.from(explosionsRef.current.values()).map((explosion) => (
        <BlastEffect
          key={explosion.key}
          point={explosion.point}
          laneZ={explosion.laneZ}
          color={explosion.color}
          age={now - explosion.startedAt}
        />
      ))}
    </>
  );
}

function PredictedIntercepts({ state }: { state: SimulationState }) {
  return (
    <>
      {state.predicted_intercepts.map((point, index) => {
        const world = toWorld(point, 0);
        return (
          <mesh key={`predict-${index}`} position={[world.x, world.y, world.z]}>
            <octahedronGeometry args={[2.2, 0]} />
            <meshBasicMaterial color="#fff3a1" />
          </mesh>
        );
      })}
    </>
  );
}

function CameraRig({
  state,
  zoom,
  panX,
  cameraPreset,
}: {
  state: SimulationState | null;
  zoom: number;
  panX: number;
  cameraPreset: "tower" | "tactical" | "follow" | "free";
}) {
  const { camera } = useThree();
  const desiredPosition = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());
  const lookAtTarget = useRef(new Vector3());

  const followAnchor = useMemo(() => {
    if (!state) {
      return null;
    }

    const activeInterceptor = state.interceptors.find(
      (interceptor) => interceptor.active && interceptor.position,
    );
    if (activeInterceptor?.position) {
      const assignedThreat = state.threats.find(
        (threat) => threat.id === activeInterceptor.assigned_target_id,
      );
      return toWorld(
        activeInterceptor.position,
        threatVisualLane(assignedThreat, 0),
      );
    }

    const activeThreat = state.threats.find((threat) => threat.active && threat.position);
    if (activeThreat?.position) {
      return toWorld(
        activeThreat.position,
        threatLane(activeThreat.id, 0),
      );
    }

    return null;
  }, [state]);

  useEffect(() => {
    if (cameraPreset === "tactical") {
      desiredPosition.current.set(
        20 + panX * 0.72,
        340 / Math.max(zoom, 0.65),
        0.1,
      );
      desiredTarget.current.set(20 + panX * 0.72, 10, 0);
      return;
    }

    if (cameraPreset === "follow" && followAnchor) {
      desiredPosition.current.set(
        followAnchor.x - 48,
        followAnchor.y + 52,
        followAnchor.z + 86,
      );
      desiredTarget.current.set(followAnchor.x, followAnchor.y, followAnchor.z);
      return;
    }

    desiredPosition.current.set(
      60 + panX * 0.55,
      190 / Math.max(zoom, 0.65),
      220 / Math.max(zoom, 0.7),
    );
    desiredTarget.current.set(25 + panX * 0.7, 35, 0);
  }, [cameraPreset, followAnchor, panX, zoom]);

  useFrame(() => {
    if (cameraPreset === "free") {
      return;
    }
    camera.position.lerp(desiredPosition.current, 0.08);
    lookAtTarget.current.lerp(desiredTarget.current, 0.1);
    camera.lookAt(lookAtTarget.current);
  });

  return null;
}

function TacticalWorld({
  state,
  environmentMode,
}: {
  state: SimulationState;
  environmentMode: EnvironmentMode;
}) {
  const launchSites = state.config.launch_sites?.length
    ? state.config.launch_sites
    : [state.config.target_start];
  const environment = ENVIRONMENT_PRESETS[environmentMode];
  const threatLaneMapRef = useRef<Map<number, number>>(new Map());
  const interceptorLaneMapRef = useRef<Map<number, number>>(new Map());
  const lastTimeRef = useRef(state.time);

  useEffect(() => {
    if (state.phase === "idle" || state.time < lastTimeRef.current) {
      threatLaneMapRef.current.clear();
      interceptorLaneMapRef.current.clear();
    }
    lastTimeRef.current = state.time;
  }, [state.phase, state.time]);

  const threatLaneFor = (threat: BodyState, fallbackIndex: number) => {
    const key = threat.id ?? -(fallbackIndex + 1);
    const cachedLane = threatLaneMapRef.current.get(key);
    if (cachedLane != null) {
      return cachedLane;
    }

    const lane =
      threat.intended_target_id != null
        ? targetLaneAtTime(threat.intended_target_id, state.time, fallbackIndex)
        : threatLane(threat.id, fallbackIndex);
    threatLaneMapRef.current.set(key, lane);
    return lane;
  };

  const interceptorLaneFor = (interceptor: BodyState, fallbackIndex: number) => {
    const key = interceptor.id ?? -(fallbackIndex + 1);
    const cachedLane = interceptorLaneMapRef.current.get(key);
    if (cachedLane != null) {
      return cachedLane;
    }

    const assignedThreatIndex = state.threats.findIndex(
      (threat) => threat.id === interceptor.assigned_target_id,
    );
    const assignedThreat =
      assignedThreatIndex >= 0 ? state.threats[assignedThreatIndex] : undefined;
    const lane = assignedThreat
      ? threatLaneFor(assignedThreat, assignedThreatIndex)
      : threatLane(interceptor.assigned_target_id, fallbackIndex);
    interceptorLaneMapRef.current.set(key, lane);
    return lane;
  };

  return (
    <>
      <color attach="background" args={[environment.background]} />
      <fog attach="fog" args={[environment.fog, environment.fogNear, environment.fogFar]} />
      <EnvironmentBackdrop environmentMode={environmentMode} />
      <ambientLight intensity={environment.ambientIntensity} />
      <hemisphereLight
        args={[
          environment.hemisphereSky,
          environment.hemisphereGround,
          environment.hemisphereIntensity,
        ]}
        position={[0, 180, 0]}
      />
      <directionalLight
        castShadow
        color={environment.sunColor}
        intensity={environment.sunIntensity}
        position={environment.sunPosition}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={40}
        shadow-camera-far={520}
        shadow-camera-left={-260}
        shadow-camera-right={260}
        shadow-camera-top={260}
        shadow-camera-bottom={-260}
        shadow-bias={-0.00022}
      />
      <directionalLight
        color={environment.fillColor}
        intensity={environment.fillIntensity}
        position={environment.fillPosition}
      />

      <AtmosphereHaze environmentMode={environmentMode} />
      <TerrainBoundary environmentMode={environmentMode} />
      <RadarRing
        center={state.config.radar_pos}
        radius={state.config.radar_range}
        environmentMode={environmentMode}
      />
      <RadarTruckBoundary
        point={state.config.radar_pos}
        environmentMode={environmentMode}
      />

      {launchSites.map((site, index) => (
        <MissileBatteryBoundary
          key={`launch-${index}`}
          point={site}
          yaw={Math.PI}
          padColor="#5c3a1d"
          environmentMode={environmentMode}
        />
      ))}

      {state.config.interceptor_sites.map((site) => (
        <MissileBatteryBoundary
          key={`battery-${site.id}`}
          point={site.position}
          yaw={0}
          padColor="#253949"
          environmentMode={environmentMode}
        />
      ))}

      {state.targets.map((target) => (
        <TargetRenderBoundary
          key={`target-${target.id}`}
          point={target.position}
          velocity={target.velocity}
          laneZ={targetLaneAtTime(target.id, state.time)}
          destroyed={target.destroyed}
          time={state.time}
        />
      ))}

      <PredictedIntercepts state={state} />
      <ExplosionLayer
        state={state}
        threatLaneFor={threatLaneFor}
        interceptorLaneFor={interceptorLaneFor}
      />

      {state.threats.map((threat, index) => (
        <group key={`threat-${threat.id ?? index}`}>
          {(() => {
            const laneZ = threatLaneFor(threat, index);
            return (
              <>
          <Trail3D
            trail={threat.trail}
            color="#ff6f61"
            laneZ={laneZ}
            environmentMode={environmentMode}
          />
          <ProjectileBoundary
            point={threat.position}
            velocity={threat.velocity}
            color="#ff785d"
            laneZ={laneZ}
            modelVariant={
              threat.velocity &&
              Math.hypot(threat.velocity.x, threat.velocity.y) >=
                state.config.hypersonic_threat_speed_threshold
                ? "fateh"
                : "phoenix"
            }
            scale={1.08}
          />
              </>
            );
          })()}
        </group>
      ))}

      {state.interceptors.map((interceptor, index) => (
        <group key={`interceptor-${interceptor.id ?? index}`}>
          {(() => {
            const laneZ = interceptorLaneFor(interceptor, index);
            return (
              <>
          <Trail3D
            trail={interceptor.trail}
            color="#78ffd1"
            laneZ={laneZ}
            environmentMode={environmentMode}
          />
          <ProjectileBoundary
            point={interceptor.position}
            velocity={interceptor.velocity}
            color="#8bffd8"
            laneZ={laneZ}
            modelVariant={
              interceptor.interceptor_class === "hypersonic" ? "fateh" : "phoenix"
            }
          />
              </>
            );
          })()}
        </group>
      ))}
    </>
  );
}

export default function ThreeTacticalScene({
  state,
  zoom,
  panX,
  environmentMode,
  cameraPreset,
}: Props) {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ powerPreference: "high-performance" }}>
      <PerspectiveCamera makeDefault position={[60, 190, 220]} fov={44} />
      {state ? <TacticalWorld state={state} environmentMode={environmentMode} /> : null}
      <CameraRig
        state={state}
        zoom={zoom}
        panX={panX}
        cameraPreset={cameraPreset}
      />
      <OrbitControls
        enablePan
        enableRotate={cameraPreset !== "tactical"}
        enableZoom
        target={[25 + panX * 0.7, 35, 0]}
        maxPolarAngle={Math.PI / 2.03}
        minDistance={90}
        maxDistance={520}
      />
    </Canvas>
  );
}
