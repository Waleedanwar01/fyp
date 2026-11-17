"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { prefersReducedMotion } from "@/lib/animations";
import { seededRandom } from "@/components/experience/seeded-random";

/** Discrete "signals" orbiting a center point -- represents actual
 * events (mentions, runs, active providers), never a decorative particle
 * count (design bible #7: "scenes must be data-driven... do not
 * hard-code fake values"). Callers pass a real `count`; zero signals
 * renders zero particles rather than a fallback decorative amount.
 *
 * GPU-instanced: one draw call for every particle via InstancedMesh,
 * regardless of count (design bible #45 "instancing where possible"). */
export function SignalParticles({
  count,
  radius = 1.6,
  color = "#e4e7ec",
  active = true,
}: {
  count: number;
  radius?: number;
  color?: string;
  active?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // Each particle's own orbit radius/speed/phase/tilt, chosen once per
  // particle (not per frame) so motion looks organic instead of every
  // particle tracing the identical circle.
  const orbits = useMemo(() => {
    const rand = seededRandom(count * 1000 + Math.round(radius * 100));
    return Array.from({ length: count }, () => ({
      radius: radius * (0.6 + rand() * 0.5),
      speed: 0.15 + rand() * 0.25,
      phase: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 1.2,
      scale: 0.5 + rand() * 0.5,
    }));
  }, [count, radius]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = reduced || !active ? 0 : clock.getElapsedTime();

    orbits.forEach((orbit, i) => {
      const angle = orbit.phase + t * orbit.speed;
      const x = Math.cos(angle) * orbit.radius;
      const z = Math.sin(angle) * orbit.radius;
      const y = Math.sin(angle * 1.3 + orbit.phase) * orbit.tilt;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(orbit.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (count <= 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.035, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} toneMapped={false} />
    </instancedMesh>
  );
}
