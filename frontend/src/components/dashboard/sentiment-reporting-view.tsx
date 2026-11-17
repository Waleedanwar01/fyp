"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Frown,
  HeartHandshake,
  Meh,
  Search,
  Smile,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientScore } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

function pct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function SentimentReportingView({ entries }: { entries: ClientScore[] | null }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "positive" | "negative">("all");

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

  // Aggregate global sentiment numbers across all clients and prompt runs
  let totalMentions = 0;
  let totalPositive = 0;
  let totalNeutral = 0;
  let totalNegative = 0;

  // Engine breakdown
  const engineSentiment: Record<
    string,
    { total: number; positive: number; neutral: number; negative: number }
  > = {};

  entries.forEach((e) => {
    (e.score?.prompt_runs ?? []).forEach((run) => {
      const p = run.provider || "openai";
      if (!engineSentiment[p]) {
        engineSentiment[p] = { total: 0, positive: 0, neutral: 0, negative: 0 };
      }

      run.mentions.forEach((m) => {
        totalMentions += 1;
        engineSentiment[p].total += 1;
        const s = (m.sentiment || "neutral").toLowerCase();

        if (s === "positive") {
          totalPositive += 1;
          engineSentiment[p].positive += 1;
        } else if (s === "negative") {
          totalNegative += 1;
          engineSentiment[p].negative += 1;
        } else {
          totalNeutral += 1;
          engineSentiment[p].neutral += 1;
        }
      });
    });
  });

  const posRate = totalMentions > 0 ? totalPositive / totalMentions : 0;
  const neuRate = totalMentions > 0 ? totalNeutral / totalMentions : 0;
  const negRate = totalMentions > 0 ? totalNegative / totalMentions : 0;
  // Net Sentiment Score (-100 to +100 index)
  const netSentimentScore =
    totalMentions > 0 ? Math.round(((totalPositive - totalNegative) / totalMentions) * 100) : 0;

  // Filter clients
  const filteredEntries = entries.filter((e) => {
    const matchesSearch = e.client.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (filterMode === "positive") {
      let clientPos = 0;
      (e.score?.prompt_runs ?? []).forEach((r) =>
        r.mentions.forEach((m) => {
          if ((m.sentiment || "").toLowerCase() === "positive") clientPos += 1;
        })
      );
      return clientPos > 0;
    }
    if (filterMode === "negative") {
      let clientNeg = 0;
      (e.score?.prompt_runs ?? []).forEach((r) =>
        r.mentions.forEach((m) => {
          if ((m.sentiment || "").toLowerCase() === "negative") clientNeg += 1;
        })
      );
      return clientNeg > 0;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Net Sentiment Score
              </span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg font-bold text-xs",
                  netSentimentScore >= 0
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-destructive/10 text-destructive"
                )}
              >
                {netSentimentScore >= 0 ? "+" : ""}
                {netSentimentScore}
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {netSentimentScore > 0 ? `+${netSentimentScore}` : netSentimentScore}
              <span className="text-sm font-normal text-muted-foreground"> / 100</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Net positive bias index across all AI responses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Positive Sentiment
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <Smile className="size-4 text-emerald-700" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-emerald-700">{pct(posRate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalPositive} of {totalMentions} mentions with praising tone
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Neutral Sentiment
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <Meh className="size-4 text-muted-foreground" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">{pct(neuRate)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalNeutral} factual or comparative descriptions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Negative Sentiment
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <Frown className="size-4 text-destructive" />
              </span>
            </div>
            <p
              className={cn(
                "mt-2 text-3xl font-bold font-mono",
                totalNegative > 0 ? "text-destructive" : "text-foreground"
              )}
            >
              {pct(negRate)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalNegative} mentions flagging drawbacks or cautions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cross-Engine Sentiment Heatmap / Comparison Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">AI Engine Sentiment Breakdown</CardTitle>
          <CardDescription className="text-xs">
            Tone distribution detected across individual foundational model engines
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(engineSentiment).map(([provider, stats]) => {
              const engPos = stats.total > 0 ? stats.positive / stats.total : 0;
              const engNeu = stats.total > 0 ? stats.neutral / stats.total : 0;
              const engNeg = stats.total > 0 ? stats.negative / stats.total : 0;

              return (
                <div
                  key={provider}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                      {PROVIDER_LABELS[provider] ?? provider}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {stats.total} mentions
                    </span>
                  </div>

                  {/* Multi-segment sentiment bar */}
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="bg-emerald-600 transition-all"
                      style={{ width: `${Math.round(engPos * 100)}%` }}
                      title={`Positive: ${pct(engPos)}`}
                    />
                    <div
                      className="bg-muted-foreground/40 transition-all"
                      style={{ width: `${Math.round(engNeu * 100)}%` }}
                      title={`Neutral: ${pct(engNeu)}`}
                    />
                    <div
                      className="bg-destructive transition-all"
                      style={{ width: `${Math.round(engNeg * 100)}%` }}
                      title={`Negative: ${pct(engNeg)}`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-emerald-700 font-semibold">{pct(engPos)} pos</span>
                    <span className="text-muted-foreground">{pct(engNeu)} neu</span>
                    <span className="text-destructive font-semibold">{pct(engNeg)} neg</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Filters and Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search client sentiment records..."
            className="pl-9 text-xs h-9"
          />
          <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        </div>

        <div className="flex items-center rounded-lg border border-border bg-secondary/30 p-0.5 text-xs">
          <button
            onClick={() => setFilterMode("all")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              filterMode === "all"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All Clients
          </button>
          <button
            onClick={() => setFilterMode("positive")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              filterMode === "positive"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Has Positive Tone
          </button>
          <button
            onClick={() => setFilterMode("negative")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              filterMode === "negative"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Has Negative Flags
          </button>
        </div>
      </div>

      {/* Per-Client Sentiment Breakdown Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {filteredEntries.map((entry) => {
          const { client, score } = entry;
          const promptRuns = score?.prompt_runs ?? [];

          let cPos = 0;
          let cNeu = 0;
          let cNeg = 0;
          let cTotal = 0;

          promptRuns.forEach((run) => {
            run.mentions.forEach((m) => {
              cTotal += 1;
              const s = (m.sentiment || "neutral").toLowerCase();
              if (s === "positive") cPos += 1;
              else if (s === "negative") cNeg += 1;
              else cNeu += 1;
            });
          });

          const cPosRate = cTotal > 0 ? cPos / cTotal : 0;
          const cNeuRate = cTotal > 0 ? cNeu / cTotal : 0;
          const cNegRate = cTotal > 0 ? cNeg / cTotal : 0;

          return (
            <Card key={client.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">{client.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {score?.entity_name ?? client.name} sentiment breakdown
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
                {cTotal === 0 ? (
                  <p className="py-4 text-xs text-muted-foreground">
                    No sentiment observations recorded for this client yet.
                  </p>
                ) : (
                  <>
                    {/* Sentiment Distribution Bar */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Sentiment Distribution
                        </span>
                        <div className="flex items-baseline gap-2 text-xs font-mono">
                          <span className="text-emerald-700 font-semibold">{cPos} Positive</span>
                          <span className="text-muted-foreground">{cNeu} Neutral</span>
                          <span className="text-destructive font-semibold">{cNeg} Negative</span>
                        </div>
                      </div>

                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="bg-emerald-600 transition-all duration-500"
                          style={{ width: `${Math.round(cPosRate * 100)}%` }}
                        />
                        <div
                          className="bg-muted-foreground/40 transition-all duration-500"
                          style={{ width: `${Math.round(cNeuRate * 100)}%` }}
                        />
                        <div
                          className="bg-destructive transition-all duration-500"
                          style={{ width: `${Math.round(cNegRate * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Breakdown stat pills */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-emerald-500/10 p-2 border border-emerald-500/20">
                        <div className="text-[10px] font-semibold text-emerald-700">Positive</div>
                        <div className="text-base font-bold font-mono text-emerald-800">
                          {pct(cPosRate)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-secondary/80 p-2 border border-border">
                        <div className="text-[10px] font-semibold text-muted-foreground">Neutral</div>
                        <div className="text-base font-bold font-mono text-foreground">
                          {pct(cNeuRate)}
                        </div>
                      </div>
                      <div className="rounded-lg bg-destructive/10 p-2 border border-destructive/20">
                        <div className="text-[10px] font-semibold text-destructive">Negative</div>
                        <div className="text-base font-bold font-mono text-destructive">
                          {pct(cNegRate)}
                        </div>
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
