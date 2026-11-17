"use client";

import { AVTRCanvas } from "@/components/experience/avtr-canvas";
import { NeuralField } from "@/components/experience/neural-field";

/** Sparse ambient particles behind the dark footer -- pure atmosphere,
 * same engine used everywhere else RankLens's 3D presence appears, default
 * (dark-tuned) colors since the footer is this page's one other
 * dark-themed section besides TrustSection. */
export function FooterField() {
  return (
    <AVTRCanvas camera={{ position: [0, 0, 8] }}>
      <NeuralField count={180} radius={7} />
    </AVTRCanvas>
  );
}
