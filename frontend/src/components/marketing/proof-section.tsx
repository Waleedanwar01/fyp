"use client";

import { ExternalLink } from "lucide-react";

import { useScrollReveal } from "@/lib/animations";

/** Two real mechanisms the product actually implements, each paired with
 * a mockup of the real UI shape (not a literal client's data -- this is
 * a public page, so the example prompt/mention below is a generic
 * illustrative stand-in, never a real customer's business). The
 * evidence fields (term, rank, sentiment, confidence, citations) are
 * exactly what core.visibility_score computes (design bible #58); the
 * exact per-component weights are deliberately not published here --
 * the methodology is described, not handed to a competitor to copy. */
export function ProofSection() {
  const ref = useScrollReveal<HTMLDivElement>({ y: 20 });

  return (
    <section className="px-5 py-28 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-20">
        <div ref={ref} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Traceable evidence</p>
            <h3 className="text-3xl font-semibold tracking-tight text-balance">
              Every mention is evidence, not a guess.
            </h3>
            <p className="text-muted-foreground">
              RankLens doesn&apos;t just count whether a brand got mentioned. Each detection carries the exact
              rank it was recommended at, the tone of the text around it, a confidence score, and the real
              source link behind it -- so a shaky match is flagged, never presented as fact.
            </p>
          </div>

          <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
            <p className="mb-3 text-xs text-muted-foreground">
              &ldquo;Best project management tools for remote teams&rdquo; -- Gemini
            </p>
            <p className="mb-4 rounded-lg bg-background p-3 text-sm text-muted-foreground">
              &ldquo;...for distributed teams, <span className="text-foreground">1. Notion</span> stands
              out for combining docs and task tracking in one workspace...&rdquo;
            </p>
            <div className="flex flex-col gap-2 rounded-lg bg-background p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Notion</span>
                <span className="text-xs text-muted-foreground">Rank #1</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                  Positive
                </span>
                <span className="text-xs text-muted-foreground">92% confidence</span>
              </div>
              <a href="#" className="flex items-center gap-1 text-xs text-primary hover:underline">
                notion.com <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 rounded-2xl bg-card p-6 ring-1 ring-foreground/10 lg:order-1">
            <p className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Visibility Score
            </p>
            <div className="flex flex-col gap-2.5 text-sm">
              {[
                ["Mention Rate", "How often you're named at all"],
                ["Position Score", "Where you rank when you are"],
                ["Sentiment Score", "How positively you're framed"],
                ["Citation Score", "Whether a real source backs it"],
              ].map(([label, hint]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right text-xs text-muted-foreground">{hint}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2.5 font-semibold">
                <span>Visibility Score</span>
                <span className="text-sm text-muted-foreground">Weighted into one number</span>
              </div>
            </div>
          </div>

          <div className="order-1 flex flex-col gap-4 lg:order-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fully traceable</p>
            <h3 className="text-3xl font-semibold tracking-tight text-balance">
              Every score traces back to real evidence.
            </h3>
            <p className="text-muted-foreground">
              One number, computed from four real, inspectable components. Click into any score and see the
              exact prompt runs, mentions and citations that produced it -- the full evidence trail, not
              just a number.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
