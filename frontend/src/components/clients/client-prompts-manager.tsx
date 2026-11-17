"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Upload,
  Play,
  History,
  Edit2,
  Trash2,
  Search,
  Bot,
  Lock,
  Check,
  Copy,
  Clock,
  AlertCircle,
  Loader2,
  Zap,
  Globe,
  Award,
  ExternalLink,
  RefreshCw,
  FileText,
  List,
  CalendarClock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { FormField } from "@/components/auth/form-field";
import { PromptBulkImportDialog } from "@/components/clients/prompt-bulk-import-dialog";
import { SchedulesDialog, type PromptScheduleRecord } from "@/components/clients/schedules-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, extractErrorMessage } from "@/lib/api";
import { promptSchema, type PromptInput } from "@/lib/validation";
import { PROVIDER_LABELS } from "@/lib/providers";

export type PromptRecord = {
  id: string;
  client: string;
  text: string;
  category: string;
  service_tags: string[];
  location_tags: string[];
  schedule: "manual" | "daily" | "weekly" | "monthly" | "custom";
  is_active: boolean;
  locked_until: string | null;
  created_at: string;
};

export type PromptRunRecord = {
  id: string;
  prompt: string;
  prompt_text: string;
  provider: string;
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
  }>;
  citations?: Array<{
    id: string;
    url: string;
    title: string;
    domain: string;
  }>;
};

type SubscriptionSummary = { plan: { providers: string[] } };

export function ClientPromptsManager({
  clientId,
  clientName,
  prompts,
  defaultLocationTags = [],
  defaultServiceTags = [],
  onChanged,
  onClose,
}: {
  clientId: string;
  clientName: string;
  prompts: PromptRecord[];
  defaultLocationTags?: string[];
  defaultServiceTags?: string[];
  onChanged: () => void;
  onClose?: () => void;
}) {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(
    prompts[0]?.id || null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Dialogs state
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptRecord | null>(null);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [schedules, setSchedules] = useState<PromptScheduleRecord[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);

  const loadSchedules = useCallback(() => {
    api
      .get<PromptScheduleRecord[]>("/prompt-schedules/", { params: { client: clientId } })
      .then(({ data }) => setSchedules(data || []))
      .catch(() => setSchedules([]));
  }, [clientId]);

  useEffect(() => {
    loadSchedules();
    api
      .get<Array<{ id: string; client: string }>>("/brands/", { params: { client: clientId } })
      .then(({ data }) => {
        const match = data?.find((b) => b.client === clientId) || data?.[0];
        if (match) setBrandId(match.id);
      })
      .catch(() => {});
  }, [clientId, loadSchedules]);

  // AI Provider state
  const [planProviders, setPlanProviders] = useState<string[]>(["gemini", "openai", "perplexity"]);
  const [selectedProvider, setSelectedProvider] = useState<string>("gemini");

  // History & Run state
  const [runs, setRuns] = useState<PromptRunRecord[]>([]);
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.localStorage.getItem("avtr:client-hidden-runs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [runningPromptId, setRunningPromptId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  const dismissRun = (id: string) => {
    setHiddenRunIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        window.localStorage.setItem("avtr:client-hidden-runs", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const restoreAllRuns = () => {
    setHiddenRunIds(new Set());
    try {
      window.localStorage.removeItem("avtr:client-hidden-runs");
    } catch {}
  };

  // Fetch plan providers
  useEffect(() => {
    api
      .get<SubscriptionSummary>("/subscription/")
      .then((res) => {
        if (res.data?.plan?.providers?.length) {
          setPlanProviders(res.data.plan.providers);
          if (res.data.plan.providers.includes("gemini")) {
            setSelectedProvider("gemini");
          } else {
            setSelectedProvider(res.data.plan.providers[0]);
          }
        }
      })
      .catch(() => {
        setPlanProviders(["gemini", "openai", "perplexity"]);
        setSelectedProvider("gemini");
      });
  }, []);

  // Sync selected prompt
  useEffect(() => {
    if (!selectedPromptId && prompts.length > 0) {
      setSelectedPromptId(prompts[0].id);
    } else if (selectedPromptId && !prompts.some((p) => p.id === selectedPromptId)) {
      setSelectedPromptId(prompts[0]?.id || null);
    }
  }, [prompts, selectedPromptId]);

  // Load runs for selected prompt
  const loadRunsForPrompt = async (promptId: string) => {
    setLoadingRuns(true);
    try {
      const { data } = await api.get<PromptRunRecord[]>("/prompt-runs/", {
        params: { prompt: promptId },
      });
      setRuns(data || []);
      if (data && data.length > 0) {
        setSelectedRunId(data[0].id);
      } else {
        setSelectedRunId(null);
      }
    } catch {
      setRuns([]);
      setSelectedRunId(null);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    if (selectedPromptId) {
      loadRunsForPrompt(selectedPromptId);
    } else {
      setRuns([]);
      setSelectedRunId(null);
    }
  }, [selectedPromptId]);

  const selectedPrompt = useMemo(() => {
    return prompts.find((p) => p.id === selectedPromptId) || null;
  }, [prompts, selectedPromptId]);

  const visibleRuns = useMemo(() => {
    return runs.filter((r) => !hiddenRunIds.has(r.id));
  }, [runs, hiddenRunIds]);

  const selectedRun = useMemo(() => {
    return visibleRuns.find((r) => r.id === selectedRunId) || visibleRuns[0] || null;
  }, [visibleRuns, selectedRunId]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    prompts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [prompts]);

  // Filtered prompts
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.text.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.service_tags.some((s) => s.toLowerCase().includes(q)) ||
        p.location_tags.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [prompts, searchQuery, categoryFilter]);

  const toggleActive = async (prompt: PromptRecord) => {
    setErrorMessage(null);
    try {
      await api.patch(`/prompts/${prompt.id}/`, { is_active: !prompt.is_active });
      onChanged();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    }
  };

  const handleRunSingle = async (prompt: PromptRecord, provider: string) => {
    setErrorMessage(null);
    setRunningPromptId(prompt.id);
    try {
      const activeProvider = provider === "gemini" ? "gemini" : "gemini";
      const { data } = await api.post(`/prompts/${prompt.id}/run/`, { provider: activeProvider });
      await loadRunsForPrompt(prompt.id);
      if (data?.id) setSelectedRunId(data.id);
      onChanged();
      // Broadcast subscription update to immediately refresh credits run counter in sidebar
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setRunningPromptId(null);
    }
  };

  const handleRunAll = async () => {
    const activePrompts = prompts.filter((p) => p.is_active);
    if (activePrompts.length === 0) {
      setErrorMessage("No active prompts to run.");
      return;
    }
    setErrorMessage(null);
    setBulkRunning(true);
    try {
      await api.post("/prompts/run-bulk/", {
        prompts: activePrompts.map((p) => p.id),
        provider: "gemini",
      });
      if (selectedPromptId) {
        await loadRunsForPrompt(selectedPromptId);
      }
      onChanged();
      // Broadcast subscription update to immediately refresh credits run counter in sidebar
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    } finally {
      setBulkRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    const target = prompts.find((p) => p.id === id);
    if (target?.locked_until) {
      setErrorMessage(`Prompt is locked by an active schedule until ${target.locked_until}.`);
      return;
    }
    if (!window.confirm("Delete this prompt? This cannot be undone.")) return;
    setErrorMessage(null);
    try {
      await api.delete(`/prompts/${id}/`);
      onChanged();
    } catch (error) {
      setErrorMessage(extractErrorMessage(error));
    }
  };

  const copyText = (text: string, type: "prompt" | "response") => {
    navigator.clipboard.writeText(text);
    if (type === "prompt") {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } else {
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border/80 bg-secondary/50 text-foreground font-semibold">
              <Bot className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  Search Prompts &amp; Query Audits
                </h2>
                <span className="rounded-md border border-border/70 bg-secondary/60 px-2 py-0.5 text-xs font-medium text-foreground">
                  {clientName}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage brand search queries, run multi-model AI audits, and configure automated tracking schedules.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="h-9 text-xs font-medium"
            >
              <Plus className="size-3.5 mr-1" /> Add Prompt
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
              className="h-9 text-xs font-medium"
            >
              <Upload className="size-3.5 mr-1" /> Import CSV
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                loadSchedules();
                setSchedulesOpen(true);
              }}
              className="h-9 text-xs font-medium"
            >
              <CalendarClock className="size-3.5 mr-1" /> Schedules {schedules.length > 0 && `(${schedules.length})`}
            </Button>

            {prompts.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRunAll}
                disabled={bulkRunning}
                className="h-9 text-xs font-medium"
              >
                {bulkRunning ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <Zap className="size-3.5 mr-1" />
                )}
                <span>Run All ({prompts.filter((p) => p.is_active).length})</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Split Master-Detail Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left Column: Prompts List (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
          {/* Search & Category Filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search queries…"
                className="pl-8 text-xs h-9 bg-background border-border/70"
              />
            </div>

            {categories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-9 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground outline-none"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground border-b border-border/60 pb-2">
            <span>{filteredPrompts.length} of {prompts.length} Prompts</span>
            <span>{prompts.filter((p) => p.is_active).length} Active</span>
          </div>

          {/* Prompts Scrollable List */}
          <div className="flex flex-col gap-2 max-h-[580px] overflow-y-auto pr-1">
            {prompts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-xs text-muted-foreground">
                No prompts created yet. Click &quot;Add Prompt&quot; above to start.
              </div>
            ) : filteredPrompts.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No queries match &quot;{searchQuery}&quot;.
              </div>
            ) : (
              filteredPrompts.map((p) => {
                const isSelected = p.id === selectedPromptId;
                const isRunning = runningPromptId === p.id;

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPromptId(p.id)}
                    className={cn(
                      "group relative flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all cursor-pointer",
                      isSelected
                        ? "border-foreground/40 bg-secondary/60 shadow-xs ring-1 ring-foreground/10"
                        : "border-border/70 bg-background hover:border-border hover:bg-secondary/20"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block size-2 rounded-full shrink-0",
                            p.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"
                          )}
                          title={p.is_active ? "Active" : "Inactive"}
                        />
                        {p.category && (
                          <span className="rounded border border-border/70 bg-secondary/50 px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                            {p.category}
                          </span>
                        )}
                        {p.locked_until && (
                          <span className="inline-flex items-center gap-1 rounded border border-border/70 bg-secondary/50 px-1 py-0.2 text-[10px] text-muted-foreground">
                            <Lock className="size-2.5" />
                          </span>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunSingle(p, selectedProvider);
                        }}
                        disabled={isRunning}
                        className="h-6 px-2 text-[11px] font-medium text-foreground hover:bg-secondary"
                      >
                        {isRunning ? (
                          <Loader2 className="size-3 animate-spin mr-1" />
                        ) : (
                          <Play className="size-2.5 fill-current mr-1 text-muted-foreground" />
                        )}
                        <span>Run</span>
                      </Button>
                    </div>

                    <p className="text-xs font-semibold text-foreground leading-snug">
                      &ldquo;{p.text}&rdquo;
                    </p>

                    {(p.service_tags.length > 0 || p.location_tags.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        {p.service_tags.map((s) => (
                          <span key={s} className="rounded border border-border/60 bg-secondary/40 px-1.5 py-0.2">
                            {s}
                          </span>
                        ))}
                        {p.location_tags.map((l) => (
                          <span key={l} className="rounded border border-border/60 bg-secondary/40 px-1.5 py-0.2">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Prompt Details & Execution History (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5 rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
          {selectedPrompt ? (
            <>
              {/* Selected Prompt Banner */}
              <div className="flex flex-col gap-3.5 border-b border-border/70 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleActive(selectedPrompt)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                        selectedPrompt.is_active
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                          : "border-border bg-secondary/40 text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          selectedPrompt.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"
                        )}
                      />
                      <span>{selectedPrompt.is_active ? "Active" : "Inactive"}</span>
                    </button>

                    {selectedPrompt.category && (
                      <span className="rounded-md border border-border/70 bg-secondary/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {selectedPrompt.category}
                      </span>
                    )}

                    {selectedPrompt.locked_until && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/50 px-2 py-0.5 text-xs text-muted-foreground">
                        <Lock className="size-3" /> Scheduled until {selectedPrompt.locked_until}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingPrompt(selectedPrompt)}
                      disabled={!!selectedPrompt.locked_until}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="size-3 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(selectedPrompt.id)}
                      disabled={!!selectedPrompt.locked_until}
                      className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                {/* Prompt Query Box */}
                <div className="rounded-xl border border-border/70 bg-secondary/20 p-3.5 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground leading-relaxed">
                    &ldquo;{selectedPrompt.text}&rdquo;
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyText(selectedPrompt.text, "prompt")}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {copiedPrompt ? (
                      <Check className="size-3 text-emerald-500 mr-1" />
                    ) : (
                      <Copy className="size-3 mr-1" />
                    )}
                    <span>{copiedPrompt ? "Copied" : "Copy"}</span>
                  </Button>
                </div>
              </div>

              {/* AI Engine Runner Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Provider:</span>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="h-8.5 rounded-lg border border-border/80 bg-background px-2.5 text-xs font-semibold text-foreground outline-none"
                  >
                    {["gemini", "openai", "perplexity"].map((prov) => {
                      const isConfigured = prov === "gemini";
                      return (
                        <option key={prov} value={prov} disabled={!isConfigured}>
                          {PROVIDER_LABELS[prov] ?? prov} {isConfigured ? "(Active)" : "(Key not configured)"}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <Button
                  size="sm"
                  onClick={() => handleRunSingle(selectedPrompt, selectedProvider)}
                  disabled={runningPromptId === selectedPrompt.id}
                  className="h-8.5 text-xs font-medium"
                >
                  {runningPromptId === selectedPrompt.id ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      <span>Auditing…</span>
                    </>
                  ) : (
                    <>
                      <Play className="size-3 mr-1.5 fill-current" />
                      <span>Run Audit ({PROVIDER_LABELS[selectedProvider] ?? "AI"})</span>
                    </>
                  )}
                </Button>
              </div>

              {/* Chronological Run History Section */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <History className="size-3.5" /> Execution History ({visibleRuns.length} Runs)
                    </span>
                    {hiddenRunIds.size > 0 && (
                      <button
                        type="button"
                        onClick={restoreAllRuns}
                        className="text-[11px] text-primary hover:underline font-medium ml-1"
                      >
                        (Restore {hiddenRunIds.size} Hidden)
                      </button>
                    )}
                  </div>

                  {loadingRuns && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
                </div>

                {visibleRuns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-xs text-muted-foreground">
                    {hiddenRunIds.size > 0
                      ? "All runs for this prompt are currently dismissed from view. Click '(Restore Hidden)' above to view them."
                      : "No runs recorded for this prompt yet. Click \"Run Audit\" above to execute your first search audit."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Runs Selector Table / List */}
                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto border border-border/70 rounded-xl p-1 bg-background/50">
                      {visibleRuns.map((r, idx) => {
                        const isRunSelected = r.id === selectedRun?.id;
                        const brandMentions = r.mentions?.filter((m) => m.brand !== null) || [];
                        const bestRank = brandMentions.find((m) => m.list_rank !== null)?.list_rank;

                        return (
                          <div
                            key={r.id}
                            onClick={() => setSelectedRunId(r.id)}
                            className={cn(
                              "group/run flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer",
                              isRunSelected
                                ? "bg-secondary text-foreground font-semibold border border-border"
                                : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-mono text-[11px] text-muted-foreground">
                                #{visibleRuns.length - idx}
                              </span>
                              <span className="font-medium text-foreground">
                                {PROVIDER_LABELS[r.provider] ?? r.provider}
                              </span>
                              <span className="rounded border border-border/60 bg-secondary/60 px-1.5 py-0.2 text-[10px] font-mono uppercase text-muted-foreground">
                                {r.status}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 text-[11px]">
                              {brandMentions.length > 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                  {bestRank ? `Rank #${bestRank}` : "Brand Cited"}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Omitted</span>
                              )}

                              <span className="text-muted-foreground font-mono">
                                {new Date(r.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissRun(r.id);
                                }}
                                title="Dismiss run from history"
                                className="opacity-0 group-hover/run:opacity-100 hover:text-destructive p-0.5 rounded transition-opacity"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Selected Run Deep Inspection Box */}
                    {selectedRun && (
                      <div className="rounded-xl border border-border/80 bg-background p-4 flex flex-col gap-3.5 shadow-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                              {PROVIDER_LABELS[selectedRun.provider] ?? selectedRun.provider} Response
                            </span>
                            <span className="rounded border border-border/60 bg-secondary/50 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground uppercase">
                              {selectedRun.status}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                              <Clock className="size-3" />
                              {new Date(selectedRun.created_at).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>

                            {selectedRun.response_text && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyText(selectedRun.response_text, "response")}
                                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                {copiedResponse ? (
                                  <Check className="size-3 text-emerald-500 mr-1" />
                                ) : (
                                  <Copy className="size-3 mr-1" />
                                )}
                                <span>{copiedResponse ? "Copied" : "Copy"}</span>
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Mentions Pill Summary */}
                        {selectedRun.mentions && selectedRun.mentions.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {selectedRun.mentions.map((m) => (
                              <span
                                key={m.id}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium",
                                  m.brand !== null
                                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                                    : "border-border bg-secondary/40 text-muted-foreground"
                                )}
                              >
                                <Award className="size-3" />
                                <span>{m.term}</span>
                                {m.list_rank !== null && (
                                  <strong className="ml-1">Rank #{m.list_rank}</strong>
                                )}
                                <span className="text-[10px] text-muted-foreground capitalize">
                                  ({m.sentiment})
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Formatted AI Response Body */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <FileText className="size-3" /> Recorded AI Response:
                          </span>

                          <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 text-xs leading-relaxed text-foreground max-h-80 overflow-y-auto">
                            {selectedRun.response_text ? (
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  p: ({ ...props }) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
                                  strong: ({ ...props }) => <strong className="font-semibold text-foreground" {...props} />,
                                  ul: ({ ...props }) => <ul className="mb-2 list-disc space-y-0.5 pl-4" {...props} />,
                                  ol: ({ ...props }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4" {...props} />,
                                  li: ({ ...props }) => <li className="leading-snug" {...props} />,
                                }}
                              >
                                {selectedRun.response_text}
                              </ReactMarkdown>
                            ) : (
                              <span className="italic text-muted-foreground">
                                No response text recorded for this run.
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Extracted Citations */}
                        {selectedRun.citations && selectedRun.citations.length > 0 && (
                          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
                            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              <Globe className="size-3 text-primary" /> Cited Authority Sources:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedRun.citations.map((c) => {
                                const targetUrl = c.url?.startsWith("http://") || c.url?.startsWith("https://") ? c.url : `https://${c.url || c.domain}`;
                                return (
                                  <a
                                    key={c.id}
                                    href={targetUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground hover:border-primary/60 hover:text-primary transition-all shadow-2xs cursor-pointer group"
                                    title={c.url || targetUrl}
                                  >
                                    <span className="font-semibold truncate max-w-xs sm:max-w-md">
                                      {c.title || c.domain || c.url}
                                    </span>
                                    <ExternalLink className="size-3 text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center text-xs text-muted-foreground">
              Select a search prompt from the list to view its complete execution history and AI responses.
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Form Dialogs */}
      {addOpen && (
        <PromptFormDialog
          clientId={clientId}
          prompt={null}
          defaultLocationTags={defaultLocationTags}
          defaultServiceTags={defaultServiceTags}
          onClose={() => setAddOpen(false)}
          onSaved={onChanged}
        />
      )}

      {editingPrompt && (
        <PromptFormDialog
          clientId={clientId}
          prompt={editingPrompt}
          onClose={() => setEditingPrompt(null)}
          onSaved={onChanged}
        />
      )}

      {importOpen && (
        <PromptBulkImportDialog
          clientId={clientId}
          clientName={clientName}
          onClose={() => setImportOpen(false)}
          onImported={onChanged}
        />
      )}

      {schedulesOpen && (
        <SchedulesDialog
          clientId={clientId}
          clientName={clientName}
          brandId={brandId}
          prompts={prompts}
          schedules={schedules}
          onClose={() => setSchedulesOpen(false)}
          onChanged={() => {
            loadSchedules();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function PromptFormDialog({
  clientId,
  prompt,
  defaultLocationTags = [],
  defaultServiceTags = [],
  onClose,
  onSaved,
}: {
  clientId: string;
  prompt: PromptRecord | null;
  defaultLocationTags?: string[];
  defaultServiceTags?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PromptInput>({
    resolver: zodResolver(promptSchema),
    defaultValues: {
      text: prompt?.text ?? "",
      category: prompt?.category ?? "",
      serviceTags: prompt ? prompt.service_tags.join(", ") : defaultServiceTags.join(", "),
      locationTags: prompt ? prompt.location_tags.join(", ") : defaultLocationTags.join(", "),
      isActive: prompt?.is_active ?? true,
    },
  });

  const submit = async (data: PromptInput) => {
    setFormError(null);
    try {
      const payload = {
        text: data.text,
        category: data.category ?? "",
        service_tags: (data.serviceTags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        location_tags: (data.locationTags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        is_active: data.isActive,
      };

      if (prompt) {
        await api.patch(`/prompts/${prompt.id}/`, payload);
      } else {
        await api.post(`/clients/${clientId}/prompts/`, payload);
      }
      onSaved();
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl p-6 gap-4">
        <DialogHeader className="gap-1.5 pb-3 border-b border-border/70">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Bot className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {prompt ? "Edit Search Prompt" : "Create Search Query"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {prompt
                  ? "Update buyer-intent search query, categorization, and location tags."
                  : "Define a search question that potential customers ask AI search engines."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-2xs">
            <FormField label="Search Query Text" htmlFor="text" error={errors.text?.message} required>
              <Textarea
                id="text"
                rows={3}
                className="resize-none rounded-xl text-xs"
                placeholder="e.g. Which restaurant serves the best crispy chicken burgers in Lahore?"
                {...register("text")}
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Category" htmlFor="category" error={errors.category?.message}>
                <Input id="category" placeholder="e.g. Discovery & Fast Food" className="rounded-xl text-xs" {...register("category")} />
              </FormField>

              <FormField label="Service Tags (comma separated)" htmlFor="serviceTags" error={errors.serviceTags?.message}>
                <Input id="serviceTags" placeholder="e.g. Gourmet Burgers, Loaded Fries" className="rounded-xl text-xs" {...register("serviceTags")} />
              </FormField>
            </div>

            <FormField label="Location Tags (comma separated)" htmlFor="locationTags" error={errors.locationTags?.message}>
              <Input id="locationTags" placeholder="e.g. Lahore, Gulberg Lahore, DHA Lahore" className="rounded-xl text-xs" {...register("locationTags")} />
            </FormField>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-foreground px-1">
            <input type="checkbox" className="rounded accent-primary size-4" {...register("isActive")} />
            <span>Enable active status for scheduled audits</span>
          </label>

          {formError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {formError}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting} className="rounded-xl text-xs font-semibold px-4">
              {isSubmitting ? "Saving Prompt…" : prompt ? "Save Changes" : "Create Prompt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
