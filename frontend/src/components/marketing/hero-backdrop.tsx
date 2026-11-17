"use client";

import { AVTRCanvas } from "@/components/experience/avtr-canvas";
import { NeuralField } from "@/components/experience/neural-field";
import { BrandCore } from "@/components/experience/brand-core";

/** Ambient 3D atmosphere behind the hero's headline and cards -- the
 * same engine built for the dashboard's BrandVisualization, re-tuned for
 * the marketing page's light theme (a glowing core in RankLens's brand blue
 * instead of the dark app's white/gray) and for a public page's wider,
 * often slower audience (fewer particles than the dashboard's own
 * instance, no ProviderNodes). The core's brightness tracks the same
 * illustrative example score already driving the 2D cards in front of
 * it, so the glow pulses in sync with "a result just came in" instead
 * of running on an unrelated, separately-invented number. */
export function HeroBackdrop({ score }: { score: number }) {
  return (
    <AVTRCanvas camera={{ position: [0, 0.4, 7.5], fov: 48 }}>
      <ambientLight intensity={0.35} />
      <NeuralField count={160} radius={6.5} color="#9a9886" size={0.018} />
      <BrandCore visibilityScore={score} mentionCount={16} color="#2851ff" accentColor="#1a1a18" />
    </AVTRCanvas>
  );
}

/** A sparse, lighter-weight field spanning the full hero -- ambiance for
 * the space around the cards and headline (the cards themselves are
 * opaque, so this never has to compete with their content, just the
 * cream page background between them). No BrandCore here: one glowing
 * core behind the headline reads as a focal point, two would just be
 * visual noise. */
export function HeroAmbientField() {
  return (
    <AVTRCanvas camera={{ position: [0, 0, 7] }}>
      <NeuralField count={220} radius={6.5} color="#68675d" size={0.028} opacity={0.6} />
    </AVTRCanvas>
  );
}
