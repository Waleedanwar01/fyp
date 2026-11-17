"use client";

import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Layers,
  Search,
  Cpu,
  CheckCircle2,
  TrendingUp,
  FileText,
  ShieldCheck,
  Bot,
  ExternalLink,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { useScrollReveal } from "@/lib/animations";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    step: "01",
    title: "Define Clients, Brands & Competitors",
    subtitle: "Tenant-isolated workspace configuration",
    description:
      "Create client profiles within your agency account. Specify the exact target brand names, product variants, competitor entities, location tags, and service categories you want to monitor.",
    details: [
      "Multi-entity tracking per client (Primary brand + up to unlimited competitors)",
      "Location-specific tags (e.g., 'New York', 'London', 'National')",
      "Custom search prompt libraries customized for high-value buyer intents",
    ],
    sampleCode: `{
  "client": "Apex Wealth Advisory",
  "brands": ["Apex Wealth", "Apex Private Wealth"],
  "competitors": ["Vanguard", "Fidelity", "Beacon Capital"],
  "prompts": ["Who is the best wealth manager for tech executives?"]
}`,
  },
  {
    step: "02",
    title: "Autonomous Multi-Engine AI Querying",
    subtitle: "Parallel API execution across 4+ neural providers",
    description:
      "RankLens dispatches your prompts automatically to official AI provider APIs under realistic search conditions. We query ChatGPT Search (GPT-4o), Anthropic Claude 3.5 Sonnet, Google Gemini 1.5 Pro, and Perplexity AI concurrently.",
    details: [
      "Synchronous and scheduled automated prompt execution",
      "Full raw response capture with timestamp and temperature metadata",
      "Quota-safe rate limiting and credit deduction with rollback on failure",
    ],
    sampleCode: `// Multi-Engine Parallel Query Dispatch
const runs = await Promise.all([
  queryOpenAI({ prompt, model: "gpt-4o" }),
  queryClaude({ prompt, model: "claude-3-5-sonnet" }),
  queryGemini({ prompt, model: "gemini-1.5-pro" }),
  queryPerplexity({ prompt, model: "sonar-pro" })
]);`,
  },
  {
    step: "03",
    title: "Evidence Extraction & Citation Matching",
    subtitle: "Disambiguation, position rank & sentiment parsing",
    description:
      "Our extraction engine parses each model's response to detect exact brand mentions, position order (e.g. 1st recommendation vs 4th recommendation), sentiment context, and extracted citation URLs.",
    details: [
      "Exact & fuzzy entity matching to eliminate false positives",
      "Citation source domain extraction with protocol and URL normalization",
      "Sentiment scoring (Positive, Neutral, Negative) with confidence metric",
    ],
    sampleCode: `{
  "entity": "Apex Wealth",
  "position_rank": 1,
  "sentiment": "POSITIVE",
  "confidence": 0.94,
  "citations": ["https://apexwealth.com", "https://forbes.com/top-advisors"]
}`,
  },
  {
    step: "04",
    title: "Traceable Visibility Score & Reports",
    subtitle: "Deterministic scoring with verifiable audit trails",
    description:
      "The RankLens Visibility Score is calculated from real prompt executions over time. Never an arbitrary vanity metric: every number links directly to the exact AI response that created it.",
    details: [
      "Aggregate visibility percentage calculated across all monitored engines",
      "Competitor share of voice comparison graphs",
      "One-click client reporting links and downloadable PDF executive briefs",
    ],
    sampleCode: `Visibility Score = WeightedSum(
  MentionPresence * 0.4 +
  RankPositionBonus * 0.3 +
  SentimentFactor * 0.2 +
  CitationDomainPresence * 0.1
) => 87.5 / 100`,
  },
];

export default function HowItWorksPage() {
  const revealRef = useScrollReveal<HTMLDivElement>();

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              <span>Step-by-Step Architecture</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl max-w-4xl text-balance">
              How RankLens Tracks & Quantifies AI Visibility
            </h1>

            <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
              A transparent, deterministic four-step pipeline that transforms generative AI responses into
              verifiable agency intelligence.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <Button render={<Link href="/demo" />} nativeButton={false} size="lg">
                Try Interactive Sandbox
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button render={<Link href="/checkout?plan=growth&interval=monthly" />} nativeButton={false} variant="outline" size="lg">
                Create Agency Account
              </Button>
            </div>
          </div>
        </section>

        {/* 4-Step Interactive Process */}
        <section className="px-5 pb-24 sm:px-8">
          <div ref={revealRef} className="mx-auto max-w-5xl flex flex-col gap-12">
            {STEPS.map((step, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 gap-8 rounded-3xl border border-border bg-card p-8 shadow-xs lg:grid-cols-12 lg:items-center"
              >
                {/* Text explanation */}
                <div className="lg:col-span-7 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base font-extrabold text-primary-foreground">
                      {step.step}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      {step.subtitle}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold">{step.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>

                  <ul className="flex flex-col gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                    {step.details.map((detail, dIdx) => (
                      <li key={dIdx} className="flex items-start gap-2">
                        <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Simulated Code / Data Box */}
                <div className="lg:col-span-5 rounded-2xl bg-secondary/50 border border-border/70 p-4 font-mono text-xs overflow-x-auto shadow-inner">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-3 text-[11px] text-muted-foreground">
                    <span>Pipeline Step {step.step} Data Flow</span>
                    <span className="flex size-2 rounded-full bg-emerald-500" />
                  </div>
                  <pre className="text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {step.sampleCode}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t border-border px-5 py-16 sm:px-8 text-center bg-card">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold sm:text-3xl">See the pipeline in action with real AI runs</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              Test queries in our live sandbox or launch your agency workspace with instant test mode checkout.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Button render={<Link href="/demo" />} nativeButton={false} size="lg">
                Open Live Demo
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button render={<Link href="/pricing" />} nativeButton={false} variant="outline" size="lg">
                View Pricing
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
