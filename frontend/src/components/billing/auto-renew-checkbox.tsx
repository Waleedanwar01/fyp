"use client";

import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

/** Checkout opt-in: renew automatically at the end of each billing period
 * by charging the card entered above. */
export function AutoRenewCheckbox({
  checked,
  onChange,
  interval,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  interval: "monthly" | "yearly";
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors",
        checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-(--primary)"
      />
      <span className="text-xs">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <RefreshCw className="size-3.5 text-primary" />
          Auto-renew every {interval === "yearly" ? "year" : "month"}
        </span>
        <span className="mt-0.5 block text-muted-foreground">
          This card is charged automatically when your plan ends, so your dashboard never locks. Turn it off any
          time from Billing.
        </span>
      </span>
    </label>
  );
}
