"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Clock,
  ExternalLink,
  FileDown,
  Globe,
  LayoutDashboard,
  ListOrdered,
  Loader2,
  MapPin,
  Pause,
  Play,
  Plus,
  Radio,
  Smile,
  Sparkles,
  Swords,
  Tag,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBrandDetail } from "@/components/clients/use-brand-detail";
import { BrandDetailHero } from "@/components/clients/brand-detail-hero";
import { ClientVisibilityOverview } from "@/components/clients/client-visibility-overview";
import { CompetitorComparison } from "@/components/clients/competitor-comparison";
import { SentimentChart } from "@/components/clients/sentiment-chart";
import { MentionsTable } from "@/components/clients/mentions-table";
import { ClientPromptsManager, type PromptRecord } from "@/components/clients/client-prompts-manager";
import { ClientSchedulesView } from "@/components/clients/client-schedules-view";
import { SchedulesDialog, type PromptScheduleRecord } from "@/components/clients/schedules-dialog";
import { PdfExportModal } from "@/components/dashboard/pdf-export-modal";
import { api } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";

type ClientTab = "overview" | "schedules" | "prompts" | "mentions" | "competitors" | "sentiment" | "citations";

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as ClientTab) || "overview";

  const { client, brandScore, competitors, error, refetch: refetchBrandScore } = useBrandDetail(params.id);
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [schedules, setSchedules] = useState<PromptScheduleRecord[]>([]);
  const [schedulesModalOpen, setSchedulesModalOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  const loadPrompts = useCallback(() => {
    if (!params.id) return;
    api
      .get<PromptRecord[]>("/prompts/", { params: { client: params.id } })
      .then(({ data }) => setPrompts(data || []))
      .catch(() => setPrompts([]));
  }, [params.id]);

  const loadSchedules = useCallback(() => {
    if (!params.id) return;
    api
      .get<PromptScheduleRecord[]>("/schedules/")
      .then(({ data }) => {
        const list = (data || []).filter((s) => s.client === params.id);
        setSchedules(list);
      })
      .catch(() => setSchedules([]));
  }, [params.id]);

  useEffect(() => {
    loadPrompts();
    loadSchedules();
  }, [loadPrompts, loadSchedules]);

  const totalMentions = useMemo(() => {
    return brandScore?.prompt_runs?.flatMap((r) => r.mentions)?.length ?? 0;
  }, [brandScore]);

  const totalCitations = useMemo(() => {
    return brandScore?.prompt_runs?.flatMap((r) => r.mentions?.flatMap((m) => m.citations ?? []))?.length ?? 0;
  }, [brandScore]);

  const activeSchedule = useMemo(() => {
    return schedules.find((s) => s.status === "active") || schedules[0] || null;
  }, [schedules]);

  const tabs: {
    id: ClientTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }[] = [
    { id: "overview", label: "Executive Overview", icon: LayoutDashboard },
    { id: "schedules", label: "Automated Schedules", icon: CalendarClock, count: schedules.length },
    { id: "prompts", label: "Search Prompts & Audits", icon: Bot, count: prompts.length },
    { id: "mentions", label: "Mentions & Order", icon: ListOrdered, count: totalMentions },
    { id: "competitors", label: "Competitive Landscape", icon: Swords, count: competitors?.length ?? 0 },
    { id: "sentiment", label: "Sentiment & Tone", icon: Smile },
    { id: "citations", label: "Authority Citations", icon: Globe, count: totalCitations },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-5">
        {/* Navigation & Actions Top Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/clients"
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              <span>Clients Workspace</span>
            </Link>
            <span className="text-muted-foreground font-mono">/</span>
            <span className="font-semibold text-foreground">
              {client?.name ?? "Client Intelligence"}
            </span>
          </div>

          {client && (
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                onClick={() => setSchedulesModalOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold shadow-2xs border-border bg-card hover:bg-secondary cursor-pointer"
              >
                <CalendarClock className="size-3.5 text-primary" />
                <span>{schedules.length > 0 ? "Manage Schedules" : "Configure Schedule"}</span>
              </Button>

              <Button
                onClick={() => setPdfModalOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold shadow-2xs border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
              >
                <FileDown className="size-3.5 text-primary" />
                <span>Export White-Label PDF</span>
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
            {error}
          </div>
        )}

        {!error && !client && (
          <div className="flex flex-col gap-4">
            <div className="h-44 w-full animate-pulse rounded-2xl bg-card" />
            <div className="h-10 w-full animate-pulse rounded-xl bg-card" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-card" />
              ))}
            </div>
          </div>
        )}

        {client && (
          <>
            {/* Top Brand Telemetry Hero Card */}
            <BrandDetailHero
              clientName={client.name}
              industry={client.industry}
              targetLocations={client.target_locations}
              services={client.services}
              createdAt={client.created_at}
              score={brandScore}
              promptsCount={prompts.length}
              schedulesCount={schedules.length}
              activeSchedule={activeSchedule}
              onSelectTab={(tabId) => setActiveTab(tabId as ClientTab)}
              onOpenSchedule={() => setSchedulesModalOpen(true)}
            />

            {/* Sub-Navigation Tab Bar */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/80 bg-card p-1.5 shadow-2xs">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all select-none cursor-pointer",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{tab.label}</span>
                    {typeof tab.count === "number" && (
                      <span
                        className={cn(
                          "ml-0.5 rounded-md px-1.5 py-0.2 text-[10px] font-mono font-bold",
                          isActive
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-secondary text-muted-foreground"
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Executive Overview */}
            {activeTab === "overview" && (
              <div className="flex flex-col gap-6">
                {/* Active Automated Schedule HUD Banner */}
                {schedules.length > 0 ? (
                  <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30">
                        <CalendarClock className="size-5 animate-pulse" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground">
                            Automated Recurrence Active: {schedules[0].frequency === "daily" ? "Daily" : schedules[0].frequency}
                          </span>
                          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                            Live Schedule
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Executing {schedules[0].prompts.length} prompts across {schedules[0].providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ")} at {schedules[0].run_time} ({schedules[0].timezone || "PKT"}).
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveTab("schedules")}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-all cursor-pointer shadow-2xs"
                      >
                        <span>Inspect Schedule</span>
                        <ExternalLink className="size-3" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-secondary/15 p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground border border-border">
                        <CalendarClock className="size-5" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-foreground">
                          No Automated Schedule Configured
                        </span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Set up automated daily/weekly audit runs to stream notifications and keep your visibility scores up to date.
                        </p>
                      </div>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setSchedulesModalOpen(true)}
                      className="h-8.5 rounded-xl text-xs font-semibold gap-1.5 shrink-0"
                    >
                      <Plus className="size-3.5" />
                      <span>Set Up Schedule</span>
                    </Button>
                  </div>
                )}

                <ClientVisibilityOverview
                  clientId={client.id}
                  clientName={client.name}
                  industry={client.industry}
                  targetLocations={client.target_locations}
                  services={client.services}
                  score={brandScore}
                  competitors={competitors ?? []}
                  onSelectTab={(tabId) => setActiveTab(tabId as ClientTab)}
                />

                {/* Compact Competitor Preview */}
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <CompetitorComparison
                      brandName={client.name}
                      brandScore={brandScore}
                      competitors={competitors ?? []}
                    />
                  </div>
                  <SentimentChart score={brandScore} />
                </div>
              </div>
            )}

            {/* Tab 2: Automated Schedules View */}
            {activeTab === "schedules" && (
              <ClientSchedulesView
                clientId={client.id}
                clientName={client.name}
                schedules={schedules}
                prompts={prompts}
                onOpenCreateModal={() => setSchedulesModalOpen(true)}
                onOpenEditModal={(sched) => setSchedulesModalOpen(true)}
                onChanged={() => {
                  loadSchedules();
                  refetchBrandScore();
                }}
              />
            )}

            {/* Tab 3: Search Prompts & AI Execution History Workspace */}
            {activeTab === "prompts" && (
              <ClientPromptsManager
                clientId={client.id}
                clientName={client.name}
                prompts={prompts}
                defaultLocationTags={client.target_locations}
                defaultServiceTags={client.services}
                onChanged={() => {
                  loadPrompts();
                  loadSchedules();
                  refetchBrandScore();
                }}
              />
            )}

            {/* Tab 4: Mentions & Order Stream Table */}
            {activeTab === "mentions" && <MentionsTable score={brandScore} />}

            {/* Tab 5: Competitive Landscape */}
            {activeTab === "competitors" && (
              <div className="flex flex-col gap-4">
                <CompetitorComparison
                  brandName={client.name}
                  brandScore={brandScore}
                  competitors={competitors ?? []}
                />
                {competitors !== null && competitors.length === 0 && (
                  <Card>
                    <CardContent className="py-6 text-center text-sm text-muted-foreground">
                      No competitors tracked for {client.name} yet &mdash; add some from the Clients page
                      to see a comparison here.
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Tab 6: Sentiment & Tone */}
            {activeTab === "sentiment" && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <SentimentChart score={brandScore} />
                <Card>
                  <CardContent className="flex flex-col justify-center gap-3 pt-6">
                    <h4 className="text-base font-semibold text-foreground">
                      About Sentiment Calibration
                    </h4>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Sentiment score measures the qualitative tone of language surrounding your
                      brand in generated AI answers. Positive tone signals direct recommendation,
                      neutral indicates balanced factual citations, and negative flags potential
                      cautions or critical comparisons.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Tab 7: Authority Citations */}
            {activeTab === "citations" && <MentionsTable score={brandScore} filterCitationsOnly />}
          </>
        )}
      </div>

      {/* Schedules Builder Modal */}
      {client && schedulesModalOpen && (
        <SchedulesDialog
          clientId={client.id}
          clientName={client.name}
          brandId={brandScore?.entity_id ?? null}
          prompts={prompts}
          schedules={schedules}
          onClose={() => setSchedulesModalOpen(false)}
          onChanged={() => {
            loadSchedules();
            refetchBrandScore();
          }}
        />
      )}

      {/* PDF Export Modal */}
      {client && (
        <PdfExportModal
          isOpen={pdfModalOpen}
          onClose={() => setPdfModalOpen(false)}
          initialClientId={client.id}
          initialClientName={client.name}
          clients={[{ id: client.id, name: client.name }]}
        />
      )}
    </AppShell>
  );
}
