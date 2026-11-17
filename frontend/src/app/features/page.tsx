"use client";

import Link from "next/link";
import {
  Sparkles,
  Bot,
  Search,
  ShieldCheck,
  Zap,
  BarChart3,
  Globe,
  Clock,
  Layers,
  ArrowRight,
  CheckCircle2,
  Lock,
  Cpu,
  FileCheck,
  TrendingUp,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { useScrollReveal } from "@/lib/animations";
import { cn } from "@/lib/utils";

const CORE_CAPABILITIES = [
  {
    icon: Bot,
    title: "Multi-Engine AI Coverage",
    badge: "Omni-Provider",
    description:
      "Query all major generative AI engines concurrently under real search conditions. Track how clients surface in ChatGPT Search, Claude 3.5 Sonnet, Google Gemini 1.5 Pro, and Perplexity AI.",
    bullets: [
      "Simultaneous execution across 4 leading LLM architectures",
      "Real-time citation and markdown link extraction",
      "Dynamic prompt variations and localized query tags",
    ],
    highlight: "4+ Major AI Providers",
  },
  {
    icon: Search,
    title: "Traceable Citation & Evidence Trail",
    badge: "Zero Black-Box",
    description:
      "Every single Visibility Score is backed by verifiable ground-truth evidence. View the exact raw prompt response, citation URLs, sentiment tags, and recommendation ranking.",
    bullets: [
      "Exact source domain extraction and link validation",
      "Audit trail preserved for agency client transparency",
      "Mention order and ranking position detection",
    ],
    highlight: "100% Verifiable Evidence",
  },
  {
    icon: TrendingUp,
    title: "Sentiment & Positioning Analysis",
    badge: "Deep NLP",
    description:
      "Determine whether AI models recommend, compare, or criticize client brands. Automatic classification into Positive, Neutral, or Negative sentiment with confidence scores.",
    bullets: [
      "Multi-entity disambiguation (Brands vs Competitors)",
      "Confidence scoring with manual review flagging",
      "Comparative competitor share of voice analytics",
    ],
    highlight: "Sentiment & Share of Voice",
  },
  {
    icon: Clock,
    title: "Automated Scheduling & Rollover Credits",
    badge: "Autonomous",
    description:
      "Put your agency's AI visibility tracking on autopilot. Run queries daily, weekly, or custom intervals with guaranteed idempotency and credit rollover safety.",
    bullets: [
      "Predictive usage estimator prevents over-quota schedule failure",
      "Unused included prompt runs roll over to the next billing cycle",
      "Automated email notifications on sentiment dips or competitor surges",
    ],
    highlight: "Scheduled Runs & Rollover",
  },
  {
    icon: ShieldCheck,
    title: "Multi-Tenant Data Isolation & RLS",
    badge: "Enterprise Security",
    description:
      "Built from day one with strict PostgreSQL Row-Level Security (RLS) and scoped tenant isolation. Client data, schedules, and reports remain strictly private to your agency.",
    bullets: [
      "PostgreSQL RLS policies enforced directly at the database engine",
      "Granular agency roles: Agency Admin, Member, and Client Viewer",
      "Encrypted API keys and dedicated tenant schema boundaries",
    ],
    highlight: "PostgreSQL Row-Level Security",
  },
  {
    icon: FileCheck,
    title: "White-Label Agency Client Reports",
    badge: "Client-Ready",
    description:
      "Generate beautiful, branded executive reports showing visibility trends, top ranking AI prompts, citation domains, and competitor benchmarking.",
    bullets: [
      "Custom agency branding, logos, and report themes",
      "Interactive client view links with view-only permissions",
      "Exportable PDF summaries and raw CSV evidence logs",
    ],
    highlight: "Branded PDF & Web Reports",
  },
];

export default function FeaturesPage() {
  const revealRef1 = useScrollReveal<HTMLDivElement>();
  const revealRef2 = useScrollReveal<HTMLDivElement>();

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              <span>Comprehensive AI Visibility Platform</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl max-w-4xl text-balance">
              The Architecture Behind Modern AI Search Optimization
            </h1>

            <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
              Everything your marketing agency needs to track, analyze, and optimize client presence across
              ChatGPT, Claude, Gemini, and Perplexity.
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Button render={<Link href="/checkout?plan=growth&interval=monthly" />} nativeButton={false} size="lg">
                Start Tracking Now
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button render={<Link href="/demo" />} nativeButton={false} variant="outline" size="lg">
                Try Interactive Demo
              </Button>
            </div>
          </div>
        </section>

        {/* Feature Grid with Scroll Reveal */}
        <section className="px-5 pb-24 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <div ref={revealRef1} className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {CORE_CAPABILITIES.map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={idx}
                    className="flex flex-col justify-between rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-300 hover:shadow-md hover:-translate-y-1"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="size-6" />
                        </span>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {feature.badge}
                        </span>
                      </div>

                      <div>
                        <h2 className="text-xl font-bold">{feature.title}</h2>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {feature.description}
                        </p>
                      </div>

                      <ul className="mt-2 flex flex-col gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                        {feature.bullets.map((bullet, bIdx) => (
                          <li key={bIdx} className="flex items-start gap-2">
                            <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-6 pt-3 border-t border-border/60">
                      <span className="text-[11px] font-semibold text-primary">{feature.highlight}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Interactive Architecture Highlight Banner */}
        <section className="border-t border-border bg-secondary/30 px-5 py-20 sm:px-8">
          <div ref={revealRef2} className="mx-auto max-w-5xl flex flex-col gap-10">
            <div className="text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Built For Digital Marketing Agencies
              </span>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
                How RankLens Solves The Black-Box AI Problem
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-2xl mx-auto">
                Unlike legacy SEO tools that guess keyword rankings, RankLens directly interrogates the underlying
                neural providers and records every mention, citation URL, and context score with zero hallucinations.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-3">
                <span className="text-3xl font-extrabold text-primary">01</span>
                <h3 className="font-bold text-lg">Query Execution</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Real search prompts run against official provider APIs at scheduled times, simulating authentic
                  user search intent across target locations.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-3">
                <span className="text-3xl font-extrabold text-primary">02</span>
                <h3 className="font-bold text-lg">Evidence Traceability</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Full response texts are preserved permanently with NLP position rank tags, sentiment scores, and
                  extracted citation hyperlinks.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-3">
                <span className="text-3xl font-extrabold text-primary">03</span>
                <h3 className="font-bold text-lg">Client Reporting</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Clean, white-labeled visibility score trends prove your agency&apos;s impact to clients with
                  unambiguous, verifiable proof.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t border-border px-5 py-16 sm:px-8 text-center bg-card">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold sm:text-3xl">Ready to deliver verifiable AI tracking for your clients?</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              Choose your agency plan and start tracking multi-engine visibility in under two minutes with test mode bypass.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Button render={<Link href="/checkout?plan=growth&interval=monthly" />} nativeButton={false} size="lg">
                Get Started Now
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
              <Button render={<Link href="/pricing" />} nativeButton={false} variant="outline" size="lg">
                View All Plans
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
