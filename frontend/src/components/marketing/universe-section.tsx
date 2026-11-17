"use client";

import { Building2, Sparkles, MessageSquare, Users2, ArrowRight } from "lucide-react";

import { useScrollReveal } from "@/lib/animations";

const FLOW = [
  { icon: Building2, label: "Your Brand", caption: "The entity being tracked" },
  { icon: Sparkles, label: "AI Engines", caption: "OpenAI, Gemini, Perplexity" },
  { icon: MessageSquare, label: "Real Prompts", caption: "Buyer-intent questions" },
  { icon: Users2, label: "Competitors", caption: "Who gets named instead" },
];

/** The AI Visibility Universe, as a clean flow diagram rather than a
 * second WebGL scene -- the hero already carries this page's 3D weight;
 * stacking multiple live canvases on one page is real GPU cost for
 * diminishing visual return (design bible #48 performance). */
export function UniverseSection() {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <section id="universe" className="px-5 py-28 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-14">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">The system</p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            One system, mapping the whole picture.
          </h2>
        </div>

        <div ref={ref} className="flex w-full flex-col items-center gap-6 sm:flex-row sm:justify-between">
          {FLOW.map(({ icon: Icon, label, caption }, i) => (
            <div key={label} className="flex items-center gap-6 sm:contents">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/10">
                  <Icon className="size-7 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs text-muted-foreground">{caption}</p>
                </div>
              </div>
              {i < FLOW.length - 1 && (
                <ArrowRight className="hidden size-5 shrink-0 text-muted-foreground/50 sm:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
