"use client";

import { Canvas, type CanvasProps } from "@react-three/fiber";
import { Suspense, type ReactNode } from "react";

import { prefersReducedMotion } from "@/lib/animations";
import { cn } from "@/lib/utils";

/** The one Canvas every RankLens 3D scene mounts into -- shared camera/renderer
 * defaults and performance guardrails live here once instead of being
 * copy-pasted into every scene (design bible #7/#45).
 */
export function AVTRCanvas({
  children,
  className,
  camera,
  fallback = null,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  camera?: { position?: [number, number, number]; fov?: number };
  fallback?: ReactNode;
} & Omit<CanvasProps, "children" | "camera" | "className">) {
  return (
    <Canvas
      className={cn("touch-none", className)}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 6], fov: 40, ...camera }}
      frameloop={prefersReducedMotion() ? "demand" : "always"}
      {...rest}
    >
      <Suspense fallback={fallback}>
        {children}
      </Suspense>
    </Canvas>
  );
}
