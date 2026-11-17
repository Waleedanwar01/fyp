"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { prefersReducedMotion } from "@/lib/animations";
import { SignalParticles } from "@/components/experience/signal-particles";

/** The central "RankLens Brand Core" (design bible #9) -- not a generic
 * sphere: a wireframe outer shell, an inner emissive light source, two
 * tilted data rings, and orbiting signal particles. Every visual
 * property is driven by `visibilityScore`/`mentionCount`, which callers
 * must pass as real values from the traceable-score API -- a brand with
 * no data yet should be passed 0, not a placeholder non-zero number, so
 * the core honestly looks dim/quiet rather than implying activity that
 * didn't happen (design bible #57 "no mocking").
 *
 * Higher visibility -> brighter, larger inner core and faster rings.
 * More mentions -> more orbiting signal particles. */
export function BrandCore({
  visibilityScore,
  mentionCount = 0,
  color = "#e4e7ec",
  accentColor = "#8b93a1",
}: {
  visibilityScore: number;
  mentionCount?: number;
  color?: string;
  accentColor?: string;
}) {
  const shellRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  const score = Math.max(0, Math.min(1, visibilityScore));
  const coreScale = 0.55 + score * 0.35;
  const coreEmissive = 0.6 + score * 2.4;
  const ringSpeed = 0.08 + score * 0.35;
  // Capped -- a brand with hundreds of mentions doesn't need hundreds of
  // particles to read as "a lot of signal," and instancing more than
  // this buys visual noise, not clarity, at this object's screen size.
  const particleCount = Math.min(40, mentionCount);

  useFrame((_, delta) => {
    if (reduced) return;
    if (shellRef.current) shellRef.current.rotation.y += delta * 0.08;
    if (ringARef.current) ringARef.current.rotation.z += delta * ringSpeed;
    if (ringBRef.current) ringBRef.current.rotation.x += delta * ringSpeed * 0.7;
  });

  return (
    <group>
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[1.4, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.35} />
      </mesh>

      <mesh ref={coreRef} scale={coreScale}>
        <sphereGeometry args={[0.55, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={coreEmissive}
          toneMapped={false}
        />
      </mesh>
      <pointLight color={color} intensity={1.5 + score * 2} distance={6} />

      <mesh ref={ringARef} rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[1.05, 0.012, 8, 96]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ringBRef} rotation={[0.3, Math.PI / 2, 0]}>
        <torusGeometry args={[1.2, 0.01, 8, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>

      <SignalParticles count={particleCount} radius={1.55} color={accentColor} active={!reduced} />
    </group>
  );
}
