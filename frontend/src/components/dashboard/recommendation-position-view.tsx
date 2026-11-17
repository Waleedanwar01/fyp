"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Award,
  BarChart3,
  Bot,
  ChevronRight,
  Filter,
  Medal,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  ArrowUpRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientScore } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function RecommendationPositionView({ entries }: { entries: ClientScore[] | null }) {
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

  // Aggregated position metrics across all clients
  let totalMentionsCount = 0;
  let rank1Count = 0;
  let top3Count = 0;
  let totalPosScoreSum = 0;
  let clientsWithPosScore = 0;

  entries.forEach((e) => {
    if (e.score?.components?.position_score != null) {
      totalPosScoreSum += e.score.components.position_score;
      clientsWithPosScore += 1;
    }
    (e.score?.prompt_runs ?? []).forEach((run) => {
      run.mentions.forEach((m) => {
        totalMentionsCount += 1;
        if (m.list_rank === 1) rank1Count += 1;
        if (m.list_rank !== null && m.list_rank <= 3) top3Count += 1;
      });
    });
  });

  const avgPosScore = clientsWithPosScore > 0 ? totalPosScoreSum / clientsWithPosScore : 0;
  const rank1Rate = totalMentionsCount > 0 ? rank1Count / totalMentionsCount : 0;
  const top3Rate = totalMentionsCount > 0 ? top3Count / totalMentionsCount : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                #1 First-Pick Rate
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Trophy className="size-4 text-amber-600" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">{pct(rank1Rate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {rank1Count} of {totalMentionsCount} total detected mentions placed at Rank #1
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top 3 Recommendation Share
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Medal className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">{pct(top3Rate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {top3Count} mentions ranked in the top 3 list positions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Avg Position Score
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <Award className="size-4 text-emerald-700" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-emerald-700 font-numeric">
              {(avgPosScore * 100).toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground"> / 100</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Average recommendation position across all active brands
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search client position reports..."
            className="pl-9 text-xs h-9"
          />
          <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Client Position Breakdown List */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {validEntries.map((entry) => {
          const { client, score } = entry;
          const posScore = score?.components?.position_score ?? 0;
          const promptRuns = score?.prompt_runs ?? [];

          // Compute rank distribution for this client
          let cRank1 = 0;
          let cRank2 = 0;
          let cRank3 = 0;
          let cRank4Plus = 0;
          let cUnlisted = 0;
          let cTotalMentions = 0;

          // Per-provider position stats
          const providerPos: Record<string, { sum: number; count: number; top3: number }> = {};

          promptRuns.forEach((run) => {
            const p = run.provider || "openai";
            if (!providerPos[p]) providerPos[p] = { sum: 0, count: 0, top3: 0 };

            run.mentions.forEach((m) => {
              cTotalMentions += 1;
              providerPos[p].count += 1;
              providerPos[p].sum += m.position_score ?? 0.5;

              if (m.list_rank === 1) {
                cRank1 += 1;
                providerPos[p].top3 += 1;
              } else if (m.list_rank === 2) {
                cRank2 += 1;
                providerPos[p].top3 += 1;
              } else if (m.list_rank === 3) {
                cRank3 += 1;
                providerPos[p].top3 += 1;
              } else if (m.list_rank && m.list_rank > 3) {
                cRank4Plus += 1;
              } else {
                cUnlisted += 1;
              }
            });
          });

          return (
            <Card key={client.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{client.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {score?.entity_name ?? client.name} recommendation rank analysis
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
                {cTotalMentions === 0 ? (
                  <p className="py-4 text-xs text-muted-foreground">
                    No mention rankings recorded for this client yet.
                  </p>
                ) : (
                  <>
                    {/* Position Score Progress */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Position score
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold font-mono text-foreground">
                            {Math.round(posScore * 100)}%
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            ({cRank1} #1 picks of {cTotalMentions})
                          </span>
                        </div>
                      </div>

                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.round(posScore * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* Rank Distribution Breakdown Bar */}
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <span>Rank Distribution</span>
                        <span>{cTotalMentions} total mentions</span>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="rounded-lg bg-amber-500/10 p-2 border border-amber-500/20">
                          <div className="text-[10px] font-semibold text-amber-700">#1 Pick</div>
                          <div className="text-base font-bold font-mono text-amber-800">{cRank1}</div>
                        </div>
                        <div className="rounded-lg bg-primary/10 p-2 border border-primary/20">
                          <div className="text-[10px] font-semibold text-primary">#2 - #3</div>
                          <div className="text-base font-bold font-mono text-primary">
                            {cRank2 + cRank3}
                          </div>
                        </div>
                        <div className="rounded-lg bg-secondary/80 p-2 border border-border">
                          <div className="text-[10px] font-semibold text-muted-foreground">#4+</div>
                          <div className="text-base font-bold font-mono text-foreground">{cRank4Plus}</div>
                        </div>
                        <div className="rounded-lg bg-muted/60 p-2 border border-border">
                          <div className="text-[10px] font-semibold text-muted-foreground">Unlisted</div>
                          <div className="text-base font-bold font-mono text-foreground">{cUnlisted}</div>
                        </div>
                      </div>
                    </div>

                    {/* AI Engine Rank Performance */}
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Position Score by AI Engine
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(providerPos).map(([provider, stats]) => {
                          const avg = stats.count > 0 ? stats.sum / stats.count : 0;
                          return (
                            <div
                              key={provider}
                              className="flex items-center justify-between rounded-lg bg-secondary/40 p-2 text-xs"
                            >
                              <span className="font-medium text-foreground">
                                {PROVIDER_LABELS[provider] ?? provider}
                              </span>
                              <span className="font-mono font-bold text-foreground">
                                {(avg * 100).toFixed(0)}%
                              </span>
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
