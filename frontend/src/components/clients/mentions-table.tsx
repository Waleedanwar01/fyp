"use client";

import { useState } from "react";
import { ExternalLink, Eye } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PromptRunReviewModal } from "@/components/dashboard/prompt-run-review-modal";
import { cn } from "@/lib/utils";
import type { FullVisibilityEvidence, MentionEvidence, PromptRunEvidence } from "@/components/clients/use-brand-detail";
import type { PromptRunEvidence as DashboardPromptRunEvidence } from "@/components/dashboard/use-client-visibility";

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  POSITIVE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  neutral: "bg-secondary text-secondary-foreground",
  NEUTRAL: "bg-secondary text-secondary-foreground",
  negative: "bg-destructive/10 text-destructive",
  NEGATIVE: "bg-destructive/10 text-destructive",
};

function getOrderBadge(order: number) {
  if (order === 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
        1st Mention
      </span>
    );
  }
  if (order === 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
        2nd Mention
      </span>
    );
  }
  if (order === 3) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
        3rd Mention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      #{order} Mention
    </span>
  );
}

/** Every individual mention behind the score above, exactly as
 * AVTR_SPEC's traceability requirement wants it -- never a black-box
 * number (design bible #37 "never invent insights" / Month 2's own
 * "nothing in the final number is a black box"). Low-confidence matches
 * are visibly flagged, same as the admin record and the Month 2 report
 * already show them -- a 0.75-confidence compound-name match is shown
 * as such, not silently presented at full confidence. */
export function MentionsTable({
  score,
  filterCitationsOnly = false,
}: {
  score: FullVisibilityEvidence | null;
  filterCitationsOnly?: boolean;
}) {
  const [selectedRun, setSelectedRun] = useState<DashboardPromptRunEvidence | null>(null);

  const rows = (score?.prompt_runs ?? [])
    .flatMap((run) => run.mentions.map((mention) => ({ run, mention })))
    .filter(({ mention }) => !filterCitationsOnly || mention.citations.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {filterCitationsOnly ? "Grounding Citations & Authority Links" : "Mentions, Order & Citations"}
        </CardTitle>
        <CardDescription>
          {filterCitationsOnly
            ? "All authority domains, URLs, and search grounding citations linked to your brand in AI responses."
            : "Every detected mention behind the score, with chronological mention order, list rank, and real citations."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filterCitationsOnly
              ? "No citations or grounding URLs detected yet for this brand."
              : "No mentions detected yet -- run a prompt to start building evidence here."}
          </p>
        ) : (
          <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-xl border border-border/70">
            <Table className="min-w-[700px]">
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/80">
                <TableRow>
                  <TableHead className="font-semibold text-xs text-foreground">Term</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">From prompt</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Mention Order</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">List Rank</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Sentiment</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Confidence</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Citations</TableHead>
                  <TableHead className="text-right font-semibold text-xs text-foreground">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ run, mention }) => (
                  <TableRow key={mention.id} className="hover:bg-secondary/40 transition-colors">
                    <TableCell className="font-medium">{mention.term}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground" title={run.prompt_text}>
                      {run.prompt_text}
                    </TableCell>
                    <TableCell>
                      {getOrderBadge(mention.mention_order ?? 1)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">
                      {mention.list_rank ? `#${mention.list_rank}` : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                          SENTIMENT_BADGE[mention.sentiment] ?? "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {mention.sentiment.toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-muted-foreground font-mono",
                        mention.needs_review && "text-amber-600 dark:text-amber-400 font-semibold"
                      )}
                      title={mention.needs_review ? "Flagged for review -- a shaky match, not presented as full-confidence fact." : undefined}
                    >
                      {Math.round(mention.confidence_score * 100)}%{mention.needs_review ? " (Review)" : ""}
                    </TableCell>
                    <TableCell>
                      {mention.citations.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {mention.citations.map((citation) => {
                            const raw = citation.url || citation.domain;
                            const targetUrl = raw?.startsWith("http://") || raw?.startsWith("https://") ? raw : `https://${raw}`;
                            return (
                              <a
                                key={citation.id}
                                href={targetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline transition-colors max-w-[220px] truncate"
                                title={`Open ${citation.url || citation.domain} in a new tab`}
                              >
                                <span className="truncate">{citation.domain || citation.title || citation.url}</span>
                                <ExternalLink className="size-3 shrink-0" />
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() =>
                          setSelectedRun({
                            id: run.id,
                            prompt_text: run.prompt_text,
                            provider: run.provider,
                            executed_at: run.executed_at ?? "",
                            response_text: run.response_text,
                            mentioned: run.mentioned,
                            mentions: run.mentions.map((m) => ({
                              id: m.id,
                              term: m.term,
                              is_primary: m.is_primary,
                              start_index: m.start_index ?? 0,
                              end_index: m.end_index ?? 0,
                              mention_order: m.mention_order,
                              list_rank: m.list_rank,
                              position_score: m.position_score ?? 0.5,
                              sentiment: m.sentiment,
                              sentiment_source: m.sentiment_source || "rule_heuristic",
                              sentiment_score: m.sentiment_score,
                              confidence_score: m.confidence_score,
                              needs_review: m.needs_review,
                              citations: m.citations,
                            })),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-primary hover:bg-secondary transition-colors shadow-2xs"
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

      {selectedRun && (
        <PromptRunReviewModal
          run={selectedRun}
          clientName={score?.entity_name}
          isOpen={!!selectedRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </Card>
  );
}
