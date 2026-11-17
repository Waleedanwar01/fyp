"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  Brain,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Layers,
  MapPin,
  Percent,
  Radio,
  Sparkles,
  Tag,
  TrendingUp,
  Zap,
} from "lucide-react";

import type { FullVisibilityEvidence } from "@/components/clients/use-brand-detail";
import type { PromptScheduleRecord } from "@/components/clients/schedules-dialog";
import { useCountUp } from "@/lib/animations";
import { cn, formatCompactNumber } from "@/lib/utils";
import { PROVIDER_LABELS } from "@/lib/providers";

const PROVIDER_ICONS: Record<string, typeof Bot> = {
  openai: Bot,
  gemini: Sparkles,
  perplexity: Globe2,
  claude: Brain,
};

function HeroScore({ score }: { score: number }) {
  const ref = useCountUp(score * 100, (n) => `${Math.round(n * 10) / 10}%`);
  return (
    <span ref={ref} className="font-mono text-4xl sm:text-5xl font-bold tracking-tight text-foreground tabular-nums">
      {`${Math.round(score * 1000) / 10}%`}
    </span>
  );
}

export function BrandDetailHero({
  clientName,
  industry,
  targetLocations = [],
  services = [],
  createdAt,
  score,
  promptsCount = 0,
  schedulesCount = 0,
  activeSchedule = null,
  onSelectTab,
  onOpenSchedule,
}: {
  clientName: string;
  industry?: string;
  targetLocations?: string[];
  services?: string[];
  createdAt?: string;
  score: FullVisibilityEvidence | null;
  promptsCount?: number;
  schedulesCount?: number;
  activeSchedule?: PromptScheduleRecord | null;
  onSelectTab?: (tabId: string) => void;
  onOpenSchedule?: () => void;
}) {
  const visibilityScore = score?.visibility_score ?? 0;
  const mentionRate = score?.components?.mention_rate ? Math.round(score.components.mention_rate * 100) : 0;
  const positionScore = score?.components?.position_score ? Math.round(score.components.position_score * 100) : 0;
  const sentimentScore = score?.components?.sentiment_score ? Math.round(score.components.sentiment_score * 100) : 0;
  const citationScore = score?.components?.citation_score ? Math.round(score.components.citation_score * 100) : 0;
  
  const totalRuns = score?.total_runs ?? 0;
  const runsWithMention = score?.runs_with_mention ?? 0;

  const startDateFormatted = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Initial Onboarding";

  // Compute per-provider breakdown
  const providerStats = useMemo(() => {
    const defaultProviders = [
      { key: "openai", label: "ChatGPT (OpenAI)" },
      { key: "gemini", label: "Google Gemini" },
      { key: "perplexity", label: "Perplexity AI" },
      { key: "claude", label: "Anthropic Claude" },
    ];

    if (!score?.prompt_runs || score.prompt_runs.length === 0) {
      return defaultProviders.map((p) => ({
        provider: p.key,
        label: p.label,
        rate: 0,
        total: 0,
        mentions: 0,
        hasData: false,
      }));
    }

    const map = new Map<string, { total: number; mentions: number }>();
    for (const r of score.prompt_runs) {
      const p = r.provider?.toLowerCase() || "openai";
      const cur = map.get(p) ?? { total: 0, mentions: 0 };
      cur.total += 1;
      if (r.mentioned) cur.mentions += 1;
      map.set(p, cur);
    }

    return defaultProviders.map((p) => {
      const stats = map.get(p.key) ?? { total: 0, mentions: 0 };
      return {
        provider: p.key,
        label: p.label,
        rate: stats.total > 0 ? Math.round((stats.mentions / stats.total) * 100) : 0,
        total: stats.total,
        mentions: stats.mentions,
        hasData: stats.total > 0,
      };
    });
  }, [score]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all">
      {/* Header Profile Info & Live Telemetry Badge */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
            <Radio className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                {clientName}
              </h1>
              {industry && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                  <Tag className="size-3 text-muted-foreground" />
                  <span>{industry}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                <Calendar className="size-3 text-primary" />
                <span>Tracked since: <strong className="text-foreground">{startDateFormatted}</strong></span>
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {targetLocations.length > 0 && (
                <div className="flex items-center gap-1 text-[11px]">
                  <MapPin className="size-3 text-emerald-600" />
                  <span>{targetLocations.join(", ")}</span>
                </div>
              )}
              {services.length > 0 && (
                <div className="flex items-center gap-1 text-[11px]">
                  <span>•</span>
                  <span>{services.slice(0, 3).join(", ")}{services.length > 3 ? ` +${services.length - 3}` : ""}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status & Automated Schedule indicators */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          {activeSchedule ? (
            <button
              type="button"
              onClick={() => onSelectTab ? onSelectTab("schedules") : onOpenSchedule?.()}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary font-mono hover:bg-primary/20 transition-all cursor-pointer shadow-2xs"
              title="Click to view scheduled audit details"
            >
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              <span>
                Schedule: {activeSchedule.frequency === "daily" ? "Daily" : activeSchedule.frequency} ({activeSchedule.run_time || "09:00"} {activeSchedule.timezone || "PKT"})
              </span>
            </button>
          ) : schedulesCount > 0 ? (
            <button
              type="button"
              onClick={() => onSelectTab ? onSelectTab("schedules") : onOpenSchedule?.()}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 font-mono hover:bg-amber-500/20 transition-all cursor-pointer"
            >
              <CalendarClock className="size-3 text-amber-500" />
              <span>{schedulesCount} Schedules (Paused)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenSchedule?.()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all cursor-pointer shadow-2xs"
            >
              <CalendarClock className="size-3 text-primary" />
              <span>+ Set Audit Schedule</span>
            </button>
          )}

          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/80 px-3 py-1 text-xs font-medium text-foreground">
            <span className={cn("size-2 rounded-full", totalRuns > 0 ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
            <span>{totalRuns > 0 ? "Active Telemetry" : "Awaiting Audits"}</span>
          </div>
        </div>
      </div>

      {/* Main KPI Analytics Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column: Composite AI Visibility Score */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-secondary/20 p-4 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Composite AI Visibility
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                <Sparkles className="size-3" />
                <span>GEO Intelligence Index</span>
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-3">
              <HeroScore score={visibilityScore} />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">
                  {visibilityScore >= 0.7
                    ? "Dominant Market Presence"
                    : visibilityScore >= 0.4
                    ? "Active Competitive Position"
                    : totalRuns > 0
                    ? "Emerging Visibility"
                    : "Baseline (No Audits Yet)"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {runsWithMention} of {totalRuns} prompt queries cited brand
                </span>
              </div>
            </div>

            {/* Score Component Distribution Bar */}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Signal breakdown</span>
                <span className="font-mono font-semibold text-foreground">
                  {Math.round(visibilityScore * 100)} / 100 pts
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-border/60 bg-secondary/30 p-1.5 text-[10px] font-mono">
                <div className="flex flex-col items-center rounded-md border border-border/60 bg-card p-1.5 text-center shadow-2xs">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">Mention</span>
                  <span className="font-bold text-foreground text-xs">{mentionRate}%</span>
                </div>
                <div className="flex flex-col items-center rounded-md border border-border/60 bg-card p-1.5 text-center shadow-2xs">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">Rank</span>
                  <span className="font-bold text-foreground text-xs">{positionScore}%</span>
                </div>
                <div className="flex flex-col items-center rounded-md border border-border/60 bg-card p-1.5 text-center shadow-2xs">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">Sentiment</span>
                  <span className="font-bold text-foreground text-xs">{sentimentScore}%</span>
                </div>
                <div className="flex flex-col items-center rounded-md border border-border/60 bg-card p-1.5 text-center shadow-2xs">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">Citations</span>
                  <span className="font-bold text-foreground text-xs">{citationScore}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
            <span className="text-muted-foreground font-medium">
              {promptsCount} tracked prompt queries configured
            </span>
            {onSelectTab && (
              <button
                onClick={() => onSelectTab("prompts")}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Manage Prompts &rarr;
              </button>
            )}
          </div>
        </div>

        {/* Right Column: AI Search Engine Model Matrix */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">AI Search Engine Model Matrix</span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">
              {formatCompactNumber(totalRuns)} total sample queries
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {providerStats.map((stat) => {
              const Icon = PROVIDER_ICONS[stat.provider] ?? Bot;
              return (
                <div
                  key={stat.provider}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary/30 p-2.5 transition-colors hover:bg-secondary/60"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60 shadow-2xs">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">{stat.label}</h4>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {stat.hasData
                          ? `${formatCompactNumber(stat.mentions)}/${formatCompactNumber(stat.total)} mentions cited`
                          : "Awaiting audit runs"}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    {stat.hasData ? (
                      <span className="font-mono text-sm font-bold text-primary">{stat.rate}%</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-mono">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
            <span className="text-[11px]">Direct multi-model sampling across OpenAI, Google, Anthropic & Perplexity</span>
            {onSelectTab && (
              <button
                onClick={() => onSelectTab("overview")}
                className="text-xs font-medium text-primary hover:underline"
              >
                View Full Audit Details &rarr;
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
