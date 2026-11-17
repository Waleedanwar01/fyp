"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, CheckCircle2, ChevronDown, Search, ShieldAlert } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CHART_TOOLTIP_STYLE, seriesColor } from "@/lib/chart-colors";
import { useCompetitorVisibility } from "@/components/dashboard/use-competitor-visibility";
import type { DateRangeFilter } from "@/components/dashboard/use-client-visibility";
import { PROVIDER_LABELS } from "@/lib/providers";

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 1000) / 10}%`;
}

type Row = {
  id: string;
  name: string;
  isOwn: boolean;
  color: string;
  visibility: number | null;
  share: number;
  mention: number | null;
  position: number | null;
  sentiment: number | null;
  runs: number;
};

const METRICS = [
  { key: "visibility", label: "Visibility" },
  { key: "share", label: "Share of voice" },
  { key: "mention", label: "Mention rate" },
  { key: "position", label: "Position" },
  { key: "sentiment", label: "Sentiment" },
] as const;

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-xl border border-border bg-card", className)}>{children}</section>;
}

function PanelHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function BrandVsCompetitorView({
  dateFilter,
  initialClientId,
}: {
  dateFilter?: DateRangeFilter;
  initialClientId?: string;
}) {
  const { data: comparisons, isLoading, isRefreshing, error } = useCompetitorVisibility(dateFilter);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPromptIdx, setExpandedPromptIdx] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-80 animate-pulse rounded-xl border border-border bg-card lg:col-span-2" />
          <div className="h-80 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    );
  }

  if (error || !comparisons || comparisons.length === 0) {
    return (
      <Panel className="px-5 py-12 text-center text-sm text-muted-foreground">
        {error || "No competitor data yet. Add competitors to a client's brand to compare visibility."}
      </Panel>
    );
  }

  const active =
    selectedClientId === "all"
      ? comparisons[0]
      : comparisons.find((c) => c.client.id === selectedClientId) ?? comparisons[0];
  const brandName = active.brand?.name ?? active.client.name;

  const rows: Row[] = [
    {
      id: "own",
      name: brandName,
      isOwn: true,
      color: seriesColor(0),
      visibility: active.brandScore?.visibility_score ?? null,
      share: active.shareOfVisibility.brandShare / 100,
      mention: active.brandScore?.components?.mention_rate ?? null,
      position: active.brandScore?.components?.position_score ?? null,
      sentiment: active.brandScore?.components?.sentiment_score ?? null,
      runs: active.brandScore?.total_runs ?? 0,
    },
    ...active.competitors.map((c, idx) => ({
      id: c.competitor.id,
      name: c.competitor.name,
      isOwn: false,
      color: seriesColor(idx + 1),
      visibility: c.score?.visibility_score ?? null,
      share:
        (active.shareOfVisibility.competitorShares.find((cs) => cs.competitorId === c.competitor.id)?.share ?? 0) / 100,
      mention: c.score?.components?.mention_rate ?? null,
      position: c.score?.components?.position_score ?? null,
      sentiment: c.score?.components?.sentiment_score ?? null,
      runs: c.score?.total_runs ?? 0,
    })),
  ];

  const ranked = [...rows].sort((a, b) => (b.visibility ?? -1) - (a.visibility ?? -1));
  const ownRank = ranked.findIndex((r) => r.isOwn) + 1;
  const best = Object.fromEntries(
    METRICS.map((m) => [m.key, Math.max(...rows.map((r) => (r[m.key] as number | null) ?? -1))])
  ) as Record<(typeof METRICS)[number]["key"], number>;
  const shareData = rows.filter((r) => r.share > 0).map((r) => ({ name: r.name, value: r.share, color: r.color }));

  const q = searchQuery.toLowerCase();
  const gaps = active.gapPrompts.filter(
    (gp) => gp.promptText.toLowerCase().includes(q) || gp.competitorsPresent.some((c) => c.name.toLowerCase().includes(q))
  );

  const kpis = [
    { label: "Visibility score", value: pct(active.brandScore?.visibility_score), hint: brandName },
    { label: "Share of voice", value: pct(rows[0].share), hint: `vs ${active.competitors.length} competitors` },
    {
      label: "Rank",
      value: ownRank > 0 ? `#${ownRank}` : "—",
      hint: `of ${rows.length} tracked brands`,
    },
    {
      label: "Gaps",
      value: String(active.gapPrompts.length),
      hint: "prompts where only competitors appeared",
      warn: active.gapPrompts.length > 0,
    },
  ];

  return (
    <div
      aria-busy={isRefreshing}
      className={cn("flex flex-col gap-4 transition-opacity duration-200", isRefreshing && "pointer-events-none opacity-60")}
    >
      {/* Header */}
      <Panel>
        <PanelHeader
          title="Competitor benchmark"
          description="How this client's brand compares with its competitors across AI engine answers"
          action={
            <label className="relative">
              <span className="sr-only">Client</span>
              <select
                value={active.client.id}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  setExpandedPromptIdx(null);
                }}
                className="h-9 min-w-48 cursor-pointer appearance-none rounded-lg border border-border bg-background pr-8 pl-3 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
              >
                {comparisons.map((c) => (
                  <option key={c.client.id} value={c.client.id}>
                    {c.client.name} · {c.competitors.length} competitors
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            </label>
          }
        />
        <div className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
          {kpis.map((k) => (
            <div key={k.label} className="px-5 py-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  k.warn ? "text-amber-500" : "text-foreground"
                )}
              >
                {k.value}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{k.hint}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Ranking */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Visibility ranking"
            description="Overall visibility score, highest first"
            action={
              <Link
                href={`/clients/${active.client.id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Client details
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          <ol className="flex flex-col gap-4 p-5">
            {ranked.map((r, i) => {
              const width = Math.max(0, Math.min(100, (r.visibility ?? 0) * 100));
              return (
                <li key={r.id} className="grid grid-cols-[1.5rem_minmax(0,9rem)_1fr_3.5rem] items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className={cn("truncate text-sm", r.isOwn ? "font-semibold text-foreground" : "text-foreground/90")}>
                      {r.name}
                    </span>
                    {r.isOwn && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        You
                      </span>
                    )}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${width}%`, background: r.color }}
                    />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-foreground">{pct(r.visibility)}</span>
                </li>
              );
            })}
          </ol>
        </Panel>

        {/* Share of voice */}
        <Panel>
          <PanelHeader title="Share of voice" description="Each brand's share of total visibility" />
          {shareData.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">No visibility recorded yet.</p>
          ) : (
            <div className="p-5">
              <div className="relative mx-auto h-44 w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shareData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="68%"
                      outerRadius="100%"
                      paddingAngle={2}
                      stroke="var(--card)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {shareData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [pct(Number(v)), "Share"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">{pct(rows[0].share)}</span>
                  <span className="text-[11px] text-muted-foreground">your share</span>
                </div>
              </div>
              <ul className="mt-5 flex flex-col gap-2">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className={cn("truncate", r.isOwn ? "font-medium text-foreground" : "text-muted-foreground")}>
                        {r.name}
                      </span>
                    </span>
                    <span className="tabular-nums text-foreground">{pct(r.share)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      {/* Matrix */}
      <Panel>
        <PanelHeader title="Comparison matrix" description="Every signal side by side. The leader in each column is highlighted." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-170 text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Brand</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="px-4 py-3 text-right font-medium">
                    {m.label}
                  </th>
                ))}
                <th className="px-5 py-3 text-right font-medium">Runs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cn("border-b border-border last:border-0", r.isOwn && "bg-primary/5")}>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className={cn(r.isOwn ? "font-semibold text-foreground" : "text-foreground/90")}>{r.name}</span>
                      {r.isOwn && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">You</span>
                      )}
                    </span>
                  </td>
                  {METRICS.map((m) => {
                    const v = r[m.key] as number | null;
                    const lead = v !== null && v === best[m.key] && v > 0;
                    return (
                      <td key={m.key} className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={cn(
                            lead
                              ? "rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {pct(v)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{r.runs.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Gap prompts */}
      <Panel>
        <PanelHeader
          title="Gap prompts"
          description={
            <>
              Prompts where AI engines named competitors but not <strong className="text-foreground">{brandName}</strong>
            </>
          }
          action={
            <div className="relative w-full sm:w-64">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search prompts or competitors"
                className="h-9 pl-9 text-sm"
              />
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          }
        />
        {gaps.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <CheckCircle2 className="mb-2 size-7 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">
              {active.gapPrompts.length === 0 ? "No gaps found" : "No gaps match your search"}
            </p>
            {active.gapPrompts.length === 0 && (
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Whenever an AI engine recommended a competitor, {brandName} was mentioned too.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {gaps.map((gap, idx) => {
              const open = expandedPromptIdx === idx;
              return (
                <li key={idx} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                        <ShieldAlert className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{gap.promptText}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            <Bot className="size-3" />
                            {PROVIDER_LABELS[gap.provider] ?? gap.provider}
                          </span>
                          {gap.competitorsPresent.map((cp, i) => {
                            const row = rows.find((r) => r.name === cp.name);
                            return (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
                              >
                                <span className="size-1.5 rounded-full" style={{ background: row?.color ?? "var(--muted-foreground)" }} />
                                {cp.name}
                                {cp.listRank ? <span className="text-muted-foreground">#{cp.listRank}</span> : null}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpandedPromptIdx(open ? null : idx)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 self-start rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {open ? "Hide answer" : "View answer"}
                      <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
                    </button>
                  </div>
                  {open && (
                    <p className="mt-3 rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {gap.responseText}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
