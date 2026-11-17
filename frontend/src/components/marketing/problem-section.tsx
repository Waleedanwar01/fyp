"use client";

import { useScrollReveal } from "@/lib/animations";

/** Dark, full-bleed two-column contrast section -- a bold left-aligned
 * statement against a plain-language explanation on the right, instead
 * of a centered paragraph. Breaks the page's otherwise light/cream
 * background for emphasis (matching auxia.io's own dark "problem"
 * section) -- forced dark here specifically, since .theme-marketing's
 * own --card is white (cards float on the cream page), which wouldn't
 * give this section the contrast it needs. */
export function ProblemSection() {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <section className="dark bg-background px-5 py-28 text-foreground sm:px-8">
      <div ref={ref} className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start lg:gap-16">
        <h2 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-6xl">
          Search didn&apos;t get smaller.
          <br />
          <span className="text-muted-foreground">It stopped showing its work.</span>
        </h2>
        <div className="flex flex-col gap-5 text-lg text-muted-foreground text-balance">
          <p>
            When someone asks ChatGPT or Gemini for a recommendation, it gives one answer -- not ten blue
            links to click through. Whether your brand is the one it names, how it&apos;s positioned next to
            competitors, and what it cites as a source is now invisible to a rank-tracking tool built for a
            results page that doesn&apos;t exist anymore.
          </p>
          <p>
            RankLens runs the real questions your buyers ask against real AI engines, and keeps the full
            evidence behind every answer -- so &ldquo;are we visible&rdquo; stops being a guess.
          </p>
        </div>
      </div>
    </section>
  );
}
