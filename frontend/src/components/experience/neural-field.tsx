"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { prefersReducedMotion } from "@/lib/animations";
import { seededRandom } from "@/components/experience/seeded-random";

/** Pure ambiance, not a data visualization -- a sparse field of points
 * drifting slowly behind the foreground scene (design bible #7/#11:
 * "subtle grid, radial lighting, tiny particles... must remain behind
 * the content"). One draw call (a single THREE.Points object) regardless
 * of point count, so `count` is cheap to raise for a denser field.
 *
 * Frozen (no rotation) under prefers-reduced-motion -- still visible,
 * just doesn't move on its own. */
export function NeuralField({
  count = 400,
  radius = 6,
  color = "#8b93a1",
  size = 0.015,
  opacity = 0.35,
}: {
  count?: number;
  radius?: number;
  color?: string;
  size?: number;
  opacity?: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  const positions = useMemo(() => {
    const rand = seededRandom(count * 1000 + Math.round(radius * 100));
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Points distributed through a solid sphere (not just its surface)
      // via a cube-root radius scale, so density stays roughly uniform
      // instead of clumping toward the center.
      const r = radius * Math.cbrt(rand());
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count, radius]);

  useFrame((_, delta) => {
    if (reduced || !pointsRef.current) return;
    pointsRef.current.rotation.y += delta * 0.015;
    pointsRef.current.rotation.x += delta * 0.006;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        sizeAttenuation
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </points>
  );
}
