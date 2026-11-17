"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Award,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  EyeOff,
  FileText,
  Filter,
  Globe,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { PromptRunReviewModal } from "@/components/dashboard/prompt-run-review-modal";
import type { PromptRunEvidence } from "@/components/dashboard/use-client-visibility";

export type PromptRunDetail = {
  id: string;
  prompt: string;
  prompt_text: string;
  client_id?: string;
  client_name?: string;
  brand_name?: string;
  provider: string;
  schedule: string | null;
  status: "pending" | "queued" | "running" | "completed" | "needs_review" | "failed";
  response_text: string;
  created_at: string;
  executed_at: string | null;
  mentions?: Array<{
    id: string;
    term: string;
    is_primary: boolean;
    brand: string | null;
    competitor: string | null;
    mention_order: number | null;
    list_rank: number | null;
    sentiment: "positive" | "neutral" | "negative";
    confidence_score: number;
    needs_review: boolean;
    citations?: Array<{
      id: string;
      url: string;
      title: string;
      domain: string;
    }>;
  }>;
  citations?: Array<{
    id: string;
    url: string;
    title: string;
    domain: string;
  }>;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  completed: {
    label: "Completed",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  running: {
    label: "Running",
    className: "border-border bg-secondary text-foreground",
  },
  queued: {
    label: "Queued",
    className: "border-border bg-secondary text-muted-foreground",
  },
  pending: {
    label: "Pending",
    className: "border-border bg-secondary text-muted-foreground",
  },
  needs_review: {
    label: "Needs Review",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const HIDDEN_RUNS_STORAGE_KEY = "avtr:dashboard-hidden-runs";
const globalPromptRunsCache = new Map<string, PromptRunDetail[]>();

export function PromptIntelligenceView({ initialClientId }: { initialClientId?: string }) {
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedClient, setSelectedClient] = useState<string>(initialClientId || "all");

  const cacheKey = `${selectedClient}_${selectedProvider}_${selectedStatus}`;
  const cachedRuns = globalPromptRunsCache.get(cacheKey) || [];

  const [runs, setRuns] = useState<PromptRunDetail[]>(cachedRuns);
  const [loading, setLoading] = useState(!globalPromptRunsCache.has(cacheKey));
  const [error, setError] = useState<string | null>(null);

  // Local dashboard dismiss / hide state (stored in localStorage)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.localStorage.getItem(HIDDEN_RUNS_STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Expanded card state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [reviewRun, setReviewRun] = useState<PromptRunEvidence | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchRuns = async () => {
    if (!globalPromptRunsCache.has(cacheKey)) {
      setLoading(true);
    }
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (selectedClient !== "all") params.client = selectedClient;
      if (selectedProvider !== "all") params.provider = selectedProvider;
      if (selectedStatus !== "all") params.status = selectedStatus;

      const { data } = await api.get<PromptRunDetail[]>("/prompt-runs/", { params });
      const results = data || [];
      globalPromptRunsCache.set(cacheKey, results);
      setRuns(results);
      // Expand the first run by default for quick visibility if not already expanded
      if (results.length > 0 && expandedIds.size === 0) {
        setExpandedIds(new Set([results[0].id]));
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cached = globalPromptRunsCache.get(cacheKey);
    if (cached) {
      setRuns(cached);
      setLoading(false);
    }
    fetchRuns();
  }, [cacheKey]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDismissFromDashboard = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        window.localStorage.setItem(HIDDEN_RUNS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleRestoreAllHidden = () => {
    setHiddenIds(new Set());
    try {
      window.localStorage.removeItem(HIDDEN_RUNS_STORAGE_KEY);
    } catch {}
  };

  // Client list for tabs & filter
  const uniqueClients = useMemo(() => {
    const map = new Map<string, string>();
    runs.forEach((r) => {
      if (r.client_id && r.client_name) {
        map.set(r.client_id, r.client_name);
      }
    });
    return Array.from(map.entries());
  }, [runs]);

  // Filtered runs excluding hidden ones
  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (hiddenIds.has(r.id)) return false;
      if (selectedClient !== "all" && r.client_id !== selectedClient) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.prompt_text.toLowerCase().includes(q) ||
        r.response_text.toLowerCase().includes(q) ||
        (r.client_name && r.client_name.toLowerCase().includes(q)) ||
        (r.brand_name && r.brand_name.toLowerCase().includes(q))
      );
    });
  }, [runs, searchQuery, hiddenIds, selectedClient]);

  // Telemetry stats: compute accurate mention rate strictly over completed runs (failed runs never count as 0 or drag down the score)
  const stats = useMemo(() => {
    const total = filteredRuns.length;
    const completed = filteredRuns.filter((r) => r.status === "completed").length;
    const failed = filteredRuns.filter((r) => r.status === "failed").length;
    const withBrandMentions = filteredRuns.filter(
      (r) => r.status === "completed" && r.mentions?.some((m) => m.brand !== null)
    ).length;
    const mentionRate = completed > 0 ? Math.round((withBrandMentions / completed) * 100) : 0;
    return { total, completed, failed, withBrandMentions, mentionRate };
  }, [filteredRuns]);


  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner & Telemetry */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-2xs">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Prompt Intelligence & AI History Feed
              </h2>
              <p className="text-xs text-muted-foreground">
                View AI answers, extracted rankings, and competitor mentions per client workspace.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {hiddenIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreAllHidden}
                className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5"
              >
                <RotateCcw className="size-3.5 mr-1.5" />
                Restore {hiddenIds.size} Hidden
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRuns}
              disabled={loading}
              className="flex items-center gap-2 h-8 px-3 text-xs"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Telemetry Metrics Row */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-border pt-4">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">Total Runs Evaluated</span>
            <span className="text-2xl font-bold tracking-tight font-mono text-foreground">{stats.total}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">Completed Audits</span>
            <span className="text-2xl font-bold tracking-tight font-mono text-emerald-600 dark:text-emerald-400">
              {stats.completed}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">Brand Mentioned</span>
            <span className="text-2xl font-bold tracking-tight font-mono text-primary">
              {stats.withBrandMentions}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-muted-foreground">AI Recommendation Rate</span>
            <span className="text-2xl font-bold tracking-tight font-mono text-foreground">
              {stats.mentionRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Client Separation Tabs Bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedClient("all")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
              selectedClient === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            All Clients ({runs.length})
          </button>

          {uniqueClients.map(([cId, cName]) => {
            const count = runs.filter((r) => r.client_id === cId && !hiddenIds.has(r.id)).length;
            const isSelected = selectedClient === cId;
            return (
              <button
                key={cId}
                onClick={() => setSelectedClient(cId)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Layers className="size-3" />
                <span>{cName}</span>
                <span className="font-mono text-[10px] opacity-80">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search prompt queries, AI answer text, or brand..."
            className="pl-9 text-xs sm:text-sm bg-card"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Provider Filter */}
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground outline-none shadow-2xs"
          >
            <option value="all">All AI Providers</option>
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI GPT-4o</option>
            <option value="perplexity">Perplexity AI</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground outline-none shadow-2xs"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed Only</option>
            <option value="needs_review">Needs Review</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <RefreshCw className="size-8 animate-spin text-primary mb-3" />
          <p className="text-sm font-medium">Fetching AI prompt intelligence logs…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredRuns.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center flex flex-col items-center justify-center">
          <Bot className="size-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-base font-semibold text-foreground">No prompt runs recorded</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {hiddenIds.size > 0
              ? "All prompt runs are currently dismissed from this view. Click 'Restore Hidden' above to show them again."
              : "Run manual prompt queries from the Clients workspace or configure an automated schedule to start logging AI answers."}
          </p>
        </div>
      )}

      {/* Runs Stream */}
      <div className="flex flex-col gap-4">
        {filteredRuns.map((run) => {
          const isExpanded = expandedIds.has(run.id);
          const brandMentions = run.mentions?.filter((m) => m.brand !== null) || [];
          const compMentions = run.mentions?.filter((m) => m.competitor !== null) || [];
          const statusConfig = STATUS_BADGE[run.status] ?? STATUS_BADGE.pending;
          const bestRank = brandMentions.find((m) => m.list_rank !== null)?.list_rank;

          return (
            <div
              key={run.id}
              className="rounded-2xl border border-border bg-card shadow-xs transition-all overflow-hidden"
            >
              {/* Card Header Bar */}
              <div className="p-4 sm:p-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {run.client_name && (
                      <button
                        onClick={() => run.client_id && setSelectedClient(run.client_id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
                      >
                        <Layers className="size-3 text-muted-foreground" />
                        {run.client_name}
                      </button>
                    )}

                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-secondary/30 px-2.5 py-0.5 text-xs font-medium text-foreground">
                      <Bot className="size-3 text-muted-foreground" />
                      {PROVIDER_LABELS[run.provider] ?? run.provider}
                    </span>

                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                        statusConfig.className
                      )}
                    >
                      {statusConfig.label}
                    </span>

                    {run.status === "failed" ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                        <AlertTriangle className="size-3" />
                        API Error (Not Evaluated)
                      </span>
                    ) : run.status === "needs_review" ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="size-3" />
                        Empty Output
                      </span>
                    ) : brandMentions.length > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        {bestRank ? `Ranked #${bestRank}` : "Brand Cited"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <XCircle className="size-3 text-muted-foreground/60" />
                        Brand Omitted
                      </span>
                    )}
                  </div>


                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" />
                    {new Date(run.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Prompt Query Text */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground leading-snug">
                      &ldquo;{run.prompt_text}&rdquo;
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyText(run.id, run.response_text || run.prompt_text)}
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      title="Copy response text"
                    >
                      {copiedId === run.id ? (
                        <Check className="size-3.5 text-emerald-500 mr-1" />
                      ) : (
                        <Copy className="size-3.5 mr-1" />
                      )}
                      <span>{copiedId === run.id ? "Copied" : "Copy"}</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleExpand(run.id)}
                      className="h-8 px-2.5 text-xs"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="size-3.5 mr-1" /> Hide Answer
                        </>
                      ) : (
                        <>
                          <ChevronDown className="size-3.5 mr-1" /> View AI Answer
                        </>
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDismissFromDashboard(run.id)}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Dismiss / remove from dashboard view"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Quick Intelligence Summary Pills */}
                {(brandMentions.length > 0 || compMentions.length > 0 || (run.citations && run.citations.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs border-t border-border/50">
                    {brandMentions.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300"
                      >
                        <Award className="size-3" />
                        <strong>{m.term}</strong> ({m.sentiment})
                      </span>
                    ))}

                    {compMentions.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-muted-foreground"
                      >
                        <span>Competitor:</span>
                        <strong className="text-foreground">{m.term}</strong>
                      </span>
                    ))}

                    {run.citations && run.citations.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground ml-auto text-[11px]">
                        <Globe className="size-3 text-primary" />
                        {run.citations.length} citation sources
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Expandable AI Response Markdown Body */}
              {isExpanded && (
                <div className="border-t border-border bg-secondary/20 p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileText className="size-3.5 text-primary" /> Exact AI Generated Answer
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Engine: {PROVIDER_LABELS[run.provider] ?? run.provider}
                    </span>
                  </div>

                  {run.response_text ? (
                    <div className="rounded-xl border border-border bg-card p-4 text-xs sm:text-sm leading-relaxed text-foreground shadow-inner max-h-96 overflow-y-auto">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ ...props }) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
                          strong: ({ ...props }) => <strong className="font-semibold text-primary" {...props} />,
                          ul: ({ ...props }) => <ul className="mb-2 list-disc space-y-1 pl-4" {...props} />,
                          ol: ({ ...props }) => <ol className="mb-2 list-decimal space-y-1 pl-4" {...props} />,
                          li: ({ ...props }) => <li className="leading-snug" {...props} />,
                          h1: ({ ...props }) => <h1 className="mt-3 mb-1 text-sm font-bold text-foreground" {...props} />,
                          h2: ({ ...props }) => <h2 className="mt-3 mb-1 text-xs font-bold text-foreground" {...props} />,
                          a: ({ href, ...props }) => {
                            const raw = href || "";
                            const targetUrl = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
                            return (
                              <a
                                href={targetUrl}
                                className="text-primary font-semibold underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5"
                                target="_blank"
                                rel="noopener noreferrer"
                                {...props}
                              />
                            );
                          },
                          blockquote: ({ ...props }) => (
                            <blockquote className="border-l-2 border-primary/40 pl-3 italic my-2" {...props} />
                          ),
                        }}
                      >
                        {run.response_text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No response text recorded.</p>
                  )}

                  {/* Citations List if available */}
                  {run.citations && run.citations.length > 0 && (
                    <div className="rounded-xl border border-border bg-card/60 p-3.5 flex flex-col gap-2">
                      <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                        <Globe className="size-3 text-primary" /> Citations &amp; Grounding URLs Extracted:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {run.citations.map((c) => {
                          const raw = c.url || c.domain;
                          const targetUrl = raw?.startsWith("http://") || raw?.startsWith("https://") ? raw : `https://${raw}`;
                          return (
                            <a
                              key={c.id}
                              href={targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-2.5 py-1 text-xs text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                              title={`Open ${c.url || c.domain} in a new window`}
                            >
                              <span className="font-medium truncate max-w-[200px]">{c.title || c.domain || c.url}</span>
                              <ExternalLink className="size-3 text-primary shrink-0" />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed Review Modal if opened */}
      {reviewRun && (
        <PromptRunReviewModal
          run={reviewRun}
          isOpen={!!reviewRun}
          onClose={() => setReviewRun(null)}
        />
      )}
    </div>
  );
}

