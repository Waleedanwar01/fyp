"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  History,
  Loader2,
  Quote,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api, extractErrorMessage } from "@/lib/api";
import type { PromptRecord } from "@/components/clients/prompts-dialog";

export type PromptRunRecord = {
  id: string;
  prompt: string;
  prompt_text: string;
  status: "pending" | "queued" | "running" | "completed" | "needs_review" | "failed";
  response_text: string;
  created_at: string;
  executed_at: string | null;
};

const STATUS_LABEL: Record<PromptRunRecord["status"], string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  needs_review: "Needs Review",
  failed: "Failed",
};

const STATUS_BADGE_CLASS: Record<PromptRunRecord["status"], string> = {
  pending: "bg-secondary text-secondary-foreground border-border",
  queued: "bg-secondary text-secondary-foreground border-border",
  running: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  needs_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const IN_FLIGHT_STATUSES: PromptRunRecord["status"][] = ["pending", "queued", "running"];
const POLL_INTERVAL_MS = 3000;

const MARKDOWN_COMPONENTS: Components = {
  p: ({ ...props }) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
  strong: ({ ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  ul: ({ ...props }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0" {...props} />,
  ol: ({ ...props }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0" {...props} />,
  li: ({ ...props }) => <li className="leading-snug" {...props} />,
  h1: ({ ...props }) => <h1 className="mt-2.5 mb-1 text-xs font-bold text-foreground first:mt-0" {...props} />,
  h2: ({ ...props }) => <h2 className="mt-2.5 mb-1 text-xs font-bold text-foreground first:mt-0" {...props} />,
  h3: ({ ...props }) => <h3 className="mt-2 mb-1 text-xs font-semibold text-foreground first:mt-0" {...props} />,
  a: ({ ...props }) => (
    <a className="underline underline-offset-2 text-primary hover:text-foreground" target="_blank" rel="noreferrer" {...props} />
  ),
  code: ({ ...props }) => (
    <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[10.5px]" {...props} />
  ),
  blockquote: ({ ...props }) => (
    <blockquote className="border-l-2 border-primary/40 pl-2 italic text-muted-foreground" {...props} />
  ),
  hr: () => <hr className="my-2 border-border/60" />,
};

function ResponseContent({ run }: { run: PromptRunRecord }) {
  if (run.status === "completed") {
    return (
      <div className="text-xs text-foreground/90">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {run.response_text}
        </ReactMarkdown>
      </div>
    );
  }
  return <p className="text-xs whitespace-pre-wrap leading-relaxed">{run.response_text}</p>;
}

export function PromptRunHistoryDialog({ prompt, onClose }: { prompt: PromptRecord; onClose: () => void }) {
  const [runs, setRuns] = useState<PromptRunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      api
        .get<PromptRunRecord[]>("/prompt-runs/", { params: { prompt: prompt.id } })
        .then(({ data }) => {
          if (cancelled) return;
          setRuns(data);
          if (data.some((run) => IN_FLIGHT_STATUSES.includes(run.status))) {
            timer = setTimeout(load, POLL_INTERVAL_MS);
          }
        })
        .catch((err) => !cancelled && setError(extractErrorMessage(err)));
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [prompt.id]);

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-6 gap-5">
        <DialogHeader className="gap-1.5 pb-3 border-b border-border/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <History className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Prompt Execution Audit History
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Historical AI responses, timestamped audit logs, and extraction scores for this query.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Prompt Text Card */}
        <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 flex items-start gap-2.5 shrink-0">
          <Quote className="size-3.5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Audited Query
            </span>
            <p className="text-xs font-semibold text-foreground mt-0.5 leading-snug">
              {prompt.text}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Runs List */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1 space-y-3 no-scrollbar">
          {runs === null && !error && (
            <div className="flex flex-col items-center justify-center p-8 gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-xs">Loading execution history…</span>
            </div>
          )}

          {runs !== null && runs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center flex flex-col items-center justify-center bg-secondary/10">
              <Clock className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs font-semibold text-foreground">No execution records found</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">
                This prompt has not run yet. Click &ldquo;Run now&rdquo; or wait for its recurring audit schedule to trigger.
              </p>
            </div>
          )}

          {runs !== null &&
            runs.map((run) => (
              <div
                key={run.id}
                className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs flex flex-col gap-3 transition-all hover:border-border"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                        STATUS_BADGE_CLASS[run.status]
                      )}
                    >
                      {STATUS_LABEL[run.status]}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground font-mono">
                      <Clock className="size-3" />
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>

                  {run.response_text && (
                    <button
                      onClick={() => copyText(run.id, run.response_text)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedId === run.id ? (
                        <>
                          <Check className="size-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          <span>Copy Output</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {run.response_text ? (
                  <div
                    className={cn(
                      "max-h-56 overflow-y-auto rounded-lg border p-3 text-xs leading-relaxed",
                      run.status === "failed"
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : run.status === "needs_review"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                        : "border-border/60 bg-secondary/20"
                    )}
                  >
                    <ResponseContent run={run} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">
                    Execution in progress or no response recorded.
                  </span>
                )}
              </div>
            ))}
        </div>

        <DialogFooter className="pt-2 shrink-0">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-xl text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
