"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  CheckCircle2,
  Play,
  Search,
  Sparkles,
  Tag,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, extractErrorMessage } from "@/lib/api";
import { matchTestSchema, type MatchTestInput } from "@/lib/validation";
import { cn } from "@/lib/utils";

type MatchResult = {
  matched: boolean;
  matches: { term: string; is_primary: boolean; start: number; end: number }[];
};

export function MatchTester({ testUrl, label }: { testUrl: string; label: string }) {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MatchTestInput>({ resolver: zodResolver(matchTestSchema) });

  const runTest = async (data: MatchTestInput) => {
    setTestError(null);
    setResult(null);
    try {
      const { data: response } = await api.post<MatchResult>(testUrl, { text: data.text });
      setResult(response);
    } catch (error) {
      setTestError(extractErrorMessage(error));
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-secondary/15 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <h4 className="text-xs font-bold text-foreground capitalize">
            Test {label} Extraction Matching
          </h4>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">Regex &amp; Token Pipeline</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Paste sample AI output or review text to verify if this {label}&apos;s official name or aliases trigger an extraction hit.
      </p>

      <form onSubmit={handleSubmit(runTest)} className="flex flex-col gap-2.5">
        <Textarea
          rows={3}
          placeholder={`e.g. In Lahore, we highly recommend trying out their famous spicy fillet burger.`}
          className="rounded-xl text-xs bg-background resize-none focus:ring-1"
          {...register("text")}
        />
        {errors.text && <p className="text-xs text-destructive">{errors.text.message}</p>}

        <div className="flex items-center justify-between pt-1">
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={isSubmitting}
            className="h-7.5 px-3 text-xs font-semibold rounded-lg gap-1.5"
          >
            <Play className="size-3 fill-primary text-primary" />
            <span>{isSubmitting ? "Testing Pipeline…" : `Test Matching`}</span>
          </Button>
        </div>
      </form>

      {testError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>{testError}</span>
        </div>
      )}

      {result && (
        <div
          className={cn(
            "rounded-xl border p-3 text-xs flex flex-col gap-2 transition-all",
            result.matched
              ? "border-emerald-500/30 bg-emerald-500/5 text-foreground"
              : "border-border/70 bg-secondary/40 text-muted-foreground"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5">
              {result.matched ? (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                    Extraction Successful ({result.matches.length} Match{result.matches.length === 1 ? "" : "es"})
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="size-3.5 text-muted-foreground" />
                  <span>No entity matches detected</span>
                </>
              )}
            </span>
          </div>

          {result.matched && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-emerald-500/20">
              {result.matches.map((m, i) => (
                <span
                  key={`${m.term}-${m.start}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-card border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-2xs"
                >
                  <Tag className="size-2.5 text-emerald-600 dark:text-emerald-400" />
                  <strong className="text-primary font-bold">&ldquo;{m.term}&rdquo;</strong>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    ({m.is_primary ? "Primary Name" : "Alias"}, chars {m.start}-{m.end})
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
