"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Globe2,
  Layers,
  Loader2,
  Lock,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/8bit-button";
import { TestimonialBadge } from "@/components/marketing/testimonial-badge";
import { gsap, DURATION, EASE, prefersReducedMotion, useCountUp } from "@/lib/animations";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const HeroAmbientField = dynamic(
  () => import("@/components/marketing/hero-backdrop").then((m) => m.HeroAmbientField),
  { ssr: false }
);

const PIPELINE_LABELS = [
  "Execute query against AI Search Engines",
  "Extract brand & competitor entity mentions",
  "Evaluate position rank & mention sentiment",
  "Audit authority citations & domain links",
  "Compute deterministic Visibility Score",
];

const EXAMPLES = [
  {
    prompt: "Best project management software for remote teams in 2026",
    engine: "ChatGPT / OpenAI",
    evidence: [
      { term: "Notion", rank: "#1", sentiment: "Positive", confidence: "94%" },
      { term: "Linear", rank: "#2", sentiment: "Positive", confidence: "89%" },
      { term: "Asana", rank: "#4", sentiment: "Neutral", confidence: "72%" },
    ],
    score: 84,
  },
  {
    prompt: "Top enterprise CRM platforms for high-growth B2B companies",
    engine: "Perplexity AI",
    evidence: [
      { term: "HubSpot", rank: "#1", sentiment: "Positive", confidence: "96%" },
      { term: "Salesforce", rank: "#2", sentiment: "Positive", confidence: "91%" },
      { term: "Attio", rank: "#3", sentiment: "Positive", confidence: "83%" },
    ],
    score: 92,
  },
  {
    prompt: "Best AI visibility & GEO optimization platforms for agencies",
    engine: "Google Gemini",
    evidence: [
      { term: "RankLens", rank: "#1", sentiment: "Positive", confidence: "98%" },
      { term: "OtterAI", rank: "#3", sentiment: "Neutral", confidence: "68%" },
    ],
    score: 89,
  },
];

const STEP_INTERVAL_MS = 550;
const RESULT_HOLD_MS = 3400;
const RESET_PAUSE_MS = 400;

function useHeroDemoCycle(stepCount: number) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [pipelineStep, setPipelineStep] = useState(() => (prefersReducedMotion() ? stepCount : 0));
  const [showResult, setShowResult] = useState(() => prefersReducedMotion());

  const [lastRunIndex, setLastRunIndex] = useState(exampleIndex);
  if (exampleIndex !== lastRunIndex && !prefersReducedMotion()) {
    setLastRunIndex(exampleIndex);
    setPipelineStep(0);
    setShowResult(false);
  }

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => timeouts.push(setTimeout(() => !cancelled && fn(), ms));

    for (let step = 1; step <= stepCount; step++) {
      after(step * STEP_INTERVAL_MS, () => setPipelineStep(step));
    }
    after(stepCount * STEP_INTERVAL_MS + RESET_PAUSE_MS, () => {
      setShowResult(true);
      after(RESULT_HOLD_MS, () => setExampleIndex((i) => (i + 1) % EXAMPLES.length));
    });

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [exampleIndex, stepCount]);

  return { example: EXAMPLES[exampleIndex], pipelineStep, showResult };
}

function ScoreValue({ score }: { score: number }) {
  const ref = useCountUp(score, (n) => `${Math.round(n)}%`);
  return (
    <span ref={ref} className="font-mono text-5xl font-bold tracking-tight tabular-nums text-foreground sm:text-6xl">
      {`${score}%`}
    </span>
  );
}

export function HeroSection() {
  const { user, loading } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const { example, pipelineStep, showResult } = useHeroDemoCycle(PIPELINE_LABELS.length);

  useGSAP(
    () => {
      if (!contentRef.current || prefersReducedMotion()) return;
      const targets = contentRef.current.querySelectorAll("[data-reveal]");
      gsap.fromTo(
        targets,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: DURATION.cinematic, ease: EASE.out, stagger: 0.08, delay: 0.05 }
      );
    },
    { scope: contentRef }
  );

  useGSAP(
    () => {
      if (!promptRef.current || prefersReducedMotion()) return;
      gsap.fromTo(
        promptRef.current,
        { opacity: 0, x: -12 },
        { opacity: 1, x: 0, duration: DURATION.normal, ease: EASE.out }
      );
    },
    { dependencies: [example], scope: contentRef }
  );

  useGSAP(
    () => {
      if (prefersReducedMotion() || !showResult) return;
      if (evidenceRef.current) {
        gsap.fromTo(
          evidenceRef.current.children,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: DURATION.normal, ease: EASE.out, stagger: 0.06 }
        );
      }
      if (scoreRef.current) {
        gsap.fromTo(
          scoreRef.current,
          { opacity: 0, scale: 0.96 },
          { opacity: 1, scale: 1, duration: DURATION.normal, ease: EASE.out }
        );
      }
    },
    { dependencies: [showResult, example], scope: contentRef }
  );

  return (
    <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
      {/* Aurora + grid atmosphere */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <HeroAmbientField />
      </div>

      <div ref={contentRef} className="relative z-10 mx-auto flex max-w-6xl flex-col items-center gap-12 px-5 sm:px-8">
        {/* Top Header & Value Proposition */}
        <div className="flex flex-col items-center gap-5 text-center">
          {/* Trust Pill */}
          <div data-reveal>
            <TestimonialBadge />
          </div>

          {/* Main Headline */}
          <h1
            data-reveal
            className="max-w-4xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance"
          >
            AI search is the new homepage. <br className="hidden sm:inline" />
            <span className="text-primary">Quantify your brand&apos;s rank.</span>
          </h1>

          {/* Subheading */}
          <p
            data-reveal
            className="max-w-2xl text-base text-muted-foreground sm:text-lg text-balance leading-relaxed"
          >
            RankLens monitors how your clients&apos; brands are discovered, cited, and recommended across{" "}
            <strong className="font-semibold text-foreground">ChatGPT, Google Gemini, and Perplexity</strong> with deterministic Visibility Scores and white-label reports.
          </p>

          {/* Action CTAs */}
          <div data-reveal className="mt-2 flex flex-col gap-5 px-1.5 sm:flex-row sm:items-center">
            {!loading &&
              (user ? (
                <Button
                  render={<Link href="/dashboard" />}
                  nativeButton={false}
                  size="lg"
                  className="h-12 px-6"
                >
                  <span>Open Agency Dashboard</span>
                  <ArrowRight className="size-4 ml-1.5" />
                </Button>
              ) : (
                <>
                  <Button
                    render={<Link href="/checkout?plan=growth&interval=monthly" />}
                    nativeButton={false}
                    size="lg"
                    className="h-12 px-6"
                  >
                    <span>Start Free Agency Trial</span>
                    <ArrowRight className="size-4 ml-1.5" />
                  </Button>
                  <Button
                    render={<Link href="/demo" />}
                    nativeButton={false}
                    variant="outline"
                    size="lg"
                    className="h-12 px-6"
                  >
                    <Play className="size-3.5 mr-2 text-primary fill-primary" />
                    <span>Live Interactive Demo</span>
                  </Button>
                </>
              ))}
          </div>

          {/* Micro Trust Strip */}
          <div data-reveal className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" /> No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" /> Multi-Tenant PostgreSQL RLS
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" /> White-Label Client Reports
            </span>
          </div>
        </div>

        {/* Live Interactive Pipeline Console (Agency Showcase) */}
        <div data-reveal className="relative w-full max-w-5xl">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-md sm:p-6">
          {/* Console Topbar */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-5">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
              </div>
              <span className="text-xs font-medium text-muted-foreground ml-2">
                Live AI Visibility Telemetry Engine
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                <Radio className="size-3 text-primary animate-pulse" />
                <span>Simulating Real Audit</span>
              </span>
            </div>
          </div>

          {/* 3-Column Execution Stage Grid */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Stage 1: Track a Prompt & Pipeline */}
            <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-secondary/30 p-4 lg:col-span-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Stage 1: Search Query Run
                  </span>
                  <span className="text-[11px] font-medium text-foreground">{example.engine}</span>
                </div>

                <div className="rounded-lg border border-border/70 bg-background p-3 shadow-2xs">
                  <p ref={promptRef} className="text-xs font-medium text-foreground italic">
                    &ldquo;{example.prompt}&rdquo;
                  </p>
                </div>

                <span className="block mt-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Pipeline Execution Steps
                </span>
                <ul className="flex flex-col gap-2 text-xs">
                  {PIPELINE_LABELS.map((label, i) => {
                    const done = i < pipelineStep;
                    const active = i === pipelineStep;
                    return (
                      <li key={label} className="flex items-center gap-2">
                        {done ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <Loader2
                            className={cn(
                              "size-3.5 shrink-0 text-muted-foreground",
                              active && "animate-spin text-primary"
                            )}
                          />
                        )}
                        <span className={cn(done ? "text-foreground font-medium" : "text-muted-foreground")}>
                          {label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Stage 2: Detected Evidence */}
            <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-background p-4 lg:col-span-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Stage 2: Entity Evidence
                  </span>
                  <span className="text-[11px] text-muted-foreground">Entity Parser</span>
                </div>

                {showResult ? (
                  <div ref={evidenceRef} className="flex flex-col gap-2">
                    {example.evidence.map((row) => (
                      <div
                        key={row.term}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/40 p-2.5 text-xs shadow-2xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground">{row.term}</span>
                            <span className="rounded bg-secondary px-1.5 py-0.2 text-[10px] font-medium text-foreground border border-border/70">
                              {row.rank}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{row.confidence} confidence</span>
                        </div>
                        <span className="inline-flex items-center rounded-md border border-border/60 bg-card px-2 py-0.5 text-[10px] font-medium text-primary">
                          {row.sentiment}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
                    <Loader2 className="size-5 animate-spin text-primary mb-2" />
                    <p className="text-xs">Extracting entity mentions…</p>
                  </div>
                )}
              </div>

              <p className="mt-3 text-[10px] text-muted-foreground border-t border-border/60 pt-2">
                Parsed via regex tokenizer + multi-tenant LLM sentiment pipeline.
              </p>
            </div>

            {/* Stage 3: Visibility Score Output */}
            <div
              ref={scoreRef}
              className="flex flex-col justify-between rounded-xl border border-border/80 bg-secondary/60 p-4 lg:col-span-3 shadow-2xs"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Stage 3: Result
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                    <Sparkles className="size-3" />
                    Score
                  </span>
                </div>

                <div className="my-3 flex flex-col items-center justify-center rounded-lg border border-border/80 bg-card p-4 text-center shadow-xs">
                  <ScoreValue score={showResult ? example.score : 0} />
                  <span className="mt-1 text-[11px] font-medium text-muted-foreground">
                    Deterministic Visibility Index
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground text-center">
                  One score from mentions, ranking, sentiment and citations.
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 text-center">
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <span>See how it works</span>
                  <ChevronRight className="size-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
