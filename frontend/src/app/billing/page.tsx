"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CreditCard,
  Zap,
  Rocket,
  Building2,
  Check,
  ShieldCheck,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  Download,
  AlertCircle,
  FileText,
  Clock,
  Coins,
  Loader2,
} from "lucide-react";

import { AppShell } from "@/components/dashboard/app-shell";
import { InvoiceModal } from "@/components/billing/invoice-modal";
import { PaymentMethodCard } from "@/components/billing/payment-method-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, extractErrorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  STATUS_STYLES,
  type BillingPeriod,
  type PlanOption,
  type SubscriptionSummary,
} from "@/lib/subscription";
import { cn } from "@/lib/utils";

const PLAN_ICONS: Record<string, typeof Rocket> = {
  starter: Rocket,
  growth: Zap,
  agency: Building2,
};

export default function BillingPage() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [history, setHistory] = useState<BillingPeriod[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingSub, setLoadingSub] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [upgradingSlug, setUpgradingSlug] = useState<string | null>(null);
  const [selectedInvoicePeriod, setSelectedInvoicePeriod] = useState<BillingPeriod | null>(null);

  const fetchSubscription = () => {
    setLoadingSub(true);
    api
      .get<SubscriptionSummary>("/subscription/")
      .then(({ data }) => setSubscription(data))
      .catch(() => setSubscription(null))
      .finally(() => setLoadingSub(false));
  };

  const fetchHistory = () => {
    setLoadingHistory(true);
    api
      .get<BillingPeriod[]>("/subscription/history/")
      .then(({ data }) => setHistory(data))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => {
    fetchSubscription();
    fetchHistory();
    api
      .get<PlanOption[]>("/plans/")
      .then(({ data }) => setPlans(data))
      .catch(() => {});
  }, []);

  const handleUpgradePlan = async (planSlug: string, billingInterval: "monthly" | "yearly") => {
    setUpgradingSlug(planSlug);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.post("/subscription/choose-plan/", {
        plan: planSlug,
        billing_interval: billingInterval,
      });
      await api.post("/subscription/activate-test/");
      setActionMessage(`Successfully updated subscription to ${planSlug.toUpperCase()} plan! Credits updated.`);
      fetchSubscription();
      fetchHistory();
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setUpgradingSlug(null);
    }
  };

  const handleSimulateAddCredits = async () => {
    setActionMessage(null);
    setActionError(null);
    try {
      // Re-activating or refreshing period
      await api.post("/subscription/activate-test/");
      setActionMessage("Test credit allowance refreshed and synchronized with active period.");
      fetchSubscription();
    } catch (err) {
      setActionError(extractErrorMessage(err));
    }
  };

  const [openingPortal, setOpeningPortal] = useState(false);

  const handleOpenCustomerPortal = async () => {
    setOpeningPortal(true);
    setActionError(null);
    try {
      const { data } = await api.post<{ portal_url: string }>("/billing/portal-session/");
      if (data.portal_url) {
        window.location.href = data.portal_url;
      }
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setOpeningPortal(false);
    }
  };

  const period = subscription?.current_billing_period;
  const usagePercent =
    period && period.total_available > 0
      ? Math.round((period.prompt_runs_used / period.total_available) * 100)
      : 0;

  return (
    <AppShell>
      <div className="flex flex-col gap-8 max-w-5xl mx-auto pb-12">
        {/* Header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Billing & Credits</h1>
            <p className="text-sm text-muted-foreground">
              Manage your agency&apos;s subscription tier, prompt run credits, and billing invoices.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="size-3.5" />
              <span>Test Mode Active</span>
            </span>
            <Button variant="outline" size="sm" onClick={fetchSubscription} disabled={loadingSub}>
              <RefreshCw className={cn("size-3.5 mr-1.5", loadingSub && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Action / Error Alerts */}
        {actionMessage && (
          <div className="rounded-xl border border-emerald-600/20 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-emerald-600" />
              <span>{actionMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionMessage(null)}
              className="text-xs font-bold hover:underline text-emerald-800"
            >
              Dismiss
            </button>
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Top Metric Cards: Credits & Current Plan */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          {/* Card 1: Live Credits & Usage Gauge */}
          <div className="md:col-span-7 rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Coins className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">Prompt Run Credits</h2>
                    <p className="text-xs text-muted-foreground">Used across all client visibility queries</p>
                  </div>
                </div>

                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                    usagePercent > 85
                      ? "bg-amber-100 text-amber-800"
                      : "bg-emerald-100 text-emerald-800"
                  )}
                >
                  {usagePercent > 85 ? "High Usage" : "Healthy Allowance"}
                </span>
              </div>

              {/* Progress Bar & Main Numbers */}
              {period ? (
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-3xl font-extrabold tabular-nums">
                        {period.prompt_runs_remaining.toLocaleString()}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground ml-1.5">
                        credits remaining
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {period.prompt_runs_used.toLocaleString()} / {period.total_available.toLocaleString()} used ({usagePercent}%)
                    </span>
                  </div>

                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        usagePercent > 90
                          ? "bg-destructive"
                          : usagePercent > 75
                          ? "bg-amber-500"
                          : "bg-primary"
                      )}
                      style={{ width: `${Math.min(100, usagePercent)}%` }}
                    />
                  </div>

                  {/* Credits Breakdown Grid */}
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-secondary/30 p-3 mt-3 text-center">
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium">Base Allowance</p>
                      <p className="text-sm font-bold mt-0.5">{period.base_prompt_run_allowance.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium">Rollover Credits</p>
                      <p className="text-sm font-bold mt-0.5 text-emerald-500">+{period.rollover_received.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium">Total Available</p>
                      <p className="text-sm font-bold mt-0.5">{period.total_available.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Loading credit usage data...
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-border pt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Credits reset automatically on next cycle renewal.
              </p>
              <Button size="sm" variant="outline" onClick={handleSimulateAddCredits}>
                <Sparkles className="size-3.5 mr-1 text-primary" />
                Sync Credits (Test Mode)
              </Button>
            </div>
          </div>

          {/* Card 2: Current Subscription Summary */}
          <div className="md:col-span-5 rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Active Plan
                </span>
                {subscription && (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                      STATUS_STYLES[subscription.status]
                    )}
                  >
                    {subscription.status.replace("_", " ")}
                  </span>
                )}
              </div>

              {subscription ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <h3 className="text-2xl font-bold">{subscription.plan.name} Tier</h3>
                    <p className="text-xs text-muted-foreground capitalize">
                      Billed {subscription.billing_interval}
                    </p>
                  </div>

                  <div className="rounded-xl bg-secondary/40 p-3.5 text-xs flex flex-col gap-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Period</span>
                      <span className="font-medium text-foreground">
                        {subscription.current_period_start} → {subscription.current_period_end}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Client Workspace Limit</span>
                      <span className="font-medium text-foreground">
                        {subscription.plan.client_limit ? `Up to ${subscription.plan.client_limit}` : "Full Access"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Status</span>
                      <span className="font-medium text-emerald-500 flex items-center gap-1">
                        <Check className="size-3" /> Auto-Renewing
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active subscription found.</p>
              )}
            </div>

            <div className="mt-4 border-t border-border pt-4 flex items-center justify-between">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <span>View all pricing tiers & features</span>
                <ArrowUpRight className="size-3" />
              </Link>
              <Button size="sm" variant="outline" onClick={handleOpenCustomerPortal} disabled={openingPortal}>
                {openingPortal ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <CreditCard className="size-3.5 mr-1.5 text-primary" />}
                Stripe Billing Portal
              </Button>
            </div>
          </div>
        </div>

        {/* Change / Upgrade Plan Section */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Switch or Upgrade Plan</h2>
              <p className="text-xs text-muted-foreground">
                Instantly upgrade your prompt run capacity with 1-click test mode processing.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = subscription?.plan.name.toLowerCase() === p.name.toLowerCase();
              const isUpgrading = upgradingSlug === p.slug;
              const Icon = PLAN_ICONS[p.slug] ?? Zap;

              return (
                <div
                  key={p.slug}
                  className={cn(
                    "flex flex-col justify-between rounded-xl border p-5 transition-all",
                    isCurrent
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "border-border bg-card hover:border-foreground/20 shadow-xs"
                  )}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Current Plan
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="font-bold text-base">{p.name}</h4>
                      <p className="text-xl font-extrabold mt-1">
                        ${p.monthly_price_usd}
                        <span className="text-xs font-normal text-muted-foreground"> / month</span>
                      </p>
                    </div>

                    <ul className="flex flex-col gap-2 text-xs text-muted-foreground border-t border-border pt-3">
                      <li className="flex items-center gap-2">
                        <Check className="size-3 text-emerald-500" />
                        <span><strong>{p.prompt_runs_included.toLocaleString()}</strong> Runs / mo</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="size-3 text-emerald-500" />
                        <span>Up to {p.client_limit ?? (p.slug === "starter" ? 5 : 25)} Clients</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="size-3 text-emerald-500" />
                        <span>Traceable AI Citations</span>
                      </li>
                    </ul>
                  </div>

                  <div className="mt-5">
                    {isCurrent ? (
                      <Button variant="outline" size="sm" className="w-full text-xs" disabled>
                        Active Tier
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full text-xs"
                        disabled={isUpgrading}
                        onClick={() => handleUpgradePlan(p.slug, subscription?.billing_interval || "monthly")}
                      >
                        {isUpgrading ? (
                          <div className="flex items-center gap-1.5">
                            <Loader2 className="size-3.5 animate-spin" />
                            <span>Upgrading...</span>
                          </div>
                        ) : (
                          `Switch to ${p.name}`
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment Method & Security Information */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Payment Method & auto-renew */}
          <PaymentMethodCard subscription={subscription} onChange={setSubscription} />

          {/* Tenant Isolation & RLS Security Card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-4" />
                <h3 className="text-base font-semibold text-foreground">Multi-Tenant Data Isolation</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Every client workspace, prompt schedule, and AI visibility report is strictly isolated using
                PostgreSQL Row-Level Security (RLS) and scoped agency permissions.
              </p>
              <div className="rounded-xl bg-secondary/30 p-3 text-xs flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Check className="size-3 text-emerald-500" />
                  <span>Automated schedule quotas & rollover tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="size-3 text-emerald-500" />
                  <span>Verifiable evidence retention & trace logs</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Zero Data-Loss & Retention Guarantee Banner */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Zero Data-Loss &amp; Historical Continuity Guarantee</h3>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                If your subscription ends or lapses for a month, your clients, prompts, competitors, brand aliases, and historical AI visibility scores are <strong>never deleted</strong>. All data is safely preserved in read-only cold archive and <strong>immediately recovered</strong> the moment you reactivate your subscription.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Check className="size-3.5" /> 100% Data Safe
          </span>
        </div>

        {/* Invoices & Usage History */}
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-bold">Billing & Usage History</h2>
            <p className="text-xs text-muted-foreground">
              Review previous billing periods and prompt run allocations.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-xs font-semibold text-muted-foreground uppercase">
                  <th className="p-4">Period Dates</th>
                  <th className="p-4">Base Allowance</th>
                  <th className="p-4">Runs Used</th>
                  <th className="p-4">Rollover</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingHistory ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground text-xs">
                      Loading history...
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground text-xs">
                      No past billing periods recorded yet. Your first cycle is currently open.
                    </td>
                  </tr>
                ) : (
                  history.map((row, idx) => {
                    const startObj = new Date(row.period_start);
                    const monthLabel = startObj.toLocaleDateString("en-US", { month: "short", year: "numeric" });
                    return (
                      <tr key={idx} className="hover:bg-secondary/20 transition-colors text-xs">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{monthLabel}</span>
                            <span className="text-[11px] text-muted-foreground">{row.period_start} &rarr; {row.period_end}</span>
                          </div>
                        </td>
                        <td className="p-4">{row.base_prompt_run_allowance.toLocaleString()} runs</td>
                        <td className="p-4 font-semibold">{row.prompt_runs_used.toLocaleString()} runs</td>
                        <td className="p-4 text-emerald-500">+{row.rollover_received} runs</td>
                        <td className="p-4">
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {row.closed_at ? "Settled" : "Current Cycle"}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 gap-1 font-medium bg-background hover:bg-secondary border-border/80"
                            onClick={() => setSelectedInvoicePeriod(row)}
                          >
                            <Download className="size-3 text-primary" />
                            <span>PDF Invoice</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Interactive Invoice Modal */}
        <InvoiceModal
          isOpen={!!selectedInvoicePeriod}
          onClose={() => setSelectedInvoicePeriod(null)}
          period={selectedInvoicePeriod}
          subscription={subscription}
          agencyName={user?.agency?.name}
          userEmail={user?.email}
        />
      </div>
    </AppShell>
  );
}
