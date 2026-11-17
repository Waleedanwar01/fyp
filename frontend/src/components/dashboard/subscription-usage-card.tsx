"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CreditCard, Sparkles, Zap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCompactNumber } from "@/lib/utils";
import { api } from "@/lib/api";
import { STATUS_STYLES, type SubscriptionSummary } from "@/lib/subscription";

export function SubscriptionUsageCard() {
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .get<SubscriptionSummary>("/subscription/")
      .then(({ data }) => setSubscription(data))
      .catch(() => setNotFound(true));
  }, []);

  if (notFound) {
    return (
      <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Subscription</CardTitle>
          <CardDescription className="text-xs">Your agency doesn&apos;t have a subscription yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!subscription) {
    return (
      <Card className="rounded-2xl border border-border/80 bg-card shadow-2xs animate-pulse">
        <CardHeader className="pb-3">
          <div className="h-4 w-28 rounded bg-muted" />
        </CardHeader>
        <CardContent className="h-24" />
      </Card>
    );
  }

  const period = subscription.current_billing_period;
  const usagePercent = period && period.total_available > 0
    ? Math.round((period.prompt_runs_used / period.total_available) * 100)
    : 0;

  const clientLimit = subscription.plan?.client_limit ?? (subscription.plan.name === "Growth" ? 25 : subscription.plan.name === "Starter" ? 5 : 100);

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            <CardTitle className="text-base font-semibold">{subscription.plan.name} plan</CardTitle>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_STYLES[subscription.status])}>
            {subscription.status.replace("_", " ")}
          </span>
        </div>
        <CardDescription className="text-xs">
          Billed {subscription.billing_interval} · Up to {clientLimit} client workspaces
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5 pt-0 text-xs">
        {period && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Prompt runs used</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatCompactNumber(period.prompt_runs_used)} / {formatCompactNumber(period.total_available)} ({usagePercent}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    usagePercent > 100 ? "bg-destructive" : usagePercent > 80 ? "bg-amber-500" : "bg-primary"
                  )}
                  style={{ width: `${Math.min(100, usagePercent)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <span className="text-muted-foreground">Base allowance</span>
              <span className="text-right font-medium tabular-nums text-foreground">{formatCompactNumber(period.base_prompt_run_allowance)}</span>
              <span className="text-muted-foreground">Client capacity</span>
              <span className="text-right font-medium tabular-nums text-foreground">{clientLimit} clients</span>
              <span className="text-muted-foreground">Remaining runs</span>
              <span className="text-right font-semibold tabular-nums text-primary">{formatCompactNumber(period.prompt_runs_remaining)}</span>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
              <Link
                href="/billing"
                className="font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                <span>Manage billing</span>
                <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
