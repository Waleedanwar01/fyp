"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";

import { api, extractErrorMessage } from "@/lib/api";
import { CHART_TOOLTIP_STYLE, seriesColor } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";
import type { ClientScore, DateRangeFilter } from "@/components/dashboard/use-client-visibility";

/** GET /brands/{id}/visibility-history/ -- one cumulative point per day,
 * computed server-side (core.visibility_score.visibility_score_history). */
type HistoryPoint = {
  date: string;
  visibility_score: number;
  mention_rate: number;
  position_score: number;
  sentiment_score: number;
  citation_score: number;
  total_runs: number;
};

const SERIES = [
  { key: "visibility_score", label: "Visibility", color: seriesColor(0), width: 3 },
  { key: "mention_rate", label: "Mention rate", color: seriesColor(1), width: 2 },
  { key: "position_score", label: "Position", color: seriesColor(2), width: 2 },
  { key: "sentiment_score", label: "Sentiment", color: seriesColor(3), width: 2 },
  { key: "citation_score", label: "Citations", color: seriesColor(4), width: 2 },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function HistoricalTrendsView({
  entries,
  dateFilter,
}: {
  entries: ClientScore[] | null;
  dateFilter?: DateRangeFilter;
}) {
  const withBrand = (entries ?? []).filter((e) => e.brandId);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Every signal is drawn by default; the legend chips toggle lines off and on.
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the first client that has runs; keep the user's pick if still listed.
  const active =
    withBrand.find((e) => e.client.id === pickedId) ??
    withBrand.find((e) => (e.score?.total_runs ?? 0) > 0) ??
    withBrand[0] ??
    null;
  const brandId = active?.brandId ?? null;
  const since = dateFilter?.since ?? null;
  const until = dateFilter?.until ?? null;

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const qs = params.toString();
    api
      .get<HistoryPoint[]>(`/brands/${brandId}/visibility-history/${qs ? `?${qs}` : ""}`)
      .then(({ data }) => {
        if (cancelled) return;
        setHistory(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setHistory(null);
        setError(extractErrorMessage(err));
      });
    return () => {
      cancelled = true;
      setHistory(null);
    };
  }, [brandId, since, until]);

  if (!entries) {
    return <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />;
  }

  if (withBrand.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
        Add a brand to a client to start tracking its visibility over time.
      </div>
    );
  }

  const first = history?.[0];
  const last = history?.[history.length - 1];
  const change = first && last && history && history.length > 1 ? last.visibility_score - first.visibility_score : null;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Visibility over time</h3>
          <p className="text-xs text-muted-foreground">Cumulative score at the end of each day with runs</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Client</span>
            <select
              value={active?.client.id ?? ""}
              onChange={(e) => setPickedId(e.target.value)}
              className="h-9 min-w-40 cursor-pointer appearance-none rounded-lg border border-border bg-background pr-8 pl-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
            >
              {withBrand.map((e) => (
                <option key={e.client.id} value={e.client.id}>
                  {e.client.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          </label>
        </div>
      </div>

      {/* Summary */}
      {last && (
        <div className="grid grid-cols-2 gap-4 border-b border-border px-5 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Current score</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{pct(last.visibility_score)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Change in period</p>
            <p
              className={cn(
                "mt-1 flex items-center gap-1 text-2xl font-semibold tabular-nums",
                change === null ? "text-muted-foreground" : change >= 0 ? "text-emerald-600" : "text-destructive"
              )}
            >
              {change === null ? (
                "—"
              ) : (
                <>
                  {change >= 0 ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
                  {change >= 0 ? "+" : ""}
                  {Math.round(change * 1000) / 10} pts
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Runs analysed</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{last.total_runs.toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="p-5">
        {error ? (
          <p className="py-12 text-center text-sm text-destructive">{error}</p>
        ) : history === null ? (
          <div className="h-72 animate-pulse rounded-lg bg-muted" />
        ) : history.length < 2 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {history.length === 0
              ? "No completed runs in this period yet."
              : "Only one day of runs so far — the trend line appears after runs on a second day."}
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Lines shown">
              {SERIES.map((s) => {
                const on = !hidden.has(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.key)) next.delete(s.key);
                        else next.add(s.key);
                        return next;
                      })
                    }
                    className={cn(
                      "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors",
                      on
                        ? "border-border bg-muted/60 text-foreground"
                        : "border-dashed border-border text-muted-foreground opacity-60 hover:opacity-100"
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: s.color, opacity: on ? 1 : 0.4 }} />
                    {s.label}
                    <span className="tabular-nums text-muted-foreground">{last ? pct(last[s.key]) : ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="h-80" role="img" aria-label={`Visibility trends for ${active?.client.name}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    labelFormatter={(label) => shortDate(String(label))}
                    formatter={(value) => pct(Number(value))}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
                  />
                  {SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={s.width}
                      dot={history.length <= 12 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
