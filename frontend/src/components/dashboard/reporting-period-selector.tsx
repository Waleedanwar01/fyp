"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarRange,
  Check,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { presetRange, type DateRangeFilter } from "@/components/dashboard/use-client-visibility";

export type PeriodPreset = "all" | "7d" | "30d" | "90d" | "custom";

const PRESET_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

function presetFor(value: DateRangeFilter): PeriodPreset {
  if (!value.since && !value.until) return "all";
  for (const [id, days] of Object.entries(PRESET_DAYS)) {
    const r = presetRange(days);
    if (r.since === value.since && r.until === value.until) return id as PeriodPreset;
  }
  return "custom";
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One-click ranges offered inside the custom popover. */
function quickRanges(): { label: string; range: DateRangeFilter }[] {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return [
    { label: "Last 14 days", range: presetRange(14) },
    { label: "This month", range: { since: iso(new Date(now.getFullYear(), now.getMonth(), 1)), until: iso(now) } },
    {
      label: "Last month",
      range: {
        since: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        until: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      },
    },
    { label: "Last 6 months", range: presetRange(182) },
  ];
}

export function ReportingPeriodSelector({
  value,
  onChange,
  compact = false,
  busy = false,
}: {
  value: DateRangeFilter;
  onChange: (filter: DateRangeFilter) => void;
  /** Toolbar variant: just the preset segments, custom dates in a popover. */
  compact?: boolean;
  /** Data for the selected period is still loading. */
  busy?: boolean;
}) {
  // Derived from the value, so a period set elsewhere (e.g. "Show all
  // time" on the dashboard) still highlights the right segment.
  const activePreset = presetFor(value);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customSince, setCustomSince] = useState<string>("");
  const [customUntil, setCustomUntil] = useState<string>("");

  useEffect(() => {
    if (!isCustomOpen) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setIsCustomOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsCustomOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isCustomOpen]);

  const presets: { id: PeriodPreset; label: string; days?: number }[] = [
    { id: "all", label: "All Time" },
    { id: "7d", label: "7 Days", days: 7 },
    { id: "30d", label: "30 Days", days: 30 },
    { id: "90d", label: "90 Days", days: 90 },
    { id: "custom", label: "Custom Window" },
  ];

  const handleSelectPreset = (preset: PeriodPreset) => {
    if (preset === "all") {
      setIsCustomOpen(false);
      onChange({ since: null, until: null });
      return;
    }

    if (preset === "custom") {
      setIsCustomOpen(true);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const untilStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const sinceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      const sinceStr = `${sinceDate.getFullYear()}-${pad(sinceDate.getMonth() + 1)}-${pad(sinceDate.getDate())}`;
      if (!customSince) setCustomSince(value.since ?? sinceStr);
      if (!customUntil) setCustomUntil(value.until ?? untilStr);
      return;
    }

    setIsCustomOpen(false);
    const target = presets.find((p) => p.id === preset);
    if (target?.days) {
      const range = presetRange(target.days);
      setCustomSince(range.since ?? "");
      setCustomUntil(range.until ?? "");
      onChange(range);
    }
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSince && customUntil) {
      if (customSince > customUntil) {
        return;
      }
      onChange({
        since: customSince,
        until: customUntil,
      });
    }
  };

  const handleReset = () => {
    setIsCustomOpen(false);
    setCustomSince("");
    setCustomUntil("");
    onChange({ since: null, until: null });
  };

  if (compact) {
    const customLabel =
      activePreset === "custom" && value.since && value.until ? `${fmtDay(value.since)} – ${fmtDay(value.until)}` : "Custom";
    const shortLabel: Record<PeriodPreset, string> = { all: "All", "7d": "7D", "30d": "30D", "90d": "90D", custom: customLabel };
    return (
      <div className="relative" ref={popoverRef}>
        <div
          role="group"
          aria-label="Reporting period"
          className="flex h-10 items-center gap-0.5 rounded-lg border border-border bg-card p-1"
        >
          {presets.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => (preset.id === "custom" && isCustomOpen ? setIsCustomOpen(false) : handleSelectPreset(preset.id))}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {busy && isActive ? (
                  <Loader2 className="size-3.5 animate-spin" aria-label="Loading" />
                ) : (
                  preset.id === "custom" && <CalendarRange className="size-3.5" />
                )}
                {shortLabel[preset.id]}
              </button>
            );
          })}
        </div>

        {isCustomOpen && (
          <form
            onSubmit={(e) => {
              handleApplyCustom(e);
              if (customSince && customUntil && customSince <= customUntil) setIsCustomOpen(false);
            }}
            className="absolute right-0 top-12 z-dropdown flex w-72 flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-xs shadow-lg"
          >
            <p className="font-semibold text-foreground">Custom range</p>
            <div className="flex flex-wrap gap-1.5">
              {quickRanges().map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    setCustomSince(q.range.since ?? "");
                    setCustomUntil(q.range.until ?? "");
                    onChange(q.range);
                    setIsCustomOpen(false);
                  }}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">From</span>
              <Input type="date" value={customSince} max={customUntil || undefined} onChange={(e) => setCustomSince(e.target.value)} className="h-9 text-xs" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">To</span>
              <Input type="date" value={customUntil} min={customSince || undefined} onChange={(e) => setCustomUntil(e.target.value)} className="h-9 text-xs" />
            </label>
            {customSince && customUntil && customSince > customUntil && (
              <p className="text-destructive">Start date must be before end date.</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleReset} className="h-8 text-xs">
                Reset
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs">
                Apply
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Active Range Header */}
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-2xs">
            <CalendarRange className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Reporting Window
              </span>
              <span className="size-1 rounded-full bg-primary" />
            </div>
            <span className="text-xs font-semibold text-foreground font-mono">
              {!value.since && !value.until
                ? "All-Time Historical Coverage"
                : `${value.since ?? "Beginning"} to ${value.until ?? "Today"}`}
            </span>
          </div>
        </div>

        {/* Preset Button Pills */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-secondary/30 p-1 text-xs">
          {presets.map((preset) => {
            const isActive = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset.id)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Date Inputs Dropdown/Drawer */}
      {isCustomOpen && (
        <form
          onSubmit={handleApplyCustom}
          className="mt-2 flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-medium text-xs">Since:</span>
            <Input
              type="date"
              value={customSince}
              onChange={(e) => setCustomSince(e.target.value)}
              className="h-8 text-xs font-mono w-36 bg-card"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-medium text-xs">Until:</span>
            <Input
              type="date"
              value={customUntil}
              onChange={(e) => setCustomUntil(e.target.value)}
              className="h-8 text-xs font-mono w-36 bg-card"
            />
          </div>

          <Button type="submit" size="sm" className="h-8 text-xs gap-1.5 font-semibold">
            <Check className="size-3.5" />
            <span>Apply Window</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            <span>Reset</span>
          </Button>
        </form>
      )}
    </div>
  );
}
