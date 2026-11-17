"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SubscriptionSummary } from "@/lib/subscription";

/** Fired by lib/api.ts whenever a write comes back 402 -- the workspace is
 * read-only because the subscription lapsed. */
export const SUBSCRIPTION_REQUIRED_EVENT = "avtr:subscription-required";

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

function lapsedHeadline(s: SubscriptionSummary) {
  if (s.status === "past_due") return "Your last payment didn't go through";
  if (s.status === "cancelled") return "Your subscription was cancelled";
  if (s.status === "paused") return "Your subscription is paused";
  return `Your ${s.plan.name} plan expired on ${fmt(s.current_period_end)}`;
}

/** Shown on every app page while the subscription is lapsed: the data is
 * all still there and readable, but nothing can change until renewal. */
export function SubscriptionLockBanner({ subscription }: { subscription: SubscriptionSummary }) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-500">
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{lapsedHeadline(subscription)}</p>
          <p className="text-xs text-muted-foreground">
            Your workspace is read-only. Scores, reports and past results stay visible, but new audits, scheduled
            runs and changes are paused until you renew.
          </p>
        </div>
      </div>
      <Button render={<Link href="/subscribe" />} nativeButton={false} className="h-9 shrink-0 px-4">
        <RefreshCw className="size-4" />
        Renew now
      </Button>
    </div>
  );
}

/** Pops up when a locked action is attempted (Run, Add, Edit, Delete...). */
export function RenewRequiredDialog() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRequired = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setMessage(detail || "Renew your plan to run audits and make changes again.");
    };
    window.addEventListener(SUBSCRIPTION_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(SUBSCRIPTION_REQUIRED_EVENT, onRequired);
  }, []);

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && setMessage(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500">
            <Lock className="size-5" />
          </div>
          <DialogTitle>Renew to continue</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setMessage(null)}>
            Not now
          </Button>
          <Button render={<Link href="/subscribe" />} nativeButton={false} onClick={() => setMessage(null)}>
            <RefreshCw className="size-4" />
            Renew plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
