"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  ListOrdered,
  Quote,
  ShieldAlert,
  Smile,
  Sparkles,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api, extractErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS } from "@/lib/providers";

type MentionData = {
  id: string;
  term: string;
  is_primary: boolean;
  start_index: number;
  end_index: number;
  mention_order: number;
  list_rank: number | null;
  sentiment: string;
  sentiment_source: string;
  confidence_score: number;
  needs_review: boolean;
};

type CitationData = {
  id: string;
  url: string;
  domain: string;
  title: string;
};

type PromptRunData = {
  id: string;
  prompt_text: string;
  provider: string;
  status: string;
  response_text: string;
  created_at: string;
  executed_at: string | null;
};

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  neutral: "bg-secondary text-secondary-foreground border-border",
  negative: "bg-destructive/10 text-destructive border-destructive/20",
};

export default function PromptRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<PromptRunData | null>(null);
  const [mentions, setMentions] = useState<MentionData[]>([]);
  const [citations, setCitations] = useState<CitationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<PromptRunData>(`/prompt-runs/${runId}/`),
      api.get<MentionData[]>(`/mentions/?prompt_run=${runId}`),
      api.get<CitationData[]>(`/citations/?prompt_run=${runId}`),
    ])
      .then(([runRes, mentionsRes, citationsRes]) => {
        if (cancelled) return;
        setRun(runRes.data);
        setMentions(mentionsRes.data);
        setCitations(citationsRes.data);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(extractErrorMessage(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 animate-pulse">
          <div className="h-6 w-36 rounded bg-muted" />
          <div className="h-64 rounded-xl bg-card" />
        </div>
      </AppShell>
    );
  }

  if (error || !run) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Dashboard</span>
          </Link>
          <Card>
            <CardContent className="py-12 text-center text-sm text-destructive">
              {error || "Prompt run not found."}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const hasLowConfidence = mentions.some((m) => m.needs_review || m.confidence_score < 0.8);

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
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl mx-auto">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Dashboard</span>
          </Link>

          <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-mono text-muted-foreground">
            Run ID: {run.id}
          </span>
        </div>

        {/* Header Title Card */}
        <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="size-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Prompt-Run Evidence Audit
                </h1>
                <p className="text-xs text-muted-foreground">
                  Traceable verification of raw LLM generation, position index, and citations
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground">
                <Bot className="size-3.5 text-primary" />
                <span>{PROVIDER_LABELS[run.provider] ?? run.provider}</span>
              </span>

              <span
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold uppercase",
                  run.status === "COMPLETED"
                    ? "bg-emerald-100 text-emerald-800"
                    : run.status === "NEEDS_REVIEW"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-secondary text-foreground"
                )}
              >
                {run.status}
              </span>
            </div>
          </div>
        </div>

        {/* Low Confidence Warning Alert */}
        {hasLowConfidence && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="font-bold text-sm">Action Required: Low-Confidence Match</span>
              <p className="leading-relaxed text-amber-800 dark:text-amber-300">
                One or more detected brand matches in this execution scored below the 80% confidence
                threshold. Verify whether the mention term corresponds accurately to the client rather
                than an incidental dictionary homonym.
              </p>
            </div>
          </div>
        )}

        {/* Prompt Input Query */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
                <Quote className="size-3.5 text-primary" />
                <span>Prompt Query Text</span>
              </CardTitle>
              <button
                onClick={handleCopyPrompt}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
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
          </CardHeader>
          <CardContent>
            <p className="text-base font-medium text-foreground">{run.prompt_text}</p>
          </CardContent>
        </Card>

        {/* Raw Response */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Raw AI Generated Response Text
                </CardTitle>
                <CardDescription className="text-xs">
                  Full unmodified output returned by {PROVIDER_LABELS[run.provider] ?? run.provider}
                </CardDescription>
              </div>
              <button
                onClick={handleCopyResponse}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {copiedResponse ? (
                  <>
                    <Check className="size-3 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy Response</span>
                  </>
                )}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border/80 bg-secondary/30 p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
              {run.response_text}
            </div>
          </CardContent>
        </Card>

        {/* Extracted Mentions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Extracted Mentions &amp; Signals ({mentions.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Every identified entity, its appearance order, list rank, and confidence score
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {mentions.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No mentions extracted from this prompt run.
              </p>
            ) : (
              mentions.map((mention, idx) => (
                <div
                  key={mention.id || idx}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-4",
                    mention.needs_review
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border bg-card"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-foreground">
                        &ldquo;{mention.term}&rdquo;
                      </span>
                      {mention.is_primary ? (
                        <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                          Primary Brand
                        </span>
                      ) : (
                        <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Alias Match
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="rounded bg-secondary px-2.5 py-0.5 font-mono font-semibold">
                        #{mention.mention_order} Named
                      </span>
                      <span className="rounded bg-secondary px-2.5 py-0.5 font-mono font-semibold">
                        {mention.list_rank ? `Pick #${mention.list_rank}` : "Unranked"}
                      </span>
                      <span
                        className={cn(
                          "rounded-md border px-2 py-0.5 font-semibold capitalize",
                          SENTIMENT_BADGE[mention.sentiment.toLowerCase()] ?? "bg-secondary"
                        )}
                      >
                        {mention.sentiment.toLowerCase()}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                        Confidence
                      </span>
                      <p
                        className={cn(
                          "font-mono font-bold text-sm",
                          mention.needs_review ? "text-amber-600" : "text-emerald-700"
                        )}
                      >
                        {Math.round(mention.confidence_score * 100)}%
                        {mention.needs_review && " ⚠"}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                        Char Span
                      </span>
                      <p className="font-mono text-xs text-foreground">
                        [{mention.start_index}, {mention.end_index}]
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                        Sentiment Source
                      </span>
                      <p className="font-mono text-xs text-foreground capitalize">
                        {mention.sentiment_source || "rule"}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                        Citations
                      </span>
                      <p className="font-mono text-xs text-foreground">
                        {citations.length} cited
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Grounding Citations */}
        {citations.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Grounding Source Citations ({citations.length})
              </CardTitle>
              <CardDescription className="text-xs">
                External URLs referenced by the model in this generation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {citations.map((c) => (
                  <a
                    key={c.id}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg border border-border p-3 text-xs text-foreground hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Globe className="size-4 text-primary shrink-0" />
                      <span className="font-medium truncate">{c.title || c.url}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-[11px] shrink-0 flex items-center gap-1">
                      <span>{c.domain}</span>
                      <ExternalLink className="size-3" />
                    </span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
