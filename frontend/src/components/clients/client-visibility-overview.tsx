"use client";

import {
  ArrowRight,
  Award,
  Globe,
  Percent,
  Smile,
  Swords,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CompetitorEntry, FullVisibilityEvidence } from "@/components/clients/use-brand-detail";
import { PROVIDER_LABELS } from "@/lib/providers";

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 1000) / 10}%`;
}

export function ClientVisibilityOverview({
  clientId,
  clientName,
  industry,
  targetLocations = [],
  services = [],
  score,
  competitors = [],
  dateFilter,
  onSelectTab,
}: {
  clientId?: string;
  clientName: string;
  industry?: string;
  targetLocations?: string[];
  services?: string[];
  score: FullVisibilityEvidence | null;
  competitors?: CompetitorEntry[];
  dateFilter?: { since?: string | null; until?: string | null };
  onSelectTab?: (tabId: string) => void;
}) {
  const promptRuns = score?.prompt_runs ?? [];
  const totalRuns = score?.total_runs ?? 0;
  const runsWithMention = score?.runs_with_mention ?? 0;
  const mentionRate = score?.components?.mention_rate ?? 0;
  const positionScore = score?.components?.position_score ?? 0;
  const sentimentScore = score?.components?.sentiment_score ?? 0;
  const citationScore = score?.components?.citation_score ?? 0;

  // Flatten mentions
  const allMentions = promptRuns.flatMap((r) => r.mentions);
  const totalMentions = allMentions.length;

  // Position metrics
  const rank1Count = allMentions.filter((m) => m.list_rank === 1).length;
  const top3Count = allMentions.filter((m) => m.list_rank !== null && m.list_rank <= 3).length;
  const firstNamedCount = allMentions.filter((m) => m.mention_order === 1).length;

  // Sentiment counts
  let posCount = 0;
  let neuCount = 0;
  let negCount = 0;
  allMentions.forEach((m) => {
    const s = (m.sentiment || "").toLowerCase();
    if (s === "positive") posCount += 1;
    else if (s === "negative") negCount += 1;
    else neuCount += 1;
  });

  const netSentimentScore =
    totalMentions > 0 ? Math.round(((posCount - negCount) / totalMentions) * 100) : 0;

  // Citations
  const citations = allMentions.flatMap((m) => m.citations ?? []);
  const uniqueDomains = new Set(citations.map((c) => c.domain || c.url)).size;

  // Engine presence
  const providerStats: Record<string, { total: number; mentioned: number }> = {};
  promptRuns.forEach((run) => {
    const p = run.provider || "openai";
    if (!providerStats[p]) providerStats[p] = { total: 0, mentioned: 0 };
    providerStats[p].total += 1;
    if (run.mentioned) providerStats[p].mentioned += 1;
  });

  return (
    <div className="flex flex-col gap-6">
      {/* 4 Pillars Summary Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* 1. Mention Rate Overview Card */}
        <Card className="flex flex-col justify-between border-border/70 bg-card shadow-2xs transition-all hover:border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60">
                  <Percent className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base font-semibold text-foreground">Mention Rate</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Presence frequency across AI models
                  </CardDescription>
                </div>
              </div>
              <span className="font-mono text-2xl font-bold text-foreground">
                {pct(mentionRate)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 pt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/40">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round(mentionRate * 100))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Identified in <strong className="text-foreground">{runsWithMention}</strong> of <strong className="text-foreground">{totalRuns}</strong> prompt queries</span>
              <span className="font-mono text-[11px] font-semibold text-foreground rounded bg-secondary/80 px-2 py-0.5 border border-border/50">
                {runsWithMention > 0 ? "Active Brand" : "Low Data"}
              </span>
            </div>

            {/* AI Engine Presence Grid */}
            <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
              {Object.entries(providerStats).map(([p, s]) => (
                <div
                  key={p}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-2 text-xs"
                >
                  <span className="text-muted-foreground">{PROVIDER_LABELS[p] ?? p}</span>
                  <span className="font-mono font-bold text-foreground">
                    {s.total > 0 ? pct(s.mentioned / s.total) : "—"}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => onSelectTab?.("mentions")}
              className="mt-1 inline-flex items-center justify-between rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <span>Explore All Mentions &amp; Appearance Stream</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>

        {/* 2. Position & Rank Overview Card */}
        <Card className="flex flex-col justify-between border-border/70 bg-card shadow-2xs transition-all hover:border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60">
                  <Award className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base font-semibold text-foreground">Recommendation Position</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Rank and primacy score
                  </CardDescription>
                </div>
              </div>
              <span className="font-mono text-2xl font-bold text-foreground">
                {pct(positionScore)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 pt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/40">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round(positionScore * 100))}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#1 Pick Rate</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-foreground">
                  {totalMentions > 0 ? pct(rank1Count / totalMentions) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top 3 Placement</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-foreground">
                  {totalMentions > 0 ? pct(top3Count / totalMentions) : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1st Named</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-foreground">
                  {totalMentions > 0 ? pct(firstNamedCount / totalMentions) : "—"}
                </p>
              </div>
            </div>

            <button
              onClick={() => onSelectTab?.("mentions")}
              className="mt-1 inline-flex items-center justify-between rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <span>View Mention Sequence &amp; Ranks</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>

        {/* 3. Sentiment & Tone Overview Card */}
        <Card className="flex flex-col justify-between border-border/70 bg-card shadow-2xs transition-all hover:border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60">
                  <Smile className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base font-semibold text-foreground">Sentiment &amp; Tone</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Perceived tone around mentions
                  </CardDescription>
                </div>
              </div>
              <span className="font-mono text-2xl font-bold text-foreground">
                {pct(sentimentScore)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 pt-1">
            {/* Multi-tone progress bar */}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/40">
              <div
                className="bg-emerald-500 transition-all duration-500"
                style={{ width: `${totalMentions > 0 ? (posCount / totalMentions) * 100 : 50}%` }}
              />
              <div
                className="bg-muted-foreground/30 transition-all duration-500"
                style={{ width: `${totalMentions > 0 ? (neuCount / totalMentions) * 100 : 50}%` }}
              />
              <div
                className="bg-rose-500 transition-all duration-500"
                style={{ width: `${totalMentions > 0 ? (negCount / totalMentions) * 100 : 0}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{posCount} Positive</span>
              <span className="text-muted-foreground">{neuCount} Neutral</span>
              <span className="text-rose-600 dark:text-rose-400 font-semibold">{negCount} Negative</span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Net Sentiment Index:</span>
              <span className="font-mono font-bold text-foreground">
                {netSentimentScore >= 0 ? `+${netSentimentScore}` : netSentimentScore} / 100
              </span>
            </div>

            <button
              onClick={() => onSelectTab?.("sentiment")}
              className="mt-1 inline-flex items-center justify-between rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <span>Inspect Sentiment Distribution Chart</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>

        {/* 4. Citations & Grounding Overview Card */}
        <Card className="flex flex-col justify-between border-border/70 bg-card shadow-2xs transition-all hover:border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary border border-border/60">
                  <Globe className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-base font-semibold text-foreground">Authority Citations</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Supporting source references
                  </CardDescription>
                </div>
              </div>
              <span className="font-mono text-2xl font-bold text-foreground">
                {pct(citationScore)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 pt-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/40">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round(citationScore * 100))}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Citations</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-foreground">{citations.length}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unique Domains</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-foreground">{uniqueDomains}</p>
              </div>
            </div>

            <button
              onClick={() => onSelectTab?.("citations")}
              className="mt-1 inline-flex items-center justify-between rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <span>View Source Domains &amp; Backlinks</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Competitor Landscape Quick-Link Banner */}
      <Card className="border-border shadow-2xs">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Swords className="size-5" />
            </span>
            <div>
              <h4 className="font-semibold text-foreground text-sm">
                Competitive Landscape &amp; Benchmarking
              </h4>
              <p className="text-xs text-muted-foreground">
                {competitors.length > 0
                  ? `Comparing ${clientName} against ${competitors.length} tracked competitor brands`
                  : `No direct competitors configured for ${clientName} yet`}
              </p>
            </div>
          </div>

          <button
            onClick={() => onSelectTab?.("competitors")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-card px-3.5 py-2 text-xs font-semibold text-foreground border border-border shadow-xs hover:bg-secondary transition-colors"
          >
            <span>View Competitive Matrix</span>
            <ArrowRight className="size-3.5" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
