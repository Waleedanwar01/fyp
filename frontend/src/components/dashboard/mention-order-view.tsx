"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlignLeft,
  ArrowDownUp,
  Award,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  ListOrdered,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClientScore, PromptRunEvidence } from "@/components/dashboard/use-client-visibility";
import { PromptRunReviewModal } from "@/components/dashboard/prompt-run-review-modal";
import { PROVIDER_LABELS } from "@/lib/providers";

function getOrderBadge(order: number) {
  if (order === 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
        <Award className="size-3" />
        <span>1st Mention</span>
      </span>
    );
  }
  if (order === 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
        <span>2nd Mention</span>
      </span>
    );
  }
  if (order === 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
        <span>3rd Mention</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span>#{order} Mention</span>
    </span>
  );
}

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  POSITIVE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  neutral: "bg-secondary text-secondary-foreground",
  NEUTRAL: "bg-secondary text-secondary-foreground",
  negative: "bg-destructive/10 text-destructive",
  NEGATIVE: "bg-destructive/10 text-destructive",
};

export function MentionOrderView({ entries }: { entries: ClientScore[] | null }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [orderFilter, setOrderFilter] = useState<"all" | "first" | "top2">("all");
  const [selectedRun, setSelectedRun] = useState<{ run: PromptRunEvidence; clientName: string } | null>(null);

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

  // Flatten all mentions across all clients and prompt runs
  const allMentionRows = entries.flatMap((e) =>
    (e.score?.prompt_runs ?? []).flatMap((run) =>
      run.mentions.map((mention) => ({
        client: e.client,
        run,
        mention,
      }))
    )
  );

  // Compute summary stats
  const totalMentions = allMentionRows.length;
  const firstNamedCount = allMentionRows.filter((r) => r.mention.mention_order === 1).length;
  const top2NamedCount = allMentionRows.filter((r) => r.mention.mention_order <= 2).length;
  const firstNamedRate = totalMentions > 0 ? firstNamedCount / totalMentions : 0;
  const top2Rate = totalMentions > 0 ? top2NamedCount / totalMentions : 0;
  const avgMentionOrder =
    totalMentions > 0
      ? allMentionRows.reduce((acc, curr) => acc + curr.mention.mention_order, 0) / totalMentions
      : 0;

  // Filter rows
  const filteredRows = allMentionRows.filter((r) => {
    const matchesSearch =
      r.client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.mention.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.run.prompt_text.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesProvider =
      selectedProvider === "all" || r.run.provider.toLowerCase() === selectedProvider.toLowerCase();

    const matchesOrder =
      orderFilter === "all" ||
      (orderFilter === "first" && r.mention.mention_order === 1) ||
      (orderFilter === "top2" && r.mention.mention_order <= 2);

    return matchesSearch && matchesProvider && matchesOrder;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                First-Named Primacy Rate
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Flame className="size-4 text-amber-600" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {Math.round(firstNamedRate * 1000) / 10}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {firstNamedCount} of {totalMentions} mentions introduced first before competitors
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top 2 Stream Placement
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Zap className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-foreground">
              {Math.round(top2Rate * 1000) / 10}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {top2NamedCount} mentions introduced in the 1st or 2nd position
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Avg Mention Sequence Order
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <ListOrdered className="size-4 text-emerald-700" />
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold font-mono text-emerald-700 font-numeric">
              {avgMentionOrder.toFixed(2)}
              <span className="text-sm font-normal text-muted-foreground"> / position</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Sequential appearance rank within generated AI responses
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Control Bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Mention-Order Stream Log</CardTitle>
              <CardDescription className="text-xs">
                Real-time chronological mention order tracking across all AI prompt executions
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Order Quick Filter */}
              <div className="flex items-center rounded-lg border border-border bg-secondary/30 p-0.5 text-xs">
                <button
                  onClick={() => setOrderFilter("all")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    orderFilter === "all"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All Orders
                </button>
                <button
                  onClick={() => setOrderFilter("first")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    orderFilter === "first"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  1st Mention Only
                </button>
                <button
                  onClick={() => setOrderFilter("top2")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    orderFilter === "top2"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Top 2 Named
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search prompt text, client or term..."
                className="pl-9 text-xs h-9"
              />
              <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Engine:</span>
              {["all", "openai", "claude", "gemini", "perplexity"].map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedProvider(p)}
                  className={cn(
                    "rounded-md px-2 py-1 font-medium capitalize transition-colors",
                    selectedProvider === p
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {p === "all" ? "All" : PROVIDER_LABELS[p] ?? p}
                </button>
              ))}
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No mention occurrences match the selected filters.
            </p>
          ) : (
            <div className="max-h-[500px] overflow-x-auto overflow-y-auto rounded-lg border border-border">
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Client / Brand</TableHead>
                    <TableHead>Mention Order</TableHead>
                    <TableHead>List Rank</TableHead>
                    <TableHead>Prompt &amp; AI Engine</TableHead>
                    <TableHead>Sentiment</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(({ client, run, mention }) => (
                    <TableRow key={mention.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <Link
                            href={`/clients/${client.id}`}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {client.name}
                          </Link>
                          <span className="text-[11px] text-muted-foreground">{mention.term}</span>
                        </div>
                      </TableCell>

                      <TableCell>{getOrderBadge(mention.mention_order)}</TableCell>

                      <TableCell>
                        {mention.list_rank ? (
                          <span className="font-mono font-semibold text-foreground">
                            Pick #{mention.list_rank}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">— (In paragraph)</span>
                        )}
                      </TableCell>

                      <TableCell className="max-w-xs">
                        <div className="flex flex-col gap-1">
                          <span className="truncate text-xs font-medium text-foreground" title={run.prompt_text}>
                            {run.prompt_text}
                          </span>
                          <span className="inline-flex w-fit items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                            <Bot className="size-3" />
                            {PROVIDER_LABELS[run.provider] ?? run.provider}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            SENTIMENT_BADGE[mention.sentiment] ?? "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {mention.sentiment.toLowerCase()}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span
                          className={cn(
                            "font-mono text-xs text-muted-foreground",
                            mention.needs_review && "font-semibold text-amber-700"
                          )}
                        >
                          {Math.round(mention.confidence_score * 100)}%
                          {mention.needs_review && " (Review)"}
                        </span>
                      </TableCell>

                      <TableCell className="text-right">
                        <button
                          onClick={() => setSelectedRun({ run, clientName: client.name })}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-primary hover:bg-secondary transition-colors"
                        >
                          <Eye className="size-3" />
                          <span>Audit</span>
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Modal */}
      {selectedRun && (
        <PromptRunReviewModal
          run={selectedRun.run}
          clientName={selectedRun.clientName}
          isOpen={!!selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  );
}
