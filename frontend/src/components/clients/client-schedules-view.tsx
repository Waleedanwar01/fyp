"use client";

import { useState } from "react";
import {
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Edit2,
  ExternalLink,
  Layers,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, extractErrorMessage } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import type { PromptRecord } from "@/components/clients/client-prompts-manager";
import type { PromptScheduleRecord } from "@/components/clients/schedules-dialog";

const STATUS_CONFIG: Record<
  string,
  { label: string; badge: string; dot: string; description: string }
> = {
  active: {
    label: "Active Running",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500 animate-pulse",
    description: "Executing automatically on set recurrence",
  },
  paused: {
    label: "Paused",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    description: "Temporarily stopped by administrator",
  },
  paused_limit_reached: {
    label: "Limit Reached",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    description: "Monthly prompt run credit limit reached",
  },
  paused_subscription: {
    label: "Subscription Expired",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
    description: "Paused until the subscription is renewed -- resumes automatically after renewal",
  },
  completed: {
    label: "Completed",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    description: "Execution window concluded",
  },
  draft: {
    label: "Draft",
    badge: "border-border bg-secondary text-muted-foreground",
    dot: "bg-muted-foreground",
    description: "Not yet activated",
  },
};

export function ClientSchedulesView({
  clientId,
  clientName,
  schedules,
  prompts,
  onOpenCreateModal,
  onOpenEditModal,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  schedules: PromptScheduleRecord[];
  prompts: PromptRecord[];
  onOpenCreateModal: () => void;
  onOpenEditModal: (schedule: PromptScheduleRecord) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleTogglePause = async (schedule: PromptScheduleRecord) => {
    setBusyId(schedule.id);
    setActionError(null);
    setSuccessMsg(null);
    try {
      if (schedule.status === "active") {
        await api.post(`/schedules/${schedule.id}/pause/`);
        setSuccessMsg(`Schedule paused successfully.`);
      } else {
        await api.post(`/schedules/${schedule.id}/resume/`);
        setSuccessMsg(`Schedule resumed and active.`);
      }
      onChanged();
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (schedule: PromptScheduleRecord) => {
    setBusyId(schedule.id);
    setActionError(null);
    setSuccessMsg(null);
    try {
      const { data } = await api.post(`/schedules/${schedule.id}/run_now/`);
      setSuccessMsg(data?.detail || "Schedule executed immediately! Audit prompt runs created.");
      onChanged();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.delete(`/schedules/${scheduleId}/`);
      onChanged();
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const activeSchedulesCount = schedules.filter((s) => s.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header Card */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-secondary/15 p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
            <CalendarClock className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                Automated Audit Schedules
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary font-mono">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                <span>{activeSchedulesCount} Active for {clientName}</span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Multi-model recurring audits that execute queries, extract citations, track positioning, and stream notifications.
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={onOpenCreateModal}
          className="gap-2 rounded-xl text-xs font-semibold shadow-xs shrink-0 cursor-pointer h-9 px-4"
        >
          <Plus className="size-3.5" />
          <span>New Audit Schedule</span>
        </Button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          {actionError}
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 animate-in fade-in-0">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Schedules List Grid */}
      {schedules.length === 0 ? (
        <Card className="rounded-2xl border border-dashed border-border/80 bg-card/50 p-8 text-center shadow-2xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary mb-3">
            <CalendarClock className="size-6" />
          </div>
          <CardTitle className="text-base font-bold text-foreground">No Automated Schedules Configured</CardTitle>
          <CardDescription className="text-xs text-muted-foreground max-w-md mx-auto mt-1 mb-5">
            Automate prompt checks across Google Gemini, ChatGPT, Perplexity, and Claude on a daily, weekly, or custom interval.
          </CardDescription>
          <Button
            type="button"
            onClick={onOpenCreateModal}
            className="gap-2 rounded-xl text-xs font-semibold mx-auto"
          >
            <Plus className="size-3.5" />
            <span>Create First Schedule for {clientName}</span>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {schedules.map((sched) => {
            const statusCfg = STATUS_CONFIG[sched.status] || STATUS_CONFIG.draft;
            const isBusy = busyId === sched.id;
            const promptCount = sched.prompts?.length ?? 0;
            const providerCount = sched.providers?.length ?? 0;

            const formatFreq = (freq: string) => {
              if (freq === "daily") return "Daily Recurrence";
              if (freq === "weekly") return "Weekly Recurrence";
              if (freq === "monthly") return "Monthly Recurrence";
              if (freq === "once") return "Single Execution";
              return "Custom Interval";
            };

            return (
              <Card
                key={sched.id}
                className={cn(
                  "flex flex-col justify-between rounded-2xl border bg-card p-5 shadow-xs transition-all duration-200",
                  sched.status === "active"
                    ? "border-primary/30 hover:border-primary/50 shadow-2xs"
                    : "border-border/80 opacity-85 hover:opacity-100"
                )}
              >
                <div className="flex flex-col gap-4">
                  {/* Row 1: Header & Status Badge */}
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-xl font-bold text-xs shadow-2xs border",
                          sched.status === "active"
                            ? "bg-primary/10 text-primary border-primary/25"
                            : "bg-secondary text-muted-foreground border-border/60"
                        )}
                      >
                        <Radio className="size-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-bold text-foreground truncate">
                          {formatFreq(sched.frequency)}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3 text-primary" />
                          <span>Run time: <strong className="text-foreground">{sched.run_time}</strong> ({sched.timezone || "PKT"})</span>
                        </span>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold font-mono uppercase tracking-wider border shrink-0",
                        statusCfg.badge
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", statusCfg.dot)} />
                      <span>{statusCfg.label}</span>
                    </span>
                  </div>

                  {/* Row 2: Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl border border-border/70 bg-secondary/20 p-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Prompts Included
                      </span>
                      <span className="font-mono text-sm font-bold text-foreground mt-0.5 block">
                        {promptCount} <span className="text-[10px] font-sans font-normal text-muted-foreground">prompts</span>
                      </span>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-secondary/20 p-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                        Execution Window
                      </span>
                      <span className="font-mono text-[11px] font-bold text-foreground mt-0.5 block truncate">
                        {sched.start_date} → {sched.end_date}
                      </span>
                    </div>
                  </div>

                  {/* Row 3: Target AI Providers Badges */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider">
                      Target AI Engines ({providerCount}):
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {sched.providers.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background px-2 py-1 text-[11px] font-medium text-foreground shadow-2xs"
                        >
                          <Sparkles className="size-2.5 text-primary" />
                          <span>{PROVIDER_LABELS[p] ?? p}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Row 4: Usage Projection (if estimate available) */}
                  {sched.estimate && (
                    <div className="rounded-xl border border-border/60 bg-secondary/15 p-2.5 text-xs flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Estimated Run Cost:</span>
                        <span className="font-mono font-bold text-foreground">
                          {sched.estimate.estimated_prompt_runs} Prompt Runs
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground font-mono">
                        <span>Projected Period Usage: {Math.round(sched.estimate.usage_percentage)}%</span>
                        <span
                          className={cn(
                            "font-bold",
                            sched.estimate.status === "SAFE"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {sched.estimate.status}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Action Footer */}
                <div className="flex items-center justify-between border-t border-border/60 pt-3.5 mt-4">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleTogglePause(sched)}
                      className={cn(
                        "h-8 rounded-xl text-xs font-semibold gap-1.5 shadow-2xs cursor-pointer",
                        sched.status === "active"
                          ? "hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30"
                          : "hover:bg-emerald-500/10 hover:text-emerald-600 hover:border-emerald-500/30"
                      )}
                    >
                      {isBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : sched.status === "active" ? (
                        <>
                          <Pause className="size-3" />
                          <span>Pause Schedule</span>
                        </>
                      ) : (
                        <>
                          <Play className="size-3" />
                          <span>Resume Schedule</span>
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => handleRunNow(sched)}
                      className="h-8 rounded-xl text-xs font-semibold gap-1.5 shadow-2xs cursor-pointer border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                      title="Run all prompt audits in this schedule right now (fast instant execution)"
                    >
                      {isBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <>
                          <Zap className="size-3 text-amber-500 fill-amber-500" />
                          <span>Run Now</span>
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => onOpenEditModal(sched)}
                      className="h-8 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary gap-1"
                    >
                      <Edit2 className="size-3" />
                      <span>Edit</span>
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleDelete(sched.id)}
                    className="h-8 rounded-xl text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                    title="Delete schedule"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
