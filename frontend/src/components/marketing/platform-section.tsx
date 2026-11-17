"use client";

import Link from "next/link";
import { Zap, ScanSearch, ShieldCheck, Check } from "lucide-react";

import { useScrollReveal } from "@/lib/animations";

// The three real layers behind the product -- not an invented org chart.
// Execution is core/ai_providers.py + the scheduler, scoring is
// core/visibility_score.py + the mention/citation pipeline, and the
// workspace layer is the agency-scoped RLS tenancy already covered in
// detail by TrustSection. No exact score weights repeated here or below
// -- the methodology stays described, not published line-by-line.
const LAYERS = [
  {
    icon: Zap,
    title: "AI Execution",
    description:
      "Runs real buyer-intent prompts against OpenAI and Gemini, on demand or on a schedule, with automatic retry on rate limits.",
  },
  {
    icon: ScanSearch,
    title: "Detection & Scoring",
    description:
      "Reads every answer for brand and competitor mentions, ranks position and sentiment, and extracts citations -- each confidence-scored.",
  },
  {
    icon: ShieldCheck,
    title: "Agency Workspace",
    description:
      "Every agency's clients, competitors and schedules live in their own isolated workspace, enforced at the database layer.",
  },
];

const RUN_ENGINE_CAPABILITIES = [
  "On-demand or scheduled runs",
  "OpenAI & Gemini today, Perplexity next",
  "Automatic retry on rate limits",
  "Idempotent delivery -- never double-counted",
  "Explicit provider choice per run",
];
const RUN_ENGINE_INCLUDED = [
  "Per-agency usage dashboard",
  "Prompt Run limits by plan",
  "Schedule management",
  "Full run history & status",
];

const SCORING_CAPABILITIES = [
  "Brand & competitor mention detection",
  "Rank & list-position scoring",
  "Sentiment scoring per mention",
  "Citation extraction with source URLs",
  "Confidence score on every detection",
];
const SCORING_INCLUDED = [
  "Traceable Visibility Score",
  "Evidence behind every number",
  "Low-confidence matches flagged, not hidden",
  "Full prompt-run history",
];

function CtaLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/register"
      className={`inline-flex w-fit items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white/90 ${className}`}
    >
      Get Started
    </Link>
  );
}

function BulletColumn({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-medium tracking-wide opacity-70 uppercase">{heading}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 opacity-70" />
            <span className="opacity-90">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The product as three real layers, then two deep-dive cards on the
 * two layers a visitor can actually picture working -- execution and
 * scoring. The agency-workspace layer isn't re-expanded here since
 * TrustSection already covers tenant isolation in full; repeating it as
 * a third capability card would just pad the page. */
export function PlatformSection() {
  const layersRef = useScrollReveal<HTMLDivElement>();
  const cardsRef = useScrollReveal<HTMLDivElement>({ y: 20 });

  return (
    <section className="px-5 py-28 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-14">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">The platform</p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            One system, three layers.
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            RankLens runs real prompts against real AI engines, turns every answer into scored evidence, and
            keeps each agency&apos;s clients cleanly isolated -- three layers working behind one traceable
            score.
          </p>
        </div>

        <div ref={layersRef} className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {LAYERS.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
              <Icon className="size-6 text-primary" />
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>

        <div ref={cardsRef} className="flex flex-col gap-5">
          <div className="dark grid grid-cols-1 gap-8 rounded-2xl bg-background p-8 text-foreground ring-1 ring-border sm:grid-cols-[1.2fr_1fr_1fr]">
            <div className="flex flex-col gap-3">
              <h3 className="text-2xl font-semibold tracking-tight">RankLens Run Engine</h3>
              <p className="text-sm opacity-80">
                The execution layer that runs your tracked prompts against real AI engines -- on demand
                from the dashboard, or automatically on a schedule.
              </p>
              <p className="text-xs font-medium tracking-wide opacity-60 uppercase">Prompt runs, metered by plan</p>
              <CtaLink className="mt-2" />
            </div>
            <BulletColumn heading="Capabilities" items={RUN_ENGINE_CAPABILITIES} />
            <BulletColumn heading="Included" items={RUN_ENGINE_INCLUDED} />
          </div>

          <div className="grid grid-cols-1 gap-8 rounded-2xl bg-primary p-8 text-primary-foreground sm:grid-cols-[1.2fr_1fr_1fr]">
            <div className="flex flex-col gap-3">
              <h3 className="text-2xl font-semibold tracking-tight">Detection &amp; Scoring Engine</h3>
              <p className="text-sm opacity-80">
                The engine that reads every AI answer and turns it into evidence -- mentions, position,
                sentiment and citations, each with its own confidence score.
              </p>
              <p className="text-xs font-medium tracking-wide opacity-60 uppercase">The same engine, on every plan</p>
              <CtaLink className="mt-2" />
            </div>
            <BulletColumn heading="Capabilities" items={SCORING_CAPABILITIES} />
            <BulletColumn heading="Included" items={SCORING_INCLUDED} />
          </div>
        </div>
      </div>
    </section>
  );
}
