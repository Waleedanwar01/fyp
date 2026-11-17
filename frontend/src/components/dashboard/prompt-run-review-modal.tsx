"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Award,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  Globe,
  ListOrdered,
  Quote,
  Search,
  ShieldAlert,
  Smile,
  Sparkles,
  Tag,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PromptRunEvidence, MentionEvidence } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  POSITIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  neutral: "bg-secondary text-secondary-foreground border-border",
  NEUTRAL: "bg-secondary text-secondary-foreground border-border",
  negative: "bg-destructive/10 text-destructive border-destructive/20",
  NEGATIVE: "bg-destructive/10 text-destructive border-destructive/20",
};

export function PromptRunReviewModal({
  run,
  clientName,
  isOpen,
  onClose,
}: {
  run: PromptRunEvidence | null;
  clientName?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);

  if (!run) return null;

  const mentions = run.mentions ?? [];
  const hasLowConfidence = mentions.some((m) => m.needs_review || m.confidence_score < 0.8);
  const totalCitations = mentions.flatMap((m) => m.citations ?? []).length;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(run.prompt_text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleCopyResponse = () => {
    navigator.clipboard.writeText(run.response_text);
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] w-full max-w-4xl overflow-y-auto p-6 sm:max-w-4xl">
        <DialogHeader className="pb-2 border-b border-border">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" />
              </span>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  Prompt-Run Evidence Audit
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Inspect raw AI output, detected mention spans, ranking signals, and citations
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground">
                <Bot className="size-3.5 text-primary" />
                <span>{PROVIDER_LABELS[run.provider] ?? run.provider}</span>
              </span>

              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold font-mono",
                  run.mentioned
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {run.mentioned ? "Brand Cited" : "Omitted"}
              </span>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-5 pt-2">
          {/* Manual Review Alert Banner if low confidence detected */}
          {hasLowConfidence && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-bold text-sm">Action Required: Low-Confidence Extraction</span>
                <p className="leading-relaxed text-amber-800 dark:text-amber-300">
                  One or more detected brand matches in this execution scored below the 80%
                  confidence threshold (e.g. ambiguous terminology or common dictionary word).
                  Please verify that the highlighted term refers directly to{" "}
                  <strong>{clientName || "the client brand"}</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Prompt Query Box */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Quote className="size-3 text-primary" />
                <span>Input Prompt Query</span>
              </span>
              <button
                onClick={handleCopyPrompt}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="size-3 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-sm font-semibold text-foreground leading-relaxed">
              {run.prompt_text}
            </p>
          </div>

          {/* Raw AI Response Viewer with Interactive Highlight */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileText className="size-3 text-primary" />
                <span>AI Generated Response (Audited)</span>
              </span>
              <div className="flex items-center gap-3">
                {mentions.length > 0 && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {mentions.length} mention{mentions.length > 1 ? "s" : ""} extracted
                  </span>
                )}
                <button
                  onClick={handleCopyResponse}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copiedResponse ? (
                    <>
                      <Check className="size-3 text-emerald-600" />
                      <span className="text-emerald-600">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      <span>Copy Full Output</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-border/80 bg-card p-4 font-sans text-xs sm:text-sm leading-relaxed text-foreground whitespace-pre-wrap selection:bg-primary/20">
              {run.response_text ? (
                (() => {
                  const text = run.response_text;
                  const terms = Array.from(new Set(mentions.map((m) => m.term).filter(Boolean)));
                  if (terms.length === 0) return text;
                  const regex = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
                  const parts = text.split(regex);
                  return parts.map((part, i) => {
                    const isMatch = terms.some((t) => t.toLowerCase() === part.toLowerCase());
                    if (!isMatch) return <span key={i}>{part}</span>;
                    return (
                      <mark
                        key={i}
                        className="rounded bg-primary/20 px-1 py-0.5 font-bold text-primary dark:bg-primary/30"
                      >
                        {part}
                      </mark>
                    );
                  });
                })()
              ) : (
                <span className="italic text-muted-foreground">
                  (No response text recorded for this run)
                </span>
              )}
            </div>
          </div>

          {/* Extracted Mentions Evidence Table */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Extracted Mentions &amp; Scoring Signals ({mentions.length})
              </span>
              <span className="text-[11px] text-muted-foreground">
                {totalCitations} grounding citation{totalCitations !== 1 ? "s" : ""}
              </span>
            </div>

            {mentions.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
                No brand or competitor mentions identified in this response.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {mentions.map((mention, idx) => (
                  <div
                    key={mention.id || idx}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border p-4 shadow-xs transition-all",
                      mention.needs_review
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-border bg-card"
                    )}
                  >
                    {/* Top Row: Term & Key Badges */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          &ldquo;{mention.term}&rdquo;
                        </span>
                        {mention.is_primary ? (
                          <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                            Primary Brand
                          </span>
                        ) : (
                          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Alias / Variant
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs">
                        {/* Mention Order Badge */}
                        <span className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground font-mono">
                          <ListOrdered className="size-3 text-muted-foreground" />
                          #{mention.mention_order} Named
                        </span>

                        {/* List Rank Badge */}
                        <span className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground font-mono">
                          <Award className="size-3 text-amber-600" />
                          {mention.list_rank ? `Rank #${mention.list_rank}` : "Unranked (0.5)"}
                        </span>

                        {/* Sentiment Badge */}
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs font-semibold capitalize",
                            SENTIMENT_BADGE[mention.sentiment] ?? "bg-secondary text-foreground"
                          )}
                        >
                          {mention.sentiment.toLowerCase()}
                        </span>
                      </div>
                    </div>

                    {/* Extraction Signals Grid */}
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Confidence Score
                        </span>
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              "font-mono font-bold text-sm",
                              mention.needs_review
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-emerald-700"
                            )}
                          >
                            {Math.round(mention.confidence_score * 100)}%
                          </span>
                          {mention.needs_review && (
                            <span
                              className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800 dark:text-amber-300"
                              title="Flagged for human review"
                            >
                              Review
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Char Offset Span
                        </span>
                        <span className="font-mono text-xs text-foreground">
                          [{mention.start_index ?? 0}, {mention.end_index ?? 0}]
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Position Score
                        </span>
                        <span className="font-mono text-xs text-foreground">
                          {((mention.position_score ?? 0.5) * 100).toFixed(0)}%
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Sentiment Source
                        </span>
                        <span className="font-mono text-xs text-foreground capitalize">
                          {mention.sentiment_source || "rule_heuristic"}
                        </span>
                      </div>
                    </div>

                    {/* Grounding Citations */}
                    {mention.citations && mention.citations.length > 0 && (
                      <div className="flex flex-col gap-1 border-t border-border/60 pt-2 text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Grounding URLs &amp; Citations:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {mention.citations.map((c) => {
                            const raw = c.url || c.domain;
                            const targetUrl = raw?.startsWith("http://") || raw?.startsWith("https://") ? raw : `https://${raw}`;
                            return (
                              <a
                                key={c.id}
                                href={targetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2 py-1 text-xs text-primary hover:underline cursor-pointer"
                                title={`Open ${c.url || c.domain} in a new tab`}
                              >
                                <Globe className="size-3 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[180px]">{c.title || c.domain || c.url}</span>
                                <ExternalLink className="size-2.5 shrink-0" />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
