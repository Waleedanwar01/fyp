"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Award,
  BarChart3,
  Bot,
  Building2,
  Calendar,
  ChevronDown,
  FileDown,
  Globe,
  ListOrdered,
  Percent,
  Plus,
  Smile,
  Swords,
  TrendingUp,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/8bit-button";
import { NotificationsCard } from "@/components/dashboard/notifications-card";
import { SubscriptionUsageCard } from "@/components/dashboard/subscription-usage-card";
import { MentionRateView } from "@/components/dashboard/mention-rate-view";
import { RecommendationPositionView } from "@/components/dashboard/recommendation-position-view";
import { MentionOrderView } from "@/components/dashboard/mention-order-view";
import { SentimentReportingView } from "@/components/dashboard/sentiment-reporting-view";
import { CitationReportingView } from "@/components/dashboard/citation-reporting-view";
import { BrandVsCompetitorView } from "@/components/dashboard/brand-vs-competitor-view";
import { HistoricalTrendsView } from "@/components/dashboard/historical-trends-view";
import { ReportingPeriodSelector } from "@/components/dashboard/reporting-period-selector";
import { VisibilityGauge } from "@/components/dashboard/visibility-gauge";
import { PromptIntelligenceView } from "@/components/dashboard/prompt-intelligence-view";
import { PdfExportModal } from "@/components/dashboard/pdf-export-modal";
import {
  prefetchReportingPeriods,
  useClientVisibility,
  type DateRangeFilter,
} from "@/components/dashboard/use-client-visibility";
import { useAuth } from "@/lib/auth-context";
import { aggregateProviderActivity } from "@/lib/providers";
import { cn } from "@/lib/utils";

type ReportTab =
  | "mention_rate"
  | "position_reporting"
  | "mention_order"
  | "sentiment_reporting"
  | "citation_reporting"
  | "competitor_comparison"
  | "historical_trends"
  | "prompt_intelligence";

const REPORT_TABS: { id: ReportTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "mention_rate", label: "Mention rate", icon: Percent },
  { id: "historical_trends", label: "Trends", icon: TrendingUp },
  { id: "position_reporting", label: "Positioning", icon: Award },
  { id: "mention_order", label: "Mention order", icon: ListOrdered },
  { id: "sentiment_reporting", label: "Sentiment", icon: Smile },
  { id: "citation_reporting", label: "Citations", icon: Globe },
  { id: "competitor_comparison", label: "Competitors", icon: Swords },
  { id: "prompt_intelligence", label: "AI answers", icon: Bot },
];

/** 0-1 → "57%", or an em dash when there's no data yet. */
function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function MeterBar({ value, className }: { value: number | null | undefined; className?: string }) {
  const width = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${width}%` }} />
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportTab>("mention_rate");
  const [selectedClientId, setSelectedClientId] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>({ since: null, until: null });
  const { entries, error, isLoading, isRefreshing } = useClientVisibility(dateFilter);

  // Once the first view is on screen, load the other reporting periods in
  // the background so switching 7D / 30D / 90D / All is instant.
  const hasEntries = !!entries;
  useEffect(() => {
    if (!hasEntries) return;
    const t = window.setTimeout(prefetchReportingPeriods, 800);
    return () => window.clearTimeout(t);
  }, [hasEntries]);

  // PDF Export Modal State
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfTargetClientId, setPdfTargetClientId] = useState<string | undefined>(undefined);
  const [pdfTargetClientName, setPdfTargetClientName] = useState<string | undefined>(undefined);

  const clientOptions = useMemo(() => {
    return (entries ?? []).map((e) => ({
      id: e.client.id,
      name: e.client.name,
    }));
  }, [entries]);

  const selectedClientEntry = useMemo(() => {
    if (selectedClientId === "all" || !entries) return null;
    return entries.find((e) => e.client.id === selectedClientId) || null;
  }, [entries, selectedClientId]);

  const displayedEntries = useMemo(() => {
    if (!entries) return null;
    if (selectedClientId === "all") return entries;
    return entries.filter((e) => e.client.id === selectedClientId);
  }, [entries, selectedClientId]);

  if (!user) return <AppShell>{null}</AppShell>;

  const handleOpenPdfModal = (clientId?: string, clientName?: string) => {
    setPdfTargetClientId(clientId || (selectedClientId !== "all" ? selectedClientId : undefined));
    setPdfTargetClientName(clientName || selectedClientEntry?.client.name);
    setPdfModalOpen(true);
  };

  // ---- Aggregates (all derived from the one visibility fetch) ----
  const rows = displayedEntries ?? [];
  const scored = rows.filter((e) => e.score?.visibility_score != null);
  const avgScore = scored.length
    ? scored.reduce((a, e) => a + (e.score?.visibility_score ?? 0), 0) / scored.length
    : null;
  const totalRuns = rows.reduce((a, e) => a + (e.score?.total_runs ?? 0), 0);
  const mentionRuns = rows.reduce((a, e) => a + (e.score?.runs_with_mention ?? 0), 0);
  const mentionRate = totalRuns ? mentionRuns / totalRuns : null;
  const providerActivity = aggregateProviderActivity(rows.map((e) => e.score?.prompt_runs ?? []));
  const loadingFirst = isLoading && !entries;

  // Average of each score signal over brands that have one. The weights that
  // combine them are proprietary and are never shown in the UI.
  const withComponents = rows.filter((e) => e.score?.components);
  const avgComponent = (key: "mention_rate" | "position_score" | "sentiment_score" | "citation_score") =>
    withComponents.length
      ? withComponents.reduce((a, e) => a + (e.score?.components?.[key] ?? 0), 0) / withComponents.length
      : null;
  const scoreParts = [
    { label: "Mention rate", value: avgComponent("mention_rate") },
    { label: "Position", value: avgComponent("position_score") },
    { label: "Sentiment", value: avgComponent("sentiment_score") },
    { label: "Citations", value: avgComponent("citation_score") },
  ];

  const kpis = [
    {
      label: "Visibility score",
      value: pct(avgScore),
      hint: `Average of ${scored.length} scored ${scored.length === 1 ? "brand" : "brands"}`,
      icon: BarChart3,
      meter: avgScore,
    },
    {
      label: "Mention rate",
      value: pct(mentionRate),
      hint: totalRuns ? `${mentionRuns.toLocaleString()} of ${totalRuns.toLocaleString()} runs` : "No runs yet",
      icon: TrendingUp,
      meter: mentionRate,
    },
    {
      label: "AI runs",
      value: totalRuns.toLocaleString(),
      hint: "Completed prompt evaluations",
      icon: Bot,
      meter: null,
    },
    {
      label: "Brands tracked",
      value: rows.length.toLocaleString(),
      hint: selectedClientEntry ? selectedClientEntry.client.name : "Across all clients",
      icon: Building2,
      meter: null,
    },
  ];

  const sortedClients = [...rows].sort(
    (a, b) => (b.score?.visibility_score ?? -1) - (a.score?.visibility_score ?? -1)
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* ── Page header ─────────────────────────────────────────── */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome back{user.agency?.name ? `, ${user.agency.name}` : ""}. Here&apos;s how AI engines see your clients.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {entries && entries.length > 0 && (
              <label className="relative">
                <span className="sr-only">Client</span>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="h-10 min-w-44 cursor-pointer appearance-none rounded-lg border border-border bg-card pr-9 pl-3 text-sm font-medium text-foreground transition-colors outline-none hover:border-primary/40 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
                >
                  <option value="all">All clients ({entries.length})</option>
                  {entries.map((e) => (
                    <option key={e.client.id} value={e.client.id}>
                      {e.client.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
              </label>
            )}
            <ReportingPeriodSelector compact value={dateFilter} onChange={setDateFilter} busy={isRefreshing} />
            <Button type="button" onClick={() => handleOpenPdfModal()} className="mx-1.5 h-10 px-4">
              <FileDown className="size-4" />
              Export
            </Button>
          </div>
        </header>

        {/* Period switch in progress: the previous numbers stay visible meanwhile. */}
        <div
          role="status"
          aria-live="polite"
          className={cn("-mt-3 h-0.5 overflow-hidden rounded-full transition-opacity", isRefreshing ? "opacity-100" : "opacity-0")}
        >
          {isRefreshing && (
            <>
              <span className="sr-only">Updating for the selected period</span>
              <div className="avtr-progress h-full w-1/3 rounded-full bg-primary" />
            </>
          )}
        </div>

        {/* Date filter empty-state notice */}
        {!isRefreshing && dateFilter.since && displayedEntries && displayedEntries.every((e) => !e.score || e.score.total_runs === 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="size-4 shrink-0" />
              No runs between <strong className="text-foreground">{dateFilter.since}</strong> and{" "}
              <strong className="text-foreground">{dateFilter.until ?? "today"}</strong>.
            </span>
            <button
              type="button"
              onClick={() => setDateFilter({ since: null, until: null })}
              className="font-medium text-primary hover:underline"
            >
              Show all time
            </button>
          </div>
        )}

        {/* ── KPI row ─────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Key metrics">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{kpi.label}</span>
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {loadingFirst ? <span className="inline-block h-8 w-20 animate-pulse rounded-md bg-muted align-middle" /> : kpi.value}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{kpi.hint}</p>
                {kpi.meter !== null && <MeterBar value={kpi.meter} className="mt-4" />}
              </div>
            );
          })}
        </section>

        {/* ── Visibility overview + side cards ───────────────────── */}
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="flex flex-col rounded-xl border border-border bg-card xl:col-span-2">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Visibility score</h2>
                <p className="text-xs text-muted-foreground">The signals behind the score, and how each AI engine sees your clients</p>
              </div>
              <Link
                href="/clients"
                className="hidden items-center gap-1 text-sm font-medium text-primary hover:underline sm:inline-flex"
              >
                Manage clients
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>

            <div className="grid flex-1 grid-cols-1 md:grid-cols-2">
              {/* Score gauge + its signals */}
              <div className="flex flex-col items-center gap-6 border-b border-border p-6 md:border-r md:border-b-0">
                <VisibilityGauge value={avgScore} label="Average visibility" size={190} />
                <div className="grid w-full grid-cols-2 gap-3">
                  {scoreParts.map((part) => (
                    <div key={part.label} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">{part.label}</p>
                      <p className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{pct(part.value)}</p>
                      <MeterBar value={part.value} className="mt-2 h-1" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-engine mention rate */}
              <div className="flex flex-col gap-5 p-6">
                <div>
                  <h3 className="text-sm font-medium text-foreground">By AI engine</h3>
                  <p className="text-xs text-muted-foreground">Share of runs where a client brand was mentioned</p>
                </div>
                <ul className="flex flex-1 flex-col justify-center gap-5" aria-label="AI engines">
                  {providerActivity.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{p.label}</span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">{pct(p.score)}</span>
                      </div>
                      <MeterBar value={p.score} />
                      <span className="text-xs text-muted-foreground">
                        {p.runs ? `${p.runs.toLocaleString()} runs` : "No runs yet"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-6">
            <SubscriptionUsageCard />
            <NotificationsCard />
          </aside>
        </section>

        {/* ── Clients table ──────────────────────────────────────── */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Clients</h2>
              <p className="text-xs text-muted-foreground">Ranked by visibility score</p>
            </div>
            <Button render={<Link href="/clients" />} nativeButton={false} variant="outline" className="mx-1.5 h-9 px-3">
              <Plus className="size-4" />
              Add client
            </Button>
          </div>

          {error ? (
            <p className="px-5 py-8 text-sm text-destructive">{error}</p>
          ) : loadingFirst ? (
            <div className="flex flex-col gap-3 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : sortedClients.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <Building2 className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No clients yet. Add one to start tracking AI visibility.</p>
              <Link href="/clients" className="text-sm font-medium text-primary hover:underline">
                Add your first client
              </Link>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              {/* `relative` makes this scroller the containing block for the
                  absolutely positioned sr-only header text -- without it that
                  text escaped the scroll box and widened the whole page on phones. */}
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Client</th>
                    <th className="px-5 py-3 font-medium">Visibility</th>
                    <th className="px-5 py-3 text-right font-medium">Mentions</th>
                    <th className="px-5 py-3 text-right font-medium">Position</th>
                    <th className="px-5 py-3 text-right font-medium">Sentiment</th>
                    <th className="px-5 py-3 text-right font-medium">Runs</th>
                    <th className="px-5 py-3 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClients.map((e) => {
                    const c = e.score?.components;
                    return (
                      <tr key={e.client.id} className="border-b border-border last:border-0 transition-colors hover:bg-muted/40">
                        <td className="px-5 py-3.5">
                          <Link href={`/clients/${e.client.id}`} className="group flex items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                              {e.client.name.charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground group-hover:text-primary">
                                {e.client.name}
                              </span>
                              {e.client.industry && (
                                <span className="block truncate text-xs text-muted-foreground">{e.client.industry}</span>
                              )}
                            </span>
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <MeterBar value={e.score?.visibility_score} className="w-28" />
                            <span className="w-10 font-semibold tabular-nums text-foreground">
                              {pct(e.score?.visibility_score)}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{pct(c?.mention_rate)}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{pct(c?.position_score)}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{pct(c?.sentiment_score)}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-muted-foreground">
                          {(e.score?.total_runs ?? 0).toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenPdfModal(e.client.id, e.client.name)}
                              title={`Export ${e.client.name} report`}
                              aria-label={`Export ${e.client.name} report`}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <FileDown className="size-4" />
                            </button>
                            <Link
                              href={`/clients/${e.client.id}`}
                              title={`Open ${e.client.name}`}
                              aria-label={`Open ${e.client.name}`}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <ArrowUpRight className="size-4" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Detailed reports ──────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-foreground">Reports</h2>
            <div
              role="tablist"
              aria-label="Reports"
              className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1"
            >
              {REPORT_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === "mention_rate" && <MentionRateView entries={displayedEntries} />}
          {activeTab === "position_reporting" && <RecommendationPositionView entries={displayedEntries} />}
          {activeTab === "mention_order" && <MentionOrderView entries={displayedEntries} />}
          {activeTab === "sentiment_reporting" && <SentimentReportingView entries={displayedEntries} />}
          {activeTab === "citation_reporting" && <CitationReportingView entries={displayedEntries} />}
          {activeTab === "competitor_comparison" && (
            <BrandVsCompetitorView
              key={selectedClientId}
              dateFilter={dateFilter}
              initialClientId={selectedClientId !== "all" ? selectedClientId : undefined}
            />
          )}
          {activeTab === "historical_trends" && (
            <HistoricalTrendsView entries={displayedEntries} dateFilter={dateFilter} />
          )}
          {activeTab === "prompt_intelligence" && (
            <PromptIntelligenceView
              key={selectedClientId}
              initialClientId={selectedClientId !== "all" ? selectedClientId : undefined}
            />
          )}
        </section>
      </div>

      {/* White-Label PDF Export Modal */}
      <PdfExportModal
        isOpen={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        initialClientId={pdfTargetClientId}
        initialClientName={pdfTargetClientName}
        clients={clientOptions}
        initialDateFilter={dateFilter}
      />
    </AppShell>
  );
}
