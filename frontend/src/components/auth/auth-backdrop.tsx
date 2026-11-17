"use client";

import { AVTRCanvas } from "@/components/experience/avtr-canvas";
import { NeuralField } from "@/components/experience/neural-field";
import { BrandCore } from "@/components/experience/brand-core";

/** Pure ambient brand art for the auth screens' side panel -- not a data
 * visualization, so its brightness doesn't imply any real score or
 * count (no number is shown anywhere near it). Same engine used
 * everywhere else RankLens's 3D brand presence appears (the dashboard hero,
 * the marketing homepage), just here as scenery behind the RankLens
 * wordmark instead of attached to a metric. */
export function AuthBackdrop() {
  return (
    <AVTRCanvas camera={{ position: [0, 0.3, 6.5], fov: 42 }}>
      <ambientLight intensity={0.4} />
      <NeuralField count={220} radius={5.5} />
      <BrandCore visibilityScore={0.55} mentionCount={20} />
    </AVTRCanvas>
  );
}
