"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  TrendingUp,
  Percent,
  Sparkles,
  Search,
  ArrowUpRight,
  Filter,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientScore } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function MentionRateView({ entries }: { entries: ClientScore[] | null }) {
  const [searchQuery, setSearchQuery] = useState("");

  if (!entries) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 w-28 rounded bg-muted" />
            </CardHeader>
            <CardContent className="h-28" />
          </Card>
        ))}
      </div>
    );
  }

  const validEntries = entries.filter((e) =>
    e.client.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Overview Metric Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Avg Mention Rate
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Percent className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono">
              {(() => {
                const scored = entries.filter((e) => e.score?.components?.mention_rate != null);
                if (scored.length === 0) return "0.0%";
                const avg =
                  scored.reduce((acc, curr) => acc + (curr.score?.components?.mention_rate ?? 0), 0) /
                  scored.length;
                return pct(avg);
              })()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Across all {entries.length} tracked client brand workspaces
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total AI Runs Monitored
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono">
              {entries
                .reduce((acc, curr) => acc + (curr.score?.total_runs ?? 0), 0)
                .toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Completed queries across OpenAI, Claude, Gemini &amp; Perplexity
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Runs With Brand Presence
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-emerald-700">
              {entries
                .reduce((acc, curr) => acc + (curr.score?.runs_with_mention ?? 0), 0)
                .toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Queries where client brands were actively identified &amp; cited
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by client name..."
            className="pl-9 text-xs h-9"
          />
          <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Client Mention Rate Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {validEntries.map((entry) => {
          const { client, score } = entry;
          const mentionRate = score?.components?.mention_rate ?? 0;
          const totalRuns = score?.total_runs ?? 0;
          const runsWithMention = score?.runs_with_mention ?? 0;

          // Provider breakdown calculation from prompt_runs
          const providerStats: Record<string, { total: number; mentioned: number }> = {};
          (score?.prompt_runs ?? []).forEach((run) => {
            const p = run.provider || "openai";
            if (!providerStats[p]) providerStats[p] = { total: 0, mentioned: 0 };
            providerStats[p].total += 1;
            if (run.mentioned) providerStats[p].mentioned += 1;
          });

          return (
            <Card key={client.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{client.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {score?.entity_name ?? client.name} brand tracking
                    </CardDescription>
                  </div>
                  <Link
                    href={`/clients/${client.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <span>Inspect</span>
                    <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                {!score || score.total_runs === 0 ? (
                  <p className="py-4 text-xs text-muted-foreground">
                    No completed prompt runs on file for this client.
                  </p>
                ) : (
                  <>
                    {/* Main Mention Rate Indicator */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Overall Mention Rate
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold font-mono text-foreground">
                            {pct(mentionRate)}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            ({runsWithMention}/{totalRuns} runs)
                          </span>
                        </div>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            mentionRate >= 0.7
                              ? "bg-emerald-600"
                              : mentionRate >= 0.4
                              ? "bg-amber-600"
                              : "bg-primary"
                          )}
                          style={{ width: `${Math.min(100, Math.round(mentionRate * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Per-Provider Mention Rate Breakdown */}
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Mention Rate by AI Engine
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(providerStats).map(([provider, stats]) => {
                          const rate = stats.total > 0 ? stats.mentioned / stats.total : 0;
                          return (
                            <div
                              key={provider}
                              className="flex items-center justify-between rounded-lg bg-secondary/40 p-2 text-xs"
                            >
                              <span className="font-medium text-foreground">
                                {PROVIDER_LABELS[provider] ?? provider}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-foreground">
                                  {pct(rate)}
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  ({stats.mentioned}/{stats.total})
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
