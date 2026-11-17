"use client";

import Link from "next/link";
import {
  Sparkles,
  ShieldCheck,
  Building2,
  Users,
  Target,
  ArrowRight,
  Globe2,
  Zap,
  CheckCircle2,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { useScrollReveal } from "@/lib/animations";

const VALUES = [
  {
    title: "Truth Over Vanity Metrics",
    description:
      "Legacy SEO platforms rely on estimated keywords and scrapers. RankLens is committed to 100% verifiable ground-truth evidence directly from official AI model APIs.",
  },
  {
    title: "Agency-First Architecture",
    description:
      "We build specifically for digital marketing agencies managing complex rosters. From multi-tenant isolation to white-label reporting, agencies are in our DNA.",
  },
  {
    title: "Multi-Engine Neutrality",
    description:
      "We don't favor one AI ecosystem over another. We provide balanced, simultaneous coverage across OpenAI, Anthropic, Google Gemini, and Perplexity AI.",
  },
  {
    title: "Uncompromising Privacy & Security",
    description:
      "Every client brand, scheduled prompt, and generated report is isolated with database-level PostgreSQL Row-Level Security (RLS).",
  },
];

export default function AboutPage() {
  const revealRef = useScrollReveal<HTMLDivElement>();

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28 text-center">
          <div className="mx-auto max-w-4xl flex flex-col items-center gap-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              <span>Pioneering Generative Engine Optimization (GEO)</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl text-balance">
              Quantifying Brand Presence in the Era of AI Search
            </h1>

            <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
              RankLens empowers marketing and PR agencies with deterministic, verifiable AI visibility intelligence
              across the world&apos;s leading neural models.
            </p>
          </div>
        </section>

        {/* Mission & Story */}
        <section className="px-5 pb-20 sm:px-8">
          <div ref={revealRef} className="mx-auto max-w-5xl flex flex-col gap-12">
            <div className="grid grid-cols-1 gap-8 rounded-3xl border border-border bg-card p-8 sm:p-12 shadow-xs md:grid-cols-2 md:items-center">
              <div className="flex flex-col gap-4">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Our Mission</span>
                <h2 className="text-2xl font-bold sm:text-3xl">Why We Built RankLens</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Search is experiencing its greatest paradigm shift in three decades. As millions of consumers and
                  B2B decision-makers transition from Google search to conversational assistants like ChatGPT,
                  Claude, and Perplexity, traditional keyword rankings no longer tell the whole story.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  RankLens was engineered to give agencies transparent, audit-ready data: showing exactly where their
                  clients appear, which sources are cited, and how their brand sentiment compares against rivals.
                </p>
              </div>

              <div className="rounded-2xl bg-secondary/40 border border-border/80 p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3 text-sm font-semibold">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Globe2 className="size-4" />
                  </span>
                  <span>The Shift from SEO to GEO</span>
                </div>
                <div className="flex flex-col gap-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <span>Traditional Search: Links and keyword densities</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <span>AI Generative Search: Direct syntheses, citations, and entity rankings</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <span>RankLens Solution: Traceable Visibility Scoring across all models</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Core Values */}
            <div className="flex flex-col gap-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold sm:text-3xl">Core Agency Principles</h2>
                <p className="text-xs text-muted-foreground mt-1">What guides our product decisions every day</p>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {VALUES.map((val, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-2.5"
                  >
                    <h3 className="text-lg font-bold text-foreground">{val.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{val.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border px-5 py-16 sm:px-8 text-center bg-card">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold sm:text-3xl">Join forward-thinking agencies using RankLens</h2>
            <p className="text-sm text-muted-foreground max-w-lg">
              Experience the platform in test mode with 1-click bypass and full credit provisioning.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Button render={<Link href="/checkout?plan=growth&interval=monthly" />} nativeButton={false} size="lg">
                Start Tracking Today
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button render={<Link href="/contact" />} nativeButton={false} variant="outline" size="lg">
                Contact Our Team
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
