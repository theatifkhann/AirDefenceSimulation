import { Canvas, type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Clone, PerspectiveCamera, Sparkles, Stars } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Box3, Group, MathUtils, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type InteractionState = "idle" | "hover" | "dragging";
type PointerCaptureTarget = EventTarget & {
  releasePointerCapture?: (pointerId: number) => void;
  setPointerCapture?: (pointerId: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function FatehMissileModel({
  onInteractionChange,
}: {
  onInteractionChange: (state: InteractionState) => void;
}) {
  const gltf = useLoader(GLTFLoader, "/models/missile_fateh_110.glb");
  const asset = gltf.scene as Group;
  const size = useThree((state) => state.size);
  const missileRef = useRef<Group | null>(null);
  const dragStateRef = useRef({
    active: false,
    pointerId: -1,
    lastClientX: 0,
    lastClientY: 0,
  });
  const rotationTargetRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });

  const isMobile = size.width < 900;
  const baseRotation = useMemo(
    () =>
      isMobile
        ? { x: 0.16, y: -0.34, z: -0.08 }
        : { x: 0.1, y: -0.46, z: -0.16 },
    [isMobile],
  );
  const basePosition = useMemo(
    () =>
      isMobile
        ? { x: 0.3, y: -0.55, z: 0 }
        : { x: 1.4, y: -0.08, z: 0 },
    [isMobile],
  );

  const assetTransform = useMemo(() => {
    const bounds = new Box3().setFromObject(asset);
    const sizeVector = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const axisLengths = [
      { axis: "x", length: sizeVector.x },
      { axis: "y", length: sizeVector.y },
      { axis: "z", length: sizeVector.z },
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
      scale: (isMobile ? 4.6 : 5.8) / Math.max(sizeVector.x, sizeVector.y, sizeVector.z, 1),
    };
  }, [asset, isMobile]);

  useEffect(() => {
    rotationTargetRef.current = { x: baseRotation.x, y: baseRotation.y };
  }, [baseRotation]);

  useEffect(() => {
    asset.traverse((child) => {
      const mesh = child as {
        isMesh?: boolean;
        castShadow?: boolean;
        receiveShadow?: boolean;
      };

      if (!mesh.isMesh) {
        return;
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }, [asset]);

  useFrame((state, delta) => {
    const missile = missileRef.current;
    if (!missile) {
      return;
    }

    const elapsed = state.clock.getElapsedTime();
    const dragState = dragStateRef.current;

    if (!dragState.active) {
      rotationTargetRef.current.x += velocityRef.current.x * delta;
      rotationTargetRef.current.y += velocityRef.current.y * delta;
      velocityRef.current.x = MathUtils.damp(velocityRef.current.x, 0, 4.8, delta);
      velocityRef.current.y = MathUtils.damp(velocityRef.current.y, 0, 4.8, delta);
    }

    rotationTargetRef.current.x = clamp(
      rotationTargetRef.current.x,
      baseRotation.x - 0.34,
      baseRotation.x + 0.34,
    );
    rotationTargetRef.current.y = clamp(
      rotationTargetRef.current.y,
      baseRotation.y - 0.68,
      baseRotation.y + 0.68,
    );

    const idleYaw = dragState.active ? 0 : Math.sin(elapsed * 0.22) * 0.05;
    const idlePitch = dragState.active ? 0 : Math.sin(elapsed * 0.3) * 0.02;
    const idleRoll = dragState.active ? 0 : Math.sin(elapsed * 0.42) * 0.02;

    missile.rotation.x = MathUtils.damp(
      missile.rotation.x,
      rotationTargetRef.current.x + idlePitch,
      6.5,
      delta,
    );
    missile.rotation.y = MathUtils.damp(
      missile.rotation.y,
      rotationTargetRef.current.y + idleYaw,
      6.5,
      delta,
    );
    missile.rotation.z = MathUtils.damp(
      missile.rotation.z,
      baseRotation.z + (rotationTargetRef.current.y - baseRotation.y) * 0.18 + idleRoll,
      6.5,
      delta,
    );

    missile.position.x = MathUtils.damp(missile.position.x, basePosition.x, 5.2, delta);
    missile.position.y = MathUtils.damp(
      missile.position.y,
      basePosition.y + Math.sin(elapsed * 0.4) * 0.08,
      4.6,
      delta,
    );
    missile.position.z = MathUtils.damp(missile.position.z, basePosition.z, 5.2, delta);
  });

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    dragStateRef.current.active = true;
    dragStateRef.current.pointerId = event.pointerId;
    dragStateRef.current.lastClientX = event.clientX;
    dragStateRef.current.lastClientY = event.clientY;
    velocityRef.current.x = 0;
    velocityRef.current.y = 0;
    const pointerTarget = event.target as PointerCaptureTarget | null;
    pointerTarget?.setPointerCapture?.(event.pointerId);
    onInteractionChange("dragging");
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (
      !dragStateRef.current.active ||
      dragStateRef.current.pointerId !== event.pointerId
    ) {
      return;
    }

    event.stopPropagation();
    const deltaX = event.clientX - dragStateRef.current.lastClientX;
    const deltaY = event.clientY - dragStateRef.current.lastClientY;

    dragStateRef.current.lastClientX = event.clientX;
    dragStateRef.current.lastClientY = event.clientY;

    rotationTargetRef.current.y += deltaX * 0.0068;
    rotationTargetRef.current.x += deltaY * 0.0046;
    velocityRef.current.y = deltaX * 0.015;
    velocityRef.current.x = deltaY * 0.01;
  }

  function finishDrag(event?: ThreeEvent<PointerEvent>) {
    if (event && dragStateRef.current.pointerId === event.pointerId) {
      event.stopPropagation();
      const pointerTarget = event.target as PointerCaptureTarget | null;
      pointerTarget?.releasePointerCapture?.(event.pointerId);
    }
    dragStateRef.current.active = false;
    dragStateRef.current.pointerId = -1;
    onInteractionChange("hover");
  }

  return (
    <group
      ref={missileRef}
      position={[basePosition.x, basePosition.y, basePosition.z]}
      rotation={[baseRotation.x, baseRotation.y, baseRotation.z]}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (!dragStateRef.current.active) {
          onInteractionChange("hover");
        }
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        if (!dragStateRef.current.active) {
          onInteractionChange("idle");
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <group scale={assetTransform.scale}>
        <group rotation={assetTransform.alignmentRotation}>
          <group position={assetTransform.offset}>
            <Clone object={asset} />
          </group>
        </group>
      </group>
      <mesh visible={false}>
        <boxGeometry args={[9.6, 2.4, 2.6]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

function CoverHeroFallback() {
  return (
    <mesh rotation={[0.1, -0.38, -0.12]}>
      <cylinderGeometry args={[0.22, 0.34, 5.2, 24]} />
      <meshStandardMaterial color="#cbc7b9" metalness={0.76} roughness={0.28} />
    </mesh>
  );
}

export default function CoverHero() {
  const [interactionState, setInteractionState] = useState<InteractionState>("idle");

  return (
    <div
      className={`coverHeroViewport ${interactionState === "hover" ? "isHovering" : ""} ${
        interactionState === "dragging" ? "isDragging" : ""
      }`}
    >
      <Canvas dpr={[1, 1.8]} shadows gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={["#02050a"]} />
        <fog attach="fog" args={["#02050a", 14, 32]} />
        <PerspectiveCamera makeDefault position={[0, 0.25, 10.6]} fov={28} />
        <ambientLight intensity={0.62} color="#c5d2de" />
        <hemisphereLight intensity={1.08} color="#f4f7fb" groundColor="#05080e" />
        <directionalLight
          castShadow
          intensity={2.1}
          color="#f1ead6"
          position={[8, 6, 8]}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <pointLight intensity={16} distance={22} color="#8ab8ff" position={[-6, 2, 4]} />
        <pointLight intensity={8} distance={18} color="#ffb35f" position={[7, -2, 6]} />
        <Sparkles
          count={64}
          scale={[18, 9, 10]}
          size={2.4}
          speed={0.18}
          opacity={0.75}
          color="#e7edf7"
          position={[0, 0, -2]}
        />
        <Stars radius={90} depth={46} count={1600} factor={2.2} saturation={0} fade speed={0.22} />
        <group position={[0, -1.55, -1.1]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[6.8, 64]} />
            <shadowMaterial transparent opacity={0.16} />
          </mesh>
        </group>
        <Suspense fallback={<CoverHeroFallback />}>
          <FatehMissileModel onInteractionChange={setInteractionState} />
        </Suspense>
      </Canvas>
    </div>
  );
}
