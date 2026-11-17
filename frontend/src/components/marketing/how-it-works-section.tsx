"use client";

import { Link2, Radar, Brain, TrendingUp } from "lucide-react";

import { useScrollReveal } from "@/lib/animations";

const STEPS = [
  {
    number: "01",
    icon: Link2,
    title: "Connect",
    description: "Add a client, their brand, and the competitors you want tracked alongside them.",
  },
  {
    number: "02",
    icon: Radar,
    title: "Scan",
    description: "Real buyer-intent prompts run against OpenAI and Gemini, on demand or on a schedule.",
  },
  {
    number: "03",
    icon: Brain,
    title: "Understand",
    description:
      "Every answer is scanned for mentions, ranking position, sentiment and citations -- each with a confidence score.",
  },
  {
    number: "04",
    icon: TrendingUp,
    title: "Optimize",
    description: "Track the Visibility Score over time and see exactly which competitor is winning, and where.",
  },
];

export function HowItWorksSection() {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <section id="how-it-works" className="px-5 py-28 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-14">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">How it works</p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            From a real prompt to a traceable score.
          </h2>
        </div>

        <div className="relative">
          {/* A thin dashed thread running behind the step cards -- since
              the cards are opaque, it only ever shows in the gaps between
              them, reading as a connecting path through the sequence
              without needing a second, more literal line-and-pill motif
              competing with the hero's. */}
          <div
            aria-hidden
            className="absolute inset-x-10 top-13 hidden border-t border-dashed border-foreground/20 lg:block"
          />
          <div ref={ref} className="relative grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ number, icon: Icon, title, description }) => (
              <div
                key={number}
                className="group flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-4.5" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{number}</span>
                </div>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
