"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Workflow, Sparkles } from "lucide-react";

import { useScrollReveal, useCountUp } from "@/lib/animations";

// Real, verifiable engineering facts about the product itself -- not
// platform-wide usage numbers. RankLens is early-stage with one pilot
// agency today, so a "runs analyzed" or "brands tracked" count would
// actually be that one tenant's private data, not a real aggregate
// metric -- showing it here would misleadingly imply scale that
// doesn't exist yet (design bible #58 "no fake data").
const STATS = [
  {
    icon: CheckCircle2,
    value: 500,
    suffix: "+",
    label: "Automated tests, covering the scoring pipeline end to end",
  },
  { icon: Workflow, value: 7, suffix: "", label: "Pipeline stages between a raw prompt and a traceable score" },
  {
    icon: Sparkles,
    value: 3,
    suffix: "",
    label: "AI engines integrated -- OpenAI and Gemini live, Perplexity in progress",
  },
];

function StatValue({ target, suffix }: { target: number; suffix: string }) {
  const ref = useCountUp(target, (n) => `${Math.round(n)}${suffix}`);
  return (
    <span ref={ref} className="font-mono text-5xl font-semibold tracking-tight tabular-nums">
      {`${target}${suffix}`}
    </span>
  );
}

/** Counts up from 0 the first time this section is actually scrolled
 * into view, rather than on page mount -- useCountUp itself just
 * animates whenever its target value changes, so a visibility flag
 * (0 -> real value) is what turns "mount" into "scrolled into view" as
 * the trigger (design bible #17/#37 "numbers should feel important"). */
export function StatsSection() {
  const ref = useScrollReveal<HTMLDivElement>();
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="px-5 py-20 sm:px-8">
      <div ref={ref} className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
        {STATS.map(({ icon: Icon, value, suffix, label }) => (
          <div
            key={label}
            className="flex flex-col gap-3 rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10 sm:text-left"
          >
            <Icon className="size-5 self-center text-primary sm:self-start" />
            <StatValue target={active ? value : 0} suffix={suffix} />
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
