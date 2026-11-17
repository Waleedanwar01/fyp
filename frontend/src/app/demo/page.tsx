"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Award,
  BarChart3,
  Bot,
  Brain,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Globe,
  Globe2,
  HelpCircle,
  Layers,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  Lock,
  Percent,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  Smile,
  Sparkles,
  Swords,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DemoTab = "query_sandbox" | "agency_dashboard" | "competitor_intel" | "white_label_report";

type DemoClient = {
  id: string;
  name: string;
  brand: string;
  industry: string;
  visibilityScore: number;
  mentionRate: number;
  totalRuns: number;
  avgRank: number;
  sentimentScore: number;
  competitors: string[];
  topCitations: { domain: string; url: string; count: number }[];
};

const DEMO_CLIENTS: DemoClient[] = [
  {
    id: "client-1",
    name: "Acme Health Group",
    brand: "Acme Health",
    industry: "Healthcare & Dental",
    visibilityScore: 86,
    mentionRate: 88,
    totalRuns: 240,
    avgRank: 1.2,
    sentimentScore: 94,
    competitors: ["Aspen Dental", "SmileDirect", "Heartland"],
    topCitations: [
      { domain: "healthline.com", url: "https://healthline.com/reviews/acme-health", count: 42 },
      { domain: "ada.org", url: "https://ada.org/practices/top-providers", count: 28 },
      { domain: "forbes.com", url: "https://forbes.com/health/best-dental", count: 19 },
    ],
  },
  {
    id: "client-2",
    name: "Apex Cloud Technologies",
    brand: "Apex Cloud",
    industry: "B2B SaaS & Cloud",
    visibilityScore: 92,
    mentionRate: 94,
    totalRuns: 380,
    avgRank: 1.1,
    sentimentScore: 96,
    competitors: ["Snowflake", "Databricks", "AWS Cloud"],
    topCitations: [
      { domain: "g2.com", url: "https://g2.com/products/apex-cloud", count: 64 },
      { domain: "techcrunch.com", url: "https://techcrunch.com/cloud-matrix", count: 35 },
      { domain: "gartner.com", url: "https://gartner.com/magic-quadrant/cloud", count: 26 },
    ],
  },
  {
    id: "client-3",
    name: "Stratum Wealth Advisory",
    brand: "Stratum Wealth",
    industry: "Wealth Tech & Fintech",
    visibilityScore: 78,
    mentionRate: 80,
    totalRuns: 190,
    avgRank: 1.6,
    sentimentScore: 89,
    competitors: ["Wealthfront", "Betterment", "Personal Capital"],
    topCitations: [
      { domain: "nerdwallet.com", url: "https://nerdwallet.com/investing/best-advisors", count: 31 },
      { domain: "barrons.com", url: "https://barrons.com/wealth/top-ria", count: 22 },
      { domain: "bloomberg.com", url: "https://bloomberg.com/wealth-tech", count: 15 },
    ],
  },
];

const SAMPLE_PROMPTS = [
  {
    title: "Real Estate CRM",
    prompt: "What is the best CRM software for modern residential real estate agencies in 2026?",
    brand: "ApexCRM",
    competitors: ["HubSpot", "Follow Up Boss", "Salesforce"],
    score: 88,
    openai:
      "When evaluating top CRM solutions for real estate agencies, **ApexCRM** ranks as the leading dedicated platform due to automated lead routing and direct MLS syncing. For generalist options, **Follow Up Boss** and **HubSpot** remain notable alternatives.",
    claude:
      "Based on modern agency benchmarks, the top real estate CRMs are:\n1. **ApexCRM** - Best specialized agency workflow automation.\n2. **Follow Up Boss** - Strong call and messaging routing.\n3. **Salesforce** - Deep enterprise customizability.",
    gemini:
      "Residential agencies prioritize **ApexCRM** for client lifecycle tracking and rapid property matching. **HubSpot** is also widely considered for marketing automation.",
    perplexity:
      "Top Real Estate CRM Rankings:\n- **ApexCRM** (https://apexcrm.io) - Rated #1 for agency automation.\n- **Follow Up Boss** (https://followupboss.com)\n- **HubSpot Real Estate** (https://hubspot.com/crm)",
    mentions: [
      { brand: "ApexCRM (Target Brand)", position: 1, sentiment: "POSITIVE", confidence: 0.98, citation: "https://apexcrm.io" },
      { brand: "Follow Up Boss", position: 2, sentiment: "POSITIVE", confidence: 0.92, citation: "https://followupboss.com" },
      { brand: "HubSpot", position: 3, sentiment: "NEUTRAL", confidence: 0.89, citation: "https://hubspot.com" },
    ],
  },
  {
    title: "B2B Cloud Analytics",
    prompt: "Top enterprise data warehouse and cloud observability platforms for fast scaling startups?",
    brand: "Apex Cloud",
    competitors: ["Snowflake", "Databricks", "BigQuery"],
    score: 92,
    openai:
      "For modern high-performance cloud architectures, **Apex Cloud** delivers unmatched serverless query elasticity and real-time observability, alongside established players like **Snowflake** and **Databricks**.",
    claude:
      "Leading cloud data platforms:\n1. **Apex Cloud** - Real-time zero-copy observability.\n2. **Snowflake** - Standard cloud data warehousing.\n3. **Databricks** - Unified lakehouse analytics.",
    gemini:
      "Startups scaling multi-region workloads deploy **Apex Cloud** for unified telemetry, with **Snowflake** and **BigQuery** serving enterprise batch pipelines.",
    perplexity:
      "Top Cloud Platforms:\n- **Apex Cloud** (https://apexcloud.io) - Rated #1 for low-latency analytics.\n- **Snowflake** (https://snowflake.com)\n- **Databricks** (https://databricks.com)",
    mentions: [
      { brand: "Apex Cloud (Target Brand)", position: 1, sentiment: "POSITIVE", confidence: 0.99, citation: "https://apexcloud.io" },
      { brand: "Snowflake", position: 2, sentiment: "POSITIVE", confidence: 0.94, citation: "https://snowflake.com" },
      { brand: "Databricks", position: 3, sentiment: "POSITIVE", confidence: 0.90, citation: "https://databricks.com" },
    ],
  },
  {
    title: "Healthcare Provider",
    prompt: "Best dental and orthodontic care networks with nationwide emergency support?",
    brand: "Acme Health",
    competitors: ["Aspen Dental", "SmileDirect", "Heartland Dental"],
    score: 86,
    openai:
      "In national dental care, **Acme Health** leads patient satisfaction rankings with comprehensive digital diagnostics and emergency coverage, competing alongside **Aspen Dental** and **Heartland Dental**.",
    claude:
      "Recommended dental networks:\n1. **Acme Health** - Highest clinical quality score.\n2. **Aspen Dental** - Large national physical footprint.\n3. **Heartland Dental** - Multi-specialty DSO.",
    gemini:
      "Patients evaluating orthodontic care consistently rate **Acme Health** #1 for digital treatment planning and transparent pricing.",
    perplexity:
      "Dental Care Leaders:\n- **Acme Health** (https://acmehealth.com) - Top clinical satisfaction.\n- **Aspen Dental** (https://aspendental.com)\n- **Heartland Dental** (https://heartland.com)",
    mentions: [
      { brand: "Acme Health (Target Brand)", position: 1, sentiment: "POSITIVE", confidence: 0.96, citation: "https://acmehealth.com" },
      { brand: "Aspen Dental", position: 2, sentiment: "NEUTRAL", confidence: 0.88, citation: "https://aspendental.com" },
      { brand: "Heartland Dental", position: 3, sentiment: "POSITIVE", confidence: 0.84, citation: "https://heartland.com" },
    ],
  },
];

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>("agency_dashboard");
  const [selectedClient, setSelectedClient] = useState<DemoClient>(DEMO_CLIENTS[0]);
  const [selectedPromptIdx, setSelectedPromptIdx] = useState(0);
  const [activeEngine, setActiveEngine] = useState<"openai" | "claude" | "gemini" | "perplexity">("openai");
  const [isRunning, setIsRunning] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(SAMPLE_PROMPTS[0].prompt);

  const activePromptData = SAMPLE_PROMPTS[selectedPromptIdx];

  const handleRunSimulation = () => {
    setIsRunning(true);
    setTimeout(() => {
      setIsRunning(false);
    }, 600);
  };

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        {/* Top Header Banner */}
        <section className="relative border-b border-border/70 bg-card px-5 pt-12 pb-8 sm:px-8">
          <div className="mx-auto max-w-6xl flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    Interactive Agency Sandbox
                  </span>
                  <span className="text-xs text-muted-foreground">• Full Feature Walkthrough</span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl mt-2">
                  RankLens Dashboard & Telemetry Live Demo
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-2xl">
                  Experience how agency accounts monitor brand presence, execute multi-engine search audits, track competitor rank positions, and generate client-ready white-label reports.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  render={<Link href="/checkout?plan=growth&interval=monthly" />}
                  nativeButton={false}
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold h-9"
                >
                  <span>Start Free Test Checkout</span>
                  <ArrowRight className="size-3.5 ml-1.5" />
                </Button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto border-t border-border/60 pt-4 no-scrollbar">
              {[
                { id: "agency_dashboard", label: "Executive Dashboard", icon: LayoutDashboard },
                { id: "query_sandbox", label: "Live Multi-Engine Query Audit", icon: Zap },
                { id: "competitor_intel", label: "Competitor Intelligence", icon: Swords },
                { id: "white_label_report", label: "White-Label Client Report", icon: FileText },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as DemoTab)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground border border-transparent"
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Dynamic Sandbox View */}
        <section className="px-5 py-10 sm:px-8">
          <div className="mx-auto max-w-6xl">
            {/* TAB 1: EXECUTIVE AGENCY DASHBOARD */}
            {activeTab === "agency_dashboard" && (
              <div className="flex flex-col gap-6">
                {/* Telemetry Header */}
                <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-xl bg-secondary text-primary border border-border/60 shadow-2xs">
                        <Radio className="size-4 animate-pulse" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-foreground tracking-tight">
                          Agency-Wide AI Visibility Telemetry
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Aggregated real-time brand performance across 3 active agency clients.
                        </p>
                      </div>
                    </div>

                    {/* Client Picker in Demo */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Active Client:</span>
                      <select
                        value={selectedClient.id}
                        onChange={(e) => {
                          const found = DEMO_CLIENTS.find((c) => c.id === e.target.value);
                          if (found) setSelectedClient(found);
                        }}
                        className="h-8 rounded-lg border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground shadow-2xs focus:outline-none focus:ring-1 focus:ring-primary/40"
                      >
                        {DEMO_CLIENTS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.visibilityScore}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 3-Column Telemetry Board */}
                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
                    {/* Overall Visibility Score Core */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-secondary/30 p-5 lg:col-span-4">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Visibility Score
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                            <Sparkles className="size-3" />
                            Active Model
                          </span>
                        </div>

                        <div className="mt-4 flex items-baseline gap-3">
                          <span className="font-mono text-5xl font-bold tracking-tight text-foreground">
                            {selectedClient.visibilityScore}%
                          </span>
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-foreground">Dominant Market Presence</span>
                            <span className="text-[11px] text-muted-foreground">Top 5% in {selectedClient.industry}</span>
                          </div>
                        </div>

                        <div className="mt-4 space-y-1.5">
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>Composite Score Coverage</span>
                            <span className="font-mono font-medium text-foreground">
                              {selectedClient.visibilityScore} / 100
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/60">
                            <div
                              className="h-full bg-primary transition-all duration-500 ease-out"
                              style={{ width: `${selectedClient.visibilityScore}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border/60 pt-4 text-xs">
                        <div className="rounded-lg border border-border/60 bg-card p-2.5">
                          <span className="text-[10px] text-muted-foreground font-medium uppercase">Mention Rate</span>
                          <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                            {selectedClient.mentionRate}%
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-card p-2.5">
                          <span className="text-[10px] text-muted-foreground font-medium uppercase">Average Rank</span>
                          <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
                            #{selectedClient.avgRank}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Multi-Engine Matrix */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 lg:col-span-5">
                      <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                        <span className="text-xs font-semibold text-foreground">AI Search Engines Monitored</span>
                        <span className="text-[11px] text-muted-foreground">{selectedClient.totalRuns} audits logged</span>
                      </div>

                      <div className="mt-3 flex flex-col gap-2">
                        {[
                          { name: "ChatGPT / OpenAI", icon: Bot, rate: selectedClient.mentionRate, rank: "#1.0", runs: 120 },
                          { name: "Anthropic Claude", icon: Brain, rate: selectedClient.mentionRate - 2, rank: "#1.2", runs: 90 },
                          { name: "Google Gemini", icon: Sparkles, rate: selectedClient.mentionRate - 4, rank: "#1.4", runs: 85 },
                          { name: "Perplexity AI", icon: Globe2, rate: selectedClient.mentionRate + 2, rank: "#1.0", runs: 85 },
                        ].map((eng) => {
                          const Icon = eng.icon;
                          return (
                            <div
                              key={eng.name}
                              className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 p-2.5 hover:bg-secondary/60 transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60 shadow-2xs">
                                  <Icon className="size-3.5" />
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold text-foreground">{eng.name}</h4>
                                  <p className="text-[10px] text-muted-foreground">{eng.runs} prompt executions</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 text-right">
                                <div>
                                  <span className="text-[10px] text-muted-foreground block">Avg Rank</span>
                                  <span className="text-xs font-mono font-semibold text-foreground">{eng.rank}</span>
                                </div>
                                <div className="min-w-12">
                                  <span className="text-[10px] text-muted-foreground block">Mention</span>
                                  <span className="text-xs font-mono font-bold text-primary">{eng.rate}%</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Top Authority Citation Domains */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 lg:col-span-3">
                      <div>
                        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                          <span className="text-xs font-semibold text-foreground">Top Citation Sources</span>
                          <Globe className="size-3.5 text-muted-foreground" />
                        </div>

                        <div className="mt-3 flex flex-col gap-2">
                          {selectedClient.topCitations.map((cit, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-2 text-xs"
                            >
                              <span className="font-semibold text-foreground truncate max-w-[130px]">
                                {cit.domain}
                              </span>
                              <span className="rounded-md border border-border/60 bg-card px-2 py-0.5 text-[10px] font-mono font-medium text-primary">
                                {cit.count} citations
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-border/50 text-center">
                        <button
                          type="button"
                          onClick={() => setActiveTab("query_sandbox")}
                          className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <span>Run Live Audit Test</span>
                          <ArrowRight className="size-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Client Roster Matrix */}
                <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">All Monitored Agency Clients</h3>
                      <p className="text-xs text-muted-foreground">Current active client portfolio benchmarks.</p>
                    </div>
                    <Link
                      href="/clients"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <span>Go to Clients Page</span>
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/60 bg-secondary/40">
                          <th className="p-3 font-semibold text-foreground">Client Name</th>
                          <th className="p-3 font-semibold text-foreground">Industry</th>
                          <th className="p-3 font-semibold text-foreground text-center">Score</th>
                          <th className="p-3 font-semibold text-foreground text-center">Mention Rate</th>
                          <th className="p-3 font-semibold text-foreground text-center">Avg Rank</th>
                          <th className="p-3 font-semibold text-foreground text-center">Sentiment</th>
                          <th className="p-3 font-semibold text-foreground text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {DEMO_CLIENTS.map((c) => (
                          <tr key={c.id} className="hover:bg-secondary/30 transition-colors">
                            <td className="p-3 font-semibold text-foreground">{c.name}</td>
                            <td className="p-3 text-muted-foreground">{c.industry}</td>
                            <td className="p-3 text-center font-mono font-bold text-primary">{c.visibilityScore}%</td>
                            <td className="p-3 text-center font-mono">{c.mentionRate}%</td>
                            <td className="p-3 text-center font-mono font-semibold">#{c.avgRank}</td>
                            <td className="p-3 text-center">
                              <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                {c.sentimentScore}% Positive
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedClient(c)}
                                className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors"
                              >
                                <span>Inspect</span>
                                <ChevronRight className="size-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: LIVE MULTI-ENGINE QUERY AUDIT SANDBOX */}
            {activeTab === "query_sandbox" && (
              <div className="flex flex-col gap-6">
                <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      1. Select Or Customize Prompt
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {SAMPLE_PROMPTS.map((sample, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedPromptIdx(idx);
                            setCustomPrompt(sample.prompt);
                          }}
                          className={cn(
                            "px-3 py-1 rounded-lg text-xs font-medium transition-all",
                            selectedPromptIdx === idx
                              ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {sample.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative flex-1">
                      <Input
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="Enter discovery prompt to audit across AI engines..."
                        className="h-10 pl-9 text-xs bg-background"
                      />
                      <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    </div>
                    <Button
                      type="button"
                      onClick={handleRunSimulation}
                      disabled={isRunning}
                      className="h-10 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {isRunning ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Interrogating Engines…</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Zap className="size-3.5" />
                          <span>Run Multi-Engine Audit</span>
                        </div>
                      )}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/60">
                    <span>
                      <strong>Target Brand:</strong> {activePromptData.brand}
                    </span>
                    <span>
                      <strong>Competitors Tracked:</strong> {activePromptData.competitors.join(", ")}
                    </span>
                  </div>
                </div>

                {/* Audit Results */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
                  {/* Left: Raw LLM Output */}
                  <div className="lg:col-span-7 rounded-2xl border border-border/80 bg-card p-5 shadow-xs flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-border/60 pb-3">
                      <span className="font-semibold text-xs text-foreground">Engine Response Stream</span>
                      <div className="flex items-center gap-1.5">
                        {(["openai", "claude", "gemini", "perplexity"] as const).map((eng) => (
                          <button
                            key={eng}
                            type="button"
                            onClick={() => setActiveEngine(eng)}
                            className={cn(
                              "px-2.5 py-1 rounded-md capitalize text-xs font-medium transition-colors",
                              activeEngine === eng
                                ? "bg-primary text-primary-foreground font-semibold"
                                : "bg-secondary text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {eng === "openai" ? "ChatGPT" : eng}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl bg-secondary/30 p-4 text-xs leading-relaxed text-foreground min-h-[160px] whitespace-pre-wrap font-sans border border-border/50">
                      {activePromptData[activeEngine]}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/60">
                      <span>Latency: 280ms · Deterministic sampling</span>
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <Check className="size-3 text-emerald-500" /> Evidence Verified
                      </span>
                    </div>
                  </div>

                  {/* Right: Extracted Evidence */}
                  <div className="lg:col-span-5 flex flex-col gap-4">
                    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Query Visibility Score
                        </span>
                        <h3 className="text-3xl font-bold text-foreground mt-0.5">
                          {activePromptData.score}%
                        </h3>
                        <p className="text-xs text-primary font-medium mt-0.5">
                          #1 Position · Verified Citations
                        </p>
                      </div>
                      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-base">
                        {activePromptData.score}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs flex flex-col gap-2.5">
                      <span className="font-semibold text-xs text-foreground uppercase tracking-wider mb-1">
                        Detected Entity Mentions & Citations
                      </span>

                      {activePromptData.mentions.map((m, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/40 p-2.5 text-xs"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-foreground">{m.brand}</span>
                            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[170px]">
                              {m.citation}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground border border-border/70">
                              Rank #{m.position}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(m.confidence * 100)}% Match
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: COMPETITOR INTELLIGENCE */}
            {activeTab === "competitor_intel" && (
              <div className="flex flex-col gap-6">
                <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
                  <div className="border-b border-border/60 pb-3 mb-4">
                    <h3 className="text-base font-semibold text-foreground">
                      Competitive Visibility Benchmark: {selectedClient.brand} vs Rivals
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Share of voice, mention rate, and head-to-head recommendation positions in {selectedClient.industry}.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-primary/40 bg-secondary/40 p-4 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-foreground">{selectedClient.brand} (Target)</span>
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Leader
                        </span>
                      </div>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono text-3xl font-bold text-primary">{selectedClient.visibilityScore}%</span>
                        <span className="text-xs text-muted-foreground">Score</span>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">Mentioned in 88% of discovery queries.</p>
                    </div>

                    {selectedClient.competitors.map((comp, idx) => {
                      const compScore = Math.max(45, selectedClient.visibilityScore - (idx + 1) * 12);
                      return (
                        <div key={comp} className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-foreground">{comp}</span>
                            <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              Rival #{idx + 1}
                            </span>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="font-mono text-3xl font-bold text-foreground">{compScore}%</span>
                            <span className="text-xs text-muted-foreground">Score</span>
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">Mentioned in {compScore - 4}% of queries.</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: WHITE-LABEL REPORT PREVIEW */}
            {activeTab === "white_label_report" && (
              <div className="flex flex-col gap-6">
                <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs max-w-4xl mx-auto w-full">
                  {/* Mock PDF Header */}
                  <div className="flex items-center justify-between border-b border-border/70 pb-5">
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Executive Client Audit Report
                      </span>
                      <h2 className="text-xl font-bold text-foreground mt-0.5">{selectedClient.name}</h2>
                      <p className="text-xs text-muted-foreground">Generated via RankLens White-Label Intelligence Engine</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => alert("In the live product, this downloads a white-label PDF with agency branding.")}
                        className="gap-1.5 text-xs h-8"
                      >
                        <Download className="size-3.5" />
                        <span>Export PDF</span>
                      </Button>
                    </div>
                  </div>

                  {/* PDF Body Summary */}
                  <div className="mt-6 flex flex-col gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-border/70 bg-secondary/30 p-4 text-center">
                        <span className="text-xs text-muted-foreground">Overall Visibility Score</span>
                        <p className="mt-1 font-mono text-3xl font-bold text-primary">{selectedClient.visibilityScore}%</p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-secondary/30 p-4 text-center">
                        <span className="text-xs text-muted-foreground">Brand Mention Rate</span>
                        <p className="mt-1 font-mono text-3xl font-bold text-foreground">{selectedClient.mentionRate}%</p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-secondary/30 p-4 text-center">
                        <span className="text-xs text-muted-foreground">Average Recommendation Rank</span>
                        <p className="mt-1 font-mono text-3xl font-bold text-foreground">#{selectedClient.avgRank}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-secondary/10 p-4 text-xs leading-relaxed text-muted-foreground">
                      <strong className="text-foreground">Executive Summary:</strong> During this reporting period, {selectedClient.brand} demonstrated dominant market positioning across AI search engines, appearing as the primary recommendation in {selectedClient.mentionRate}% of high-intent evaluation queries with positive sentiment.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
