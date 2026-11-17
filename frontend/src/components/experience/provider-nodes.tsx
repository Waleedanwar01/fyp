"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { prefersReducedMotion } from "@/lib/animations";

export type ProviderNodeData = {
  /** AIProvider value (e.g. "openai") -- used as the React key, not shown. */
  id: string;
  label: string;
  /** 0-1, or null when this provider has no scoreable runs yet. */
  score: number | null;
  runs: number;
};

/** AI provider nodes orbiting the brand core at the scene's origin
 * (design bible #28 "AI Providers" / #8 "AI Providers -> orbiting
 * nodes"). Evenly spaced by index, not randomly placed, so the same
 * provider list always reads in a stable, scannable layout rather than
 * reshuffling on every render.
 *
 * Each node's size/brightness reflects its own real score -- an
 * unconfigured or data-less provider (score: null) renders as a dim,
 * static node rather than being hidden or faked, matching how the 2D
 * score cards already handle "no data yet" (design bible #57). Labels
 * are real DOM text via drei's <Html>, not canvas-drawn glyphs, so
 * screen readers and page search both still see them (design bible
 * #46: "every important visualization needs an accessible textual
 * representation"). */
export function ProviderNodes({
  providers,
  radius = 2.6,
  color = "#e4e7ec",
  showLabels = true,
}: {
  providers: ProviderNodeData[];
  radius?: number;
  color?: string;
  /** Off when the caller renders its own DOM legend over the canvas. */
  showLabels?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  useFrame((_, delta) => {
    if (reduced || !groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.05;
  });

  return (
    <group ref={groupRef}>
      {providers.map((provider, i) => {
        const angle = (i / providers.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const score = provider.score ?? 0;
        const hasData = provider.score !== null;
        return (
          <group key={provider.id} position={[x, 0, z]}>
            <mesh>
              <icosahedronGeometry args={[0.16 + score * 0.1, 1]} />
              <meshStandardMaterial
                color={hasData ? color : "#667085"}
                emissive={hasData ? color : "#000000"}
                emissiveIntensity={hasData ? 0.5 + score * 1.5 : 0}
                toneMapped={false}
                wireframe={!hasData}
              />
            </mesh>
            {/* No distanceFactor -- these are UI labels that must stay
                readable at every orbit position, not scenery that should
                shrink with perspective (a node further back in its orbit
                was shrinking to the point of being illegible). */}
            {showLabels && (
              <Html center occlude={false} style={{ pointerEvents: "none" }}>
                <div className="flex flex-col items-center whitespace-nowrap text-center">
                  <span className="text-xs font-semibold text-foreground">{provider.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {hasData ? `${Math.round(score * 1000) / 10}% · ${provider.runs} runs` : "No data yet"}
                  </span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
