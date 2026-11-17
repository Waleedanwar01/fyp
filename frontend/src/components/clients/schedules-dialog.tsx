"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Calendar,
  Clock,
  Edit2,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Check,
} from "lucide-react";

import { FormField } from "@/components/auth/form-field";
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
import { cn } from "@/lib/utils";
import { api, extractErrorMessage } from "@/lib/api";
import { promptScheduleSchema, type PromptScheduleInput } from "@/lib/validation";
import type { PromptRecord } from "@/components/clients/prompts-dialog";
import { PROVIDER_LABELS } from "@/lib/providers";

export type OtherScheduleCommitment = {
  schedule_id: string;
  client_id: string;
  end_date: string;
  executed_so_far: number;
  remaining_prompt_runs: number;
};

export type UsageEstimate = {
  prompt_count: number;
  provider_count: number;
  scheduled_execution_count: number;
  estimated_prompt_runs: number;
  current_usage: number;
  base_allowance: number;
  rollover_received: number;
  total_available: number;
  reserved_by_other_schedules: number;
  remaining_runs: number;
  projected_usage: number;
  excess_runs: number;
  usage_percentage: number;
  status: "SAFE" | "WARNING" | "EXCEEDS_LIMIT";
  runs_per_execution: number;
  supported_executions: number;
  forecast_exhaustion_date: string | null;
  billing_period_end: string;
  first_execution: string | null;
  last_execution: string | null;
  forecast_message: string | null;
  other_active_schedules?: OtherScheduleCommitment[];
};

export type ScheduleFrequency = "once" | "daily" | "weekly" | "monthly" | "custom";
export type ScheduleStatus =
  | "draft"
  | "active"
  | "paused"
  | "paused_limit_reached"
  | "paused_subscription"
  | "completed"
  | "cancelled";

export type PromptScheduleRecord = {
  id: string;
  client: string;
  brand: string;
  prompts: string[];
  providers: string[];
  frequency: ScheduleFrequency;
  custom_interval_days: number | null;
  start_date: string;
  end_date: string;
  run_time: string;
  timezone: string;
  status: ScheduleStatus;
  estimate: UsageEstimate | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionSummary = {
  status: string;
  current_period_end: string;
  plan: {
    name: string;
    prompt_runs_included: number;
    providers: string[];
  };
  current_billing_period?: {
    prompt_runs_used: number;
    prompt_runs_remaining: number;
    total_available: number;
  };
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: "daily", label: "Daily (Every day)" },
  { value: "once", label: "Once (Single execution)" },
  { value: "weekly", label: "Weekly (Every 7 days)" },
  { value: "monthly", label: "Monthly (Every 30 days)" },
  { value: "custom", label: "Custom Interval" },
];

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  draft: "bg-secondary text-muted-foreground border-border",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium",
  paused_limit_reached: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium",
  paused_subscription: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium",
  completed: "bg-secondary text-foreground border-border",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  paused_limit_reached: "Limit Reached",
  paused_subscription: "Subscription Expired",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function SchedulesDialog({
  clientId,
  clientName,
  brandId,
  prompts,
  schedules,
  onClose,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  brandId: string | null;
  prompts: PromptRecord[];
  schedules: PromptScheduleRecord[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<PromptScheduleRecord | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const promptText = (id: string) => prompts.find((p) => p.id === id)?.text ?? "(deleted prompt)";

  const openCreateDialog = () => {
    setEditingSchedule(null);
    setFormOpen(true);
  };

  const openEditDialog = (schedule: PromptScheduleRecord) => {
    setEditingSchedule(schedule);
    setFormOpen(true);
  };

  const resumeSchedule = async (id: string) => {
    setRowError(null);
    try {
      await api.post(`/prompt-schedules/${id}/resume/`);
      onChanged();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  const pauseSchedule = async (id: string) => {
    setRowError(null);
    try {
      await api.post(`/prompt-schedules/${id}/pause/`);
      onChanged();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!window.confirm("Delete this schedule? Active prompts will no longer run automatically.")) return;
    setRowError(null);
    try {
      await api.delete(`/prompt-schedules/${id}/`);
      onChanged();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col p-6 gap-5">
          <DialogHeader className="gap-1.5 pb-2 border-b border-border/70">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Clock className="size-4" />
              </div>
              <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
                Automated Audit Schedules
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Automated recurring search audits for <strong className="font-semibold text-foreground">{clientName}</strong>. Runs prompt queries within your plan&apos;s available credit allowance.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              Active Schedules ({schedules.length})
            </span>

            <Button
              type="button"
              size="sm"
              onClick={openCreateDialog}
              disabled={!brandId || prompts.length === 0}
              className="h-8 px-3 text-xs font-medium"
            >
              <Plus className="size-3.5 mr-1.5" /> Create Schedule
            </Button>
          </div>

          {!brandId && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              Please configure a brand for this client before creating schedules.
            </p>
          )}

          {rowError && (
            <p className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              {rowError}
            </p>
          )}

          {schedules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center flex flex-col items-center justify-center bg-secondary/10">
              <Calendar className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs font-semibold text-foreground">No automated schedules set</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">
                Set a daily or weekly schedule to benchmark and track your AI search visibility continuously.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[55vh] pr-1 no-scrollbar">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs flex flex-col gap-3 transition-all hover:border-border"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs capitalize text-foreground">
                          {s.frequency} Schedule
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold",
                            STATUS_STYLES[s.status]
                          )}
                        >
                          {STATUS_LABELS[s.status]}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{s.prompts.length}</span> prompt{s.prompts.length === 1 ? "" : "s"} &bull; Provider:{" "}
                        <span className="font-semibold text-foreground">
                          {s.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")}
                        </span>
                      </p>

                      <p className="text-[11px] text-muted-foreground font-mono">
                        {s.start_date} &rarr; {s.end_date} at {s.run_time.slice(0, 5)} ({s.timezone})
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditDialog(s)}
                        className="h-7 px-2.5 text-xs"
                      >
                        <Edit2 className="size-3 mr-1" /> Edit
                      </Button>

                      {(s.status === "paused" || s.status === "paused_limit_reached") && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => resumeSchedule(s.id)}
                          className="h-7 px-2.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium"
                        >
                          <Play className="size-3 mr-1 fill-current" /> Resume
                        </Button>
                      )}

                      {s.status === "active" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => pauseSchedule(s.id)}
                          className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Pause className="size-3 mr-1" /> Pause
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSchedule(s.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Queries: </span>
                    {s.prompts.slice(0, 2).map(promptText).join("; ")}
                    {s.prompts.length > 2 ? ` (+${s.prompts.length - 2} more)` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {formOpen && brandId && (
        <ScheduleFormDialog
          clientId={clientId}
          brandId={brandId}
          prompts={prompts}
          scheduleToEdit={editingSchedule}
          onClose={() => setFormOpen(false)}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

function UsageEstimatePanel({
  estimate,
  loading,
  error,
}: {
  estimate: UsageEstimate | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <span className="size-2 rounded-full bg-primary animate-ping" />
        <span>Calculating schedule usage & subscription allowance…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
        Could not calculate estimate: {error}
      </div>
    );
  }
  if (!estimate) return null;

  const isExceeded = estimate.status === "EXCEEDS_LIMIT";
  const isWarning = estimate.status === "WARNING";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3.5 text-xs transition-all",
        isExceeded
          ? "border-destructive/40 bg-destructive/5"
          : isWarning
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border/80 bg-secondary/20"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Zap className="size-3.5 text-primary fill-primary" />
          <span>Subscription Run Budget Estimation</span>
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase",
            isExceeded
              ? "bg-destructive/15 text-destructive"
              : isWarning
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          )}
        >
          {estimate.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t border-border/60 pt-2.5 text-muted-foreground">
        <span>Runs required for this schedule:</span>
        <span className="text-right font-mono font-bold text-foreground">
          {estimate.estimated_prompt_runs} runs
        </span>

        <span>Current plan available runs:</span>
        <span className="text-right font-mono text-foreground">
          {estimate.remaining_runs} remaining
        </span>

        <span>Projected plan usage:</span>
        <span className="text-right font-mono text-foreground">
          {estimate.projected_usage} / {estimate.total_available} ({estimate.usage_percentage}%)
        </span>
      </div>

      {isExceeded && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Schedule Exceeds Available Credit Allowance</p>
            <p className="mt-0.5 leading-snug">
              This schedule requires <strong className="font-mono">{estimate.estimated_prompt_runs}</strong> runs, but your plan only has <strong className="font-mono">{estimate.remaining_runs}</strong> runs remaining in this billing period. Please select fewer prompts or adjust dates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleFormDialog({
  clientId,
  brandId,
  prompts,
  scheduleToEdit,
  onClose,
  onSaved,
}: {
  clientId: string;
  brandId: string;
  prompts: PromptRecord[];
  scheduleToEdit?: PromptScheduleRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!scheduleToEdit;
  const [formError, setFormError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [estimate, setEstimate] = useState<UsageEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PromptScheduleInput>({
    resolver: zodResolver(promptScheduleSchema),
    defaultValues: {
      brand: brandId,
      prompts: scheduleToEdit?.prompts ?? prompts.map((p) => p.id),
      providers: ["gemini"],
      frequency: scheduleToEdit?.frequency ?? "daily",
      customIntervalDays: scheduleToEdit?.custom_interval_days ? String(scheduleToEdit.custom_interval_days) : "",
      startDate: scheduleToEdit?.start_date ?? todayIsoDate(),
      endDate: scheduleToEdit?.end_date ?? "",
      runTime: scheduleToEdit?.run_time
        ? scheduleToEdit.run_time.slice(0, 5)
        : new Date().toTimeString().slice(0, 5),
      timezone: scheduleToEdit?.timezone ?? "UTC",
    },
  });

  useEffect(() => {
    api
      .get<SubscriptionSummary>("/subscription/")
      .then(({ data }) => {
        setSubscription(data);
        if (!scheduleToEdit?.end_date && data?.current_period_end) {
          setValue("endDate", data.current_period_end);
        }
      })
      .catch(() => setSubscription(null));
  }, [scheduleToEdit, setValue]);

  const watched = watch();
  const promptsKey = watched.prompts.join(",");
  const providersKey = watched.providers.join(",");

  const runEstimate = () => {
    setEstimating(true);
    setEstimateError(null);
    return api
      .post<UsageEstimate>("/prompt-schedules/estimate/", {
        client: clientId,
        schedule_id: scheduleToEdit?.id,
        prompts: watched.prompts,
        providers: ["gemini"],
        frequency: watched.frequency,
        custom_interval_days: watched.customIntervalDays ? Number(watched.customIntervalDays) : undefined,
        start_date: watched.startDate,
        end_date: watched.endDate,
        timezone: watched.timezone || "UTC",
      })
      .then(({ data }) => setEstimate(data))
      .catch((error) => {
        setEstimate(null);
        setEstimateError(extractErrorMessage(error));
      })
      .finally(() => setEstimating(false));
  };

  useEffect(() => {
    if (
      !watched.prompts.length ||
      !watched.startDate ||
      !watched.endDate ||
      (watched.frequency === "custom" && !watched.customIntervalDays)
    ) {
      setEstimate(null);
      setEstimateError(null);
      return;
    }
    const timer = setTimeout(runEstimate, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clientId,
    promptsKey,
    providersKey,
    watched.frequency,
    watched.customIntervalDays,
    watched.startDate,
    watched.endDate,
    watched.timezone,
  ]);

  const submit = async (data: PromptScheduleInput) => {
    setFormError(null);
    try {
      const payload = {
        client: clientId,
        brand: data.brand,
        prompts: data.prompts,
        providers: ["gemini"],
        frequency: data.frequency,
        custom_interval_days: data.customIntervalDays ? Number(data.customIntervalDays) : undefined,
        start_date: data.startDate,
        end_date: data.endDate,
        run_time: data.runTime,
        timezone: data.timezone || "UTC",
      };

      if (isEditing && scheduleToEdit) {
        await api.patch(`/prompt-schedules/${scheduleToEdit.id}/`, payload);
      } else {
        await api.post("/prompt-schedules/", payload);
      }

      onSaved();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("avtr:subscription-updated"));
      }
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  const selectAllPrompts = () => {
    setValue("prompts", prompts.map((p) => p.id));
  };

  const deselectAllPrompts = () => {
    setValue("prompts", []);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl md:max-w-2xl max-h-[90vh] flex flex-col p-6 gap-0">
        <DialogHeader className="gap-1 pb-4 border-b border-border/70 shrink-0">
          <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
            {isEditing ? "Edit Audit Schedule" : "Create Audit Schedule"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure automated search prompt audits within your subscription credit allowance.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="flex flex-col flex-1 min-h-0 pt-4" noValidate>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 max-h-[60vh] no-scrollbar">
            {/* Prompts Picker */}
            <FormField label="Target Prompts" htmlFor="schedule-prompts" error={errors.prompts?.message}>
              <div className="flex items-center justify-between pb-1 text-xs text-muted-foreground">
                <span>Select queries ({watched.prompts.length} of {prompts.length} selected):</span>
                <div className="flex gap-2 text-[11px] font-medium">
                  <button type="button" onClick={selectAllPrompts} className="text-primary hover:underline">
                    Select All
                  </button>
                  <span className="text-border">&bull;</span>
                  <button type="button" onClick={deselectAllPrompts} className="text-muted-foreground hover:underline">
                    Clear
                  </button>
                </div>
              </div>
              <Controller
                name="prompts"
                control={control}
                render={({ field }) => (
                  <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-xl border border-border/80 p-2 bg-secondary/10">
                    {prompts.map((p) => {
                      const isChecked = field.value.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className={cn(
                            "flex items-start gap-2.5 text-xs text-foreground cursor-pointer p-2 rounded-lg transition-colors",
                            isChecked ? "bg-card shadow-2xs border border-border/60" : "hover:bg-secondary/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-primary shrink-0"
                            checked={isChecked}
                            onChange={(event) =>
                              field.onChange(
                                event.target.checked
                                  ? [...field.value, p.id]
                                  : field.value.filter((id) => id !== p.id)
                              )
                            }
                          />
                          <span className="truncate leading-snug text-foreground">{p.text}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            </FormField>

            {/* AI Provider */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">AI Intelligence Engine</span>
              <div className="flex items-center gap-3 rounded-xl border border-border/80 bg-card p-2.5 text-xs shadow-2xs">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                  G
                </span>
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground">Google Gemini 2.5 Flash</span>
                  <span className="text-[11px] text-muted-foreground">Primary Search Recommendation Benchmark</span>
                </div>
                <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] px-2 py-0.5 ml-auto font-semibold">
                  Active & Configured
                </span>
              </div>
            </div>

            {/* Frequency & Run Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <FormField label="Frequency" htmlFor="schedule-frequency" error={errors.frequency?.message}>
                <select
                  id="schedule-frequency"
                  className="h-9 w-full rounded-lg border border-border/80 bg-card px-3 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
                  {...register("frequency")}
                >
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Daily Run Time" htmlFor="schedule-run-time" error={errors.runTime?.message}>
                <Input id="schedule-run-time" type="time" className="h-9 text-xs" {...register("runTime")} />
                <span className="text-[10.5px] text-muted-foreground flex items-center gap-1 font-medium mt-1">
                  <Zap className="size-3 fill-amber-500 text-amber-500 shrink-0" />
                  <span>First audit will run immediately upon saving if starting today.</span>
                </span>
              </FormField>
            </div>

            {watched.frequency === "custom" && (
              <FormField
                label="Interval (Run every N days)"
                htmlFor="schedule-interval"
                error={errors.customIntervalDays?.message}
              >
                <Input id="schedule-interval" type="number" min={1} className="h-9 text-xs" {...register("customIntervalDays")} />
              </FormField>
            )}

            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <FormField label="Start Date" htmlFor="schedule-start" error={errors.startDate?.message}>
                <Input
                  id="schedule-start"
                  type="date"
                  min={todayIsoDate()}
                  className="h-9 text-xs"
                  {...register("startDate")}
                />
              </FormField>
              <FormField label="End Date" htmlFor="schedule-end" error={errors.endDate?.message}>
                <Input
                  id="schedule-end"
                  type="date"
                  min={watched.startDate || todayIsoDate()}
                  max={subscription?.current_period_end}
                  className="h-9 text-xs"
                  {...register("endDate")}
                />
              </FormField>
            </div>

            <FormField label="Timezone" htmlFor="schedule-timezone" error={errors.timezone?.message}>
              <Input id="schedule-timezone" placeholder="e.g. UTC, Asia/Karachi, America/New_York" className="h-9 text-xs" {...register("timezone")} />
            </FormField>

            {/* Live Subscription Budget Estimate */}
            <UsageEstimatePanel
              estimate={estimate}
              loading={estimating}
              error={estimateError}
            />

            {formError && (
              <p className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter className="pt-4 mt-2 border-t border-border/70 shrink-0 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting} className="h-9 text-xs">
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || estimate?.status === "EXCEEDS_LIMIT"}
              className="h-9 text-xs font-semibold px-4"
            >
              {isSubmitting ? "Saving Schedule…" : isEditing ? "Update Schedule" : "Activate Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
