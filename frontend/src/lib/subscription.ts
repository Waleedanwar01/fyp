export type SubscriptionStatus = "pending" | "active" | "trialing" | "past_due" | "cancelled" | "expired" | "paused";

export type PlanOption = {
  id?: string;
  slug: string;
  name: string;
  monthly_price_usd: string;
  yearly_price_usd: string;
  prompt_runs_included: number;
  client_limit?: number;
  providers?: string[];
  rollover_enabled?: boolean;
};

export type BillingPeriod = {
  id?: string;
  base_prompt_run_allowance: number;
  rollover_received: number;
  total_available: number;
  prompt_runs_used: number;
  prompt_runs_remaining: number;
  period_start: string;
  period_end: string;
  closed_at?: string | null;
  rollover_generated?: number;
};

export type SubscriptionSummary = {
  id?: string;
  status: SubscriptionStatus;
  billing_interval: "monthly" | "yearly";
  current_period_start: string;
  current_period_end: string;
  plan: { id?: string; name: string; slug?: string; prompt_runs_included: number; client_limit?: number };
  current_billing_period: BillingPeriod | null;
  auto_renew?: boolean;
  card_brand?: string;
  card_last4?: string;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
};

/** Paid before, now lapsed: the workspace opens read-only instead of
 * sending the agency to /subscribe (that's only for never-paid agencies). */
export function isLapsedStatus(status: SubscriptionStatus): boolean {
  return status === "expired" || status === "cancelled" || status === "past_due" || status === "paused";
}

// Mirrors Subscription.is_usable() (core/models.py) -- keep in sync.
export function isUsableStatus(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

export const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  pending: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trialing: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  past_due: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  paused: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-destructive/10 text-destructive",
};

// Payment collection is manual for now (real Stripe checkout is a later
// phase) -- every one of these points back at the same fix: an admin
// confirms payment out of band and activates the subscription in
// Django admin (see SubscriptionAdmin.activate_subscriptions).
export const NOT_USABLE_MESSAGES: Partial<Record<SubscriptionStatus, string>> = {
  pending: "Payment isn't automated yet — we'll activate your plan once it's confirmed. Every feature unlocks then.",
  past_due: "Your last payment didn't go through — features are paused until it's resolved.",
  paused: "Your subscription is paused — contact us to resume.",
  expired: "Your billing period ended without renewal — contact us to reactivate.",
  cancelled: "Your subscription was cancelled — contact us to reactivate.",
};
