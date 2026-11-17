"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Edit3,
  ExternalLink,
  Layers,
  LayoutGrid,
  List,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Swords,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { FormField } from "@/components/auth/form-field";
import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { BrandDialog, type BrandRecord } from "@/components/clients/brand-dialog";
import { CompetitorsDialog, type CompetitorRecord } from "@/components/clients/competitors-dialog";
import { LocationPicker } from "@/components/clients/location-picker";
import { PromptsDialog, type PromptRecord } from "@/components/clients/prompts-dialog";
import { SchedulesDialog, type PromptScheduleRecord } from "@/components/clients/schedules-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, extractErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { clientSchema, type ClientInput } from "@/lib/validation";

type ClientRecord = {
  id: string;
  name: string;
  industry: string;
  target_locations: string[];
  services: string[];
  created_at: string;
};

const toList = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function ClientFormDialog({
  onClose,
  title,
  defaultValues,
  onSubmit,
}: {
  onClose: () => void;
  title: string;
  defaultValues: ClientInput;
  onSubmit: (data: ClientInput) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({ resolver: zodResolver(clientSchema), defaultValues });

  const submit = async (data: ClientInput) => {
    setFormError(null);
    try {
      await onSubmit(data);
      onClose();
    } catch (error) {
      setFormError(extractErrorMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg border-border/80 bg-card shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure core client attributes tracked across AI search engines.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4 mt-1" noValidate>
          <FormField label="Client Name" htmlFor="client-name" error={errors.name?.message}>
            <Input id="client-name" {...register("name")} placeholder="e.g. Acme Health" className="bg-background" />
          </FormField>
          <FormField label="Industry / Sector" htmlFor="client-industry" error={errors.industry?.message}>
            <Input id="client-industry" placeholder="e.g. Healthcare, B2B SaaS, Legal" {...register("industry")} className="bg-background" />
          </FormField>
          <FormField
            label="Target Locations"
            htmlFor="client-locations"
            error={errors.targetLocations?.message}
          >
            <Controller
              name="targetLocations"
              control={control}
              render={({ field }) => (
                <LocationPicker id="client-locations" value={field.value} onChange={field.onChange} />
              )}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Select geographic target markets for localized AI search discovery.
            </p>
          </FormField>
          <FormField label="Services Offered" htmlFor="client-services" error={errors.services?.message}>
            <Input id="client-services" placeholder="e.g. Orthodontics, Cosmetic Dentistry, Implants" {...register("services")} className="bg-background" />
          </FormField>
          {formError && <p className="text-xs text-destructive font-medium">{formError}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} size="sm">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} size="sm" className="bg-primary text-primary-foreground">
              {isSubmitting ? "Saving…" : "Save Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorRecord[]>([]);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [schedules, setSchedules] = useState<PromptScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Search, filter, and view mode state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "COMPLETE" | "NEEDS_BRAND" | "NEEDS_PROMPTS">("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  // Dialog open states
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [brandClient, setBrandClient] = useState<ClientRecord | null>(null);
  const [competitorsClient, setCompetitorsClient] = useState<ClientRecord | null>(null);
  const [promptsClient, setPromptsClient] = useState<ClientRecord | null>(null);
  const [schedulesClient, setSchedulesClient] = useState<ClientRecord | null>(null);

  const loadClients = useCallback(() => {
    return api
      .get<ClientRecord[]>("/clients/")
      .then(({ data }) => setClients(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  const loadBrands = useCallback(() => {
    return api
      .get<BrandRecord[]>("/brands/")
      .then(({ data }) => setBrands(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  const loadCompetitors = useCallback(() => {
    return api
      .get<CompetitorRecord[]>("/competitors/")
      .then(({ data }) => setCompetitors(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  const loadPrompts = useCallback(() => {
    return api
      .get<PromptRecord[]>("/prompts/")
      .then(({ data }) => setPrompts(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  const loadSchedules = useCallback(() => {
    return api
      .get<PromptScheduleRecord[]>("/prompt-schedules/")
      .then(({ data }) => setSchedules(data))
      .catch((error) => setListError(extractErrorMessage(error)));
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      await Promise.all([loadClients(), loadBrands(), loadCompetitors(), loadPrompts(), loadSchedules()]);
    } finally {
      setLoading(false);
    }
  }, [loadClients, loadBrands, loadCompetitors, loadPrompts, loadSchedules]);

  useEffect(() => {
    if (user) {
      refreshAll();
    }
  }, [user, refreshAll]);

  const handleClientCreated = () => {
    refreshAll();
  };

  const updateClient = async (id: string, data: ClientInput) => {
    await api.patch(`/clients/${id}/`, {
      name: data.name,
      industry: data.industry ?? "",
      target_locations: data.targetLocations,
      services: toList(data.services),
    });
    loadClients();
  };

  const deleteClient = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name}? All associated prompts, brands, and historical mentions will be permanently removed.`)) return;
    setRowError(null);
    try {
      await api.delete(`/clients/${id}/`);
      refreshAll();
    } catch (error) {
      setRowError(extractErrorMessage(error));
    }
  };

  // Unique industries
  const uniqueIndustries = useMemo(() => {
    if (!clients) return [];
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.industry && c.industry.trim()) {
        set.add(c.industry.trim());
      }
    });
    return Array.from(set).sort();
  }, [clients]);

  // Executive KPI stats
  const stats = useMemo(() => {
    const totalClients = clients?.length ?? 0;
    const configuredBrands = clients?.filter((c) => brands.some((b) => b.client === c.id)).length ?? 0;
    const totalPrompts = prompts.length;
    const totalSchedules = schedules.filter((s) => s.status === "active").length;
    const totalCompetitors = competitors.length;

    return {
      totalClients,
      configuredBrands,
      brandCoverage: totalClients > 0 ? Math.round((configuredBrands / totalClients) * 100) : 0,
      totalPrompts,
      totalSchedules,
      totalCompetitors,
    };
  }, [clients, brands, prompts, schedules, competitors]);

  // Filtered clients list
  const filteredClients = useMemo(() => {
    if (!clients) return [];

    return clients.filter((c) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = c.name.toLowerCase().includes(q);
        const matchIndustry = c.industry.toLowerCase().includes(q);
        const matchLocations = c.target_locations.some((loc) => loc.toLowerCase().includes(q));
        const matchServices = c.services.some((srv) => srv.toLowerCase().includes(q));
        if (!matchName && !matchIndustry && !matchLocations && !matchServices) {
          return false;
        }
      }

      if (selectedIndustry !== "ALL" && c.industry.trim() !== selectedIndustry) {
        return false;
      }

      const hasBrand = brands.some((b) => b.client === c.id);
      const clientPromptsCount = prompts.filter((p) => p.client === c.id).length;
      if (statusFilter === "COMPLETE" && (!hasBrand || clientPromptsCount === 0)) {
        return false;
      }
      if (statusFilter === "NEEDS_BRAND" && hasBrand) {
        return false;
      }
      if (statusFilter === "NEEDS_PROMPTS" && clientPromptsCount > 0) {
        return false;
      }

      return true;
    });
  }, [clients, searchQuery, selectedIndustry, statusFilter, brands, prompts]);

  if (!user) return <AppShell>{null}</AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Client Workspace
              </h1>
              <span className="inline-flex items-center rounded-md border border-border/80 bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-xs">
                {clients?.length ?? 0} {clients?.length === 1 ? "Client" : "Clients"}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {user.agency?.name ?? "Agency"} &mdash; brand configuration, prompt matrices, competitor tracking, and scheduled AI audits.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loading}
              className="gap-1.5 h-8.5 text-xs bg-card border-border/80 shadow-xs hover:bg-secondary/70 transition-colors"
            >
              <RefreshCw className={cn("size-3.5 text-muted-foreground", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="gap-1.5 h-8.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-all font-medium"
            >
              <Plus className="size-3.5" />
              <span>Add Client</span>
            </Button>
          </div>
        </div>

        {/* Executive KPI Stats Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Clients</span>
              <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Users className="size-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{stats.totalClients}</span>
              <span className="text-[11px] text-muted-foreground">Active roster</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Brands Configured</span>
              <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Sparkles className="size-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                {stats.configuredBrands}
                <span className="text-xs font-normal text-muted-foreground">/{stats.totalClients}</span>
              </span>
              <span className="text-[11px] font-medium text-primary">
                {stats.brandCoverage}%
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Tracked Prompts</span>
              <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Zap className="size-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{stats.totalPrompts}</span>
              <span className="text-[11px] text-muted-foreground">Search queries</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Active Schedules</span>
              <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Calendar className="size-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{stats.totalSchedules}</span>
              <span className="text-[11px] text-muted-foreground">Automated audits</span>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-xs col-span-2 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Competitors</span>
              <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Swords className="size-3.5" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{stats.totalCompetitors}</span>
              <span className="text-[11px] text-muted-foreground">Rivals monitored</span>
            </div>
          </div>
        </div>

        {/* Global Error Banner */}
        {listError && (
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{listError}</span>
          </div>
        )}
        {rowError && (
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{rowError}</span>
          </div>
        )}

        {/* Search, Filter & View Controls */}
        <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search clients by name, industry, service, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8.5 pr-8 bg-background border-border/80 h-8.5 text-xs rounded-lg focus-visible:ring-primary/30"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns & View Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              {uniqueIndustries.length > 0 && (
                <select
                  value={selectedIndustry}
                  onChange={(e) => setSelectedIndustry(e.target.value)}
                  className="h-8.5 rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  <option value="ALL">All Industries</option>
                  {uniqueIndustries.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="h-8.5 rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="ALL">All Setup Statuses</option>
                <option value="COMPLETE">Fully Configured</option>
                <option value="NEEDS_BRAND">Needs Brand</option>
                <option value="NEEDS_PROMPTS">Needs Prompts</option>
              </select>

              {/* View Mode Switcher */}
              <div className="flex items-center rounded-lg border border-border/80 bg-secondary/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "flex h-7.5 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all",
                    viewMode === "grid"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Card Grid View"
                >
                  <LayoutGrid className="size-3.5" />
                  <span className="hidden sm:inline">Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={cn(
                    "flex h-7.5 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all",
                    viewMode === "table"
                      ? "bg-card text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Data Table View"
                >
                  <List className="size-3.5" />
                  <span className="hidden sm:inline">Table</span>
                </button>
              </div>
            </div>
          </div>

          {/* Active Filter Chips */}
          {(searchQuery || selectedIndustry !== "ALL" || statusFilter !== "ALL") && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              <span className="font-medium text-[11px]">Active filters:</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                  Keyword: &quot;{searchQuery}&quot;
                  <button type="button" onClick={() => setSearchQuery("")} className="hover:text-destructive transition-colors">
                    <X className="size-3" />
                  </button>
                </span>
              )}
              {selectedIndustry !== "ALL" && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                  Industry: {selectedIndustry}
                  <button type="button" onClick={() => setSelectedIndustry("ALL")} className="hover:text-destructive transition-colors">
                    <X className="size-3" />
                  </button>
                </span>
              )}
              {statusFilter !== "ALL" && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                  Status: {statusFilter.replace("_", " ")}
                  <button type="button" onClick={() => setStatusFilter("ALL")} className="hover:text-destructive transition-colors">
                    <X className="size-3" />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedIndustry("ALL");
                  setStatusFilter("ALL");
                }}
                className="text-[11px] font-medium text-primary hover:underline ml-1"
              >
                Reset filters
              </button>
              <span className="ml-auto text-[11px] text-muted-foreground">
                Showing {filteredClients.length} of {clients?.length ?? 0}
              </span>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && !clients && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/60 p-12 text-center">
            <RefreshCw className="size-6 animate-spin text-primary" />
            <p className="mt-3 text-xs font-medium text-foreground">Loading agency client workspace…</p>
            <p className="text-[11px] text-muted-foreground">Fetching brands, competitors, prompts, and schedules.</p>
          </div>
        )}

        {/* Empty State: No clients created yet */}
        {!loading && clients && clients.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card p-12 text-center shadow-xs">
            <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-foreground">
              <Building2 className="size-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">No clients added yet</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Add your first client to configure brand positioning, track competitor visibility, and launch AI discovery audits.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="mt-5 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium"
            >
              <Plus className="size-3.5" />
              <span>Add First Client</span>
            </Button>
          </div>
        )}

        {/* Empty State: Filter yielded no results */}
        {!loading && clients && clients.length > 0 && filteredClients.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-card p-10 text-center shadow-xs">
            <Search className="size-6 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No matching clients found</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              No clients match your filter criteria. Try adjusting your search query or industry filter.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setSelectedIndustry("ALL");
                setStatusFilter("ALL");
              }}
              className="mt-4 text-xs h-8"
            >
              Clear All Filters
            </Button>
          </div>
        )}

        {/* GRID VIEW (Modern Agency Cards) */}
        {!loading && filteredClients.length > 0 && viewMode === "grid" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredClients.map((client) => {
              const brand = brands.find((b) => b.client === client.id) ?? null;
              const clientCompetitors = competitors.filter((c) => c.client === client.id);
              const clientPrompts = prompts.filter((p) => p.client === client.id);
              const clientSchedules = schedules.filter((s) => s.client === client.id);

              return (
                <div
                  key={client.id}
                  className="group flex flex-col justify-between rounded-xl border border-border/80 bg-card p-5 shadow-xs hover:border-primary/40 hover:shadow-md transition-all duration-200"
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-secondary text-foreground font-semibold text-xs shadow-2xs">
                          {client.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/clients/${client.id}`}
                            className="block text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate"
                          >
                            {client.name}
                          </Link>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {client.industry ? (
                              <span className="inline-flex items-center rounded-md border border-border/60 bg-secondary/80 px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground">
                                {client.industry}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">General</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dropdown Options */}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-card border-border/80">
                          <DropdownMenuLabel className="text-[11px] text-muted-foreground font-medium">
                            Manage Client
                          </DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setBrandClient(client)} className="text-xs">
                            <Sparkles className="size-3.5 mr-2 text-foreground" />
                            <span>{brand ? "Brand Profile" : "Configure Brand"}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setCompetitorsClient(client)} className="text-xs">
                            <Swords className="size-3.5 mr-2 text-foreground" />
                            <span>Competitors ({clientCompetitors.length})</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => router.push(`/clients/${client.id}?tab=prompts`)}
                            className="text-xs cursor-pointer"
                          >
                            <Zap className="size-3.5 mr-2 text-foreground" />
                            <span>Prompts ({clientPrompts.length})</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              loadPrompts();
                              loadBrands();
                              setSchedulesClient(client);
                            }}
                            className="text-xs"
                          >
                            <Calendar className="size-3.5 mr-2 text-foreground" />
                            <span>Schedules ({clientSchedules.length})</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setEditing(client)} className="text-xs">
                            <Edit3 className="size-3.5 mr-2" />
                            <span>Edit Client</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteClient(client.id, client.name)}
                            className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            <Trash2 className="size-3.5 mr-2" />
                            <span>Delete Client</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Locations & Services */}
                    <div className="mt-3.5 flex flex-col gap-1 text-[11px] text-muted-foreground">
                      {client.target_locations && client.target_locations.length > 0 && (
                        <div className="flex items-center gap-1.5 truncate">
                          <MapPin className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{client.target_locations.join(", ")}</span>
                        </div>
                      )}
                      {client.services && client.services.length > 0 && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Briefcase className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{client.services.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Setup & Tracking Interactive Grid */}
                  <div className="mt-4 pt-3.5 border-t border-border/60 flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2">
                      {/* Brand Button */}
                      <button
                        type="button"
                        onClick={() => setBrandClient(client)}
                        className="flex flex-col items-start rounded-lg border border-border/70 bg-secondary/40 p-2 text-left hover:bg-secondary/90 transition-colors"
                      >
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Brand
                        </span>
                        <div className="mt-1 flex items-center gap-1.5 w-full">
                          {brand ? (
                            <>
                              <Check className="size-3 text-primary shrink-0" />
                              <span className="text-xs font-medium text-foreground truncate">{brand.name}</span>
                            </>
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">Setup</span>
                          )}
                        </div>
                      </button>

                      {/* Prompts Button (Direct Link to Full Prompts Workspace) */}
                      <Link
                        href={`/clients/${client.id}?tab=prompts`}
                        className="flex flex-col items-start rounded-lg border border-border/70 bg-secondary/40 p-2 text-left hover:bg-secondary/90 transition-colors"
                      >
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Prompts
                        </span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {clientPrompts.length} {clientPrompts.length === 1 ? "Query" : "Queries"}
                          </span>
                        </div>
                      </Link>

                      {/* Competitors Button */}
                      <button
                        type="button"
                        onClick={() => setCompetitorsClient(client)}
                        className="flex flex-col items-start rounded-lg border border-border/70 bg-secondary/40 p-2 text-left hover:bg-secondary/90 transition-colors"
                      >
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Competitors
                        </span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {clientCompetitors.length} {clientCompetitors.length === 1 ? "Rival" : "Rivals"}
                          </span>
                        </div>
                      </button>

                      {/* Schedules Button */}
                      <button
                        type="button"
                        onClick={() => {
                          loadPrompts();
                          loadBrands();
                          setSchedulesClient(client);
                        }}
                        className="flex flex-col items-start rounded-lg border border-border/70 bg-secondary/40 p-2 text-left hover:bg-secondary/90 transition-colors"
                      >
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          Schedules
                        </span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {clientSchedules.length} {clientSchedules.length === 1 ? "Audit" : "Audits"}
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Direct Dashboard Link */}
                    <Link
                      href={`/clients/${client.id}`}
                      className="group/btn flex items-center justify-between rounded-lg border border-border/80 bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary/80 hover:border-primary/40 transition-all duration-150"
                    >
                      <span>Open Client Dashboard</span>
                      <ArrowRight className="size-3.5 text-muted-foreground group-hover/btn:text-primary group-hover/btn:translate-x-0.5 transition-all" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TABLE VIEW (Dense Data View) */}
        {!loading && filteredClients.length > 0 && viewMode === "table" && (
          <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/40">
                <TableRow className="border-border/80 hover:bg-transparent">
                  <TableHead className="font-semibold text-xs text-foreground">Client Name</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Industry</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Brand</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground text-center">Prompts</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground text-center">Competitors</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground text-center">Schedules</TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">Locations</TableHead>
                  <TableHead className="text-right font-semibold text-xs text-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => {
                  const brand = brands.find((b) => b.client === client.id) ?? null;
                  const clientCompetitors = competitors.filter((c) => c.client === client.id);
                  const clientPrompts = prompts.filter((p) => p.client === client.id);
                  const clientSchedules = schedules.filter((s) => s.client === client.id);

                  return (
                    <TableRow key={client.id} className="border-border/60 hover:bg-secondary/30 transition-colors">
                      <TableCell>
                        <Link
                          href={`/clients/${client.id}`}
                          className="font-semibold text-xs text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          <span>{client.name}</span>
                          <ExternalLink className="size-3 text-muted-foreground" />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md border border-border/60 bg-secondary/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {client.industry || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {brand ? (
                          <button
                            type="button"
                            onClick={() => setBrandClient(client)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary transition-colors"
                          >
                            <Check className="size-3 text-primary" />
                            <span>{brand.name}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setBrandClient(client)}
                            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/80 bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
                          >
                            <span>Setup Brand</span>
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Link
                          href={`/clients/${client.id}?tab=prompts`}
                          className="inline-flex items-center rounded-md border border-border/80 bg-secondary/70 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          {clientPrompts.length}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => setCompetitorsClient(client)}
                          className="inline-flex items-center rounded-md border border-border/80 bg-secondary/70 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          {clientCompetitors.length}
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => {
                            loadPrompts();
                            loadBrands();
                            setSchedulesClient(client);
                          }}
                          className="inline-flex items-center rounded-md border border-border/80 bg-secondary/70 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          {clientSchedules.length}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                        {client.target_locations.length ? client.target_locations.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/clients/${client.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary hover:text-primary transition-colors"
                          >
                            <span>Dashboard</span>
                            <ArrowRight className="size-3" />
                          </Link>

                          <DropdownMenu>
                            <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md border border-border/80 text-muted-foreground hover:bg-secondary hover:text-foreground">
                              <MoreHorizontal className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44 bg-card border-border/80">
                              <DropdownMenuItem onClick={() => setBrandClient(client)} className="text-xs">
                                <Sparkles className="size-3.5 mr-2 text-foreground" />
                                <span>Brand Profile</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setCompetitorsClient(client)} className="text-xs">
                                <Swords className="size-3.5 mr-2 text-foreground" />
                                <span>Competitors</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => router.push(`/clients/${client.id}?tab=prompts`)}
                                className="text-xs cursor-pointer"
                              >
                                <Zap className="size-3.5 mr-2 text-foreground" />
                                <span>Prompts</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  loadPrompts();
                                  loadBrands();
                                  setSchedulesClient(client);
                                }}
                                className="text-xs"
                              >
                                <Calendar className="size-3.5 mr-2 text-foreground" />
                                <span>Schedules</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setEditing(client)} className="text-xs">
                                <Edit3 className="size-3.5 mr-2" />
                                <span>Edit Details</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => deleteClient(client.id, client.name)}
                                className="text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                              >
                                <Trash2 className="size-3.5 mr-2" />
                                <span>Delete</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Interactive Modal Dialogs */}
      {addOpen && <AddClientDialog onClose={() => setAddOpen(false)} onCreated={handleClientCreated} />}

      {editing && (
        <ClientFormDialog
          onClose={() => setEditing(null)}
          title={`Edit ${editing.name}`}
          defaultValues={{
            name: editing.name,
            industry: editing.industry,
            targetLocations: editing.target_locations,
            services: editing.services.join(", "),
          }}
          onSubmit={(data) => updateClient(editing.id, data)}
        />
      )}

      {brandClient && (
        <BrandDialog
          clientId={brandClient.id}
          clientName={brandClient.name}
          brand={brands.find((b) => b.client === brandClient.id) ?? null}
          onClose={() => setBrandClient(null)}
          onSaved={loadBrands}
        />
      )}

      {competitorsClient && (
        <CompetitorsDialog
          clientId={competitorsClient.id}
          clientName={competitorsClient.name}
          competitors={competitors.filter((c) => c.client === competitorsClient.id)}
          onClose={() => setCompetitorsClient(null)}
          onChanged={loadCompetitors}
        />
      )}

      {promptsClient && (
        <PromptsDialog
          clientId={promptsClient.id}
          clientName={promptsClient.name}
          prompts={prompts.filter((p) => p.client === promptsClient.id)}
          defaultLocationTags={promptsClient.target_locations}
          defaultServiceTags={promptsClient.services}
          onClose={() => setPromptsClient(null)}
          onChanged={loadPrompts}
        />
      )}

      {schedulesClient && (
        <SchedulesDialog
          clientId={schedulesClient.id}
          clientName={schedulesClient.name}
          brandId={brands.find((b) => b.client === schedulesClient.id)?.id ?? null}
          prompts={prompts.filter((p) => p.client === schedulesClient.id)}
          schedules={schedules.filter((s) => s.client === schedulesClient.id)}
          onClose={() => setSchedulesClient(null)}
          onChanged={loadSchedules}
        />
      )}
    </AppShell>
  );
}
