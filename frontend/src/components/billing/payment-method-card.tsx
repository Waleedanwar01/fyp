"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api, extractErrorMessage } from "@/lib/api";
import { isLapsedStatus, type SubscriptionSummary } from "@/lib/subscription";
import { cn } from "@/lib/utils";

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

/** Saved card + auto-renew switch on the Billing page. */
export function PaymentMethodCard({
  subscription,
  onChange,
}: {
  subscription: SubscriptionSummary | null;
  onChange: (next: SubscriptionSummary) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCard = !!subscription?.card_last4;
  const expMonth = subscription?.card_exp_month;
  const expYear = subscription?.card_exp_year;
  const now = new Date();
  const cardExpired =
    hasCard && !!expYear && !!expMonth && (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1));
  const lapsed = subscription ? isLapsedStatus(subscription.status) : false;
  const autoRenew = !!subscription?.auto_renew;

  const toggle = async () => {
    if (!subscription) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch<SubscriptionSummary>("/subscription/auto-renew/", { auto_renew: !autoRenew });
      onChange(data);
      window.dispatchEvent(new Event("avtr:subscription-updated"));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Payment method & renewal</h3>
        </div>
        {hasCard && (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              cardExpired ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {cardExpired ? "Card expired" : "Card on file"}
          </span>
        )}
      </div>

      {hasCard ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-4">
          <div className="flex h-10 w-14 items-center justify-center rounded-lg border border-border bg-card text-[11px] font-bold uppercase text-primary">
            {subscription?.card_brand || "card"}
          </div>
          <div>
            <p className="font-mono text-sm font-semibold">•••• •••• •••• {subscription?.card_last4}</p>
            <p className="text-xs text-muted-foreground">
              Expires {String(expMonth).padStart(2, "0")}/{expYear}
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No card saved yet. A card is saved the next time you pay or renew.
        </p>
      )}

      {/* Auto-renew switch */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <RefreshCw className="size-3.5 text-primary" />
            Auto-renew
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {autoRenew && subscription && !lapsed
              ? `Your card is charged automatically on ${fmt(subscription.current_period_end)} and your plan continues.`
              : "Off -- your plan ends at the end of the period and the dashboard becomes read-only until you renew."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoRenew}
          aria-label="Auto-renew"
          onClick={toggle}
          disabled={saving || !subscription || (!autoRenew && (!hasCard || cardExpired))}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            autoRenew ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "inline-block size-5 rounded-full bg-white shadow transition-transform",
              autoRenew ? "translate-x-5.5" : "translate-x-0.5"
            )}
          />
          {saving && <Loader2 className="absolute -right-6 size-4 animate-spin text-muted-foreground" />}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {lapsed && (
        <Button render={<Link href="/subscribe" />} nativeButton={false} className="w-full">
          <RefreshCw className="size-4" />
          Renew now
        </Button>
      )}
    </div>
  );
}
