"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Lock,
  Rocket,
  ShieldCheck,
  Sparkles,
  Zap,
  Building2,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { api, extractErrorMessage } from "@/lib/api";
import { TEST_CARD, cardSummary, formatCardNumber, formatExpiry, validateTestCard } from "@/lib/test-card";
import { AutoRenewCheckbox } from "@/components/billing/auto-renew-checkbox";
import { useAuth } from "@/lib/auth-context";
import { type PlanOption, type SubscriptionSummary, isUsableStatus } from "@/lib/subscription";
import { cn } from "@/lib/utils";
import { AvtrMark } from "@/components/brand/avtr-logo";

const PLAN_ICONS: Record<string, typeof Rocket> = {
  starter: Rocket,
  growth: Zap,
  agency: Building2,
};

const DEFAULT_PLANS: PlanOption[] = [
  {
    slug: "starter",
    name: "Starter",
    monthly_price_usd: "49.00",
    yearly_price_usd: "490.00",
    prompt_runs_included: 300,
    client_limit: 5,
    providers: ["openai"],
  },
  {
    slug: "growth",
    name: "Growth",
    monthly_price_usd: "149.00",
    yearly_price_usd: "1490.00",
    prompt_runs_included: 600,
    client_limit: 25,
    providers: ["openai", "claude", "gemini", "perplexity"],
  },
  {
    slug: "agency",
    name: "Agency",
    monthly_price_usd: "349.00",
    yearly_price_usd: "3490.00",
    prompt_runs_included: 1000,
    client_limit: 100,
    providers: ["openai", "claude", "gemini", "perplexity"],
  },
];

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, login } = useAuth();

  const initialPlanSlug = searchParams.get("plan") || "growth";
  const initialInterval = (searchParams.get("interval") as "monthly" | "yearly") || "monthly";

  const [plans, setPlans] = useState<PlanOption[]>(DEFAULT_PLANS);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState<string>(initialPlanSlug);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(initialInterval);

  // Check if user already has an active subscription
  const [existingSubscription, setExistingSubscription] = useState<SubscriptionSummary | null>(null);
  const [checkingSub, setCheckingSub] = useState(false);

  // If not logged in, redirect to login page first to login / register
  useEffect(() => {
    if (!loading && !user) {
      const returnUrl = `/checkout?plan=${selectedPlanSlug}&interval=${billingInterval}`;
      router.replace(`/login?redirect=${encodeURIComponent(returnUrl)}`);
    }
  }, [user, loading, router, selectedPlanSlug, billingInterval]);

  // If already subscribed and active, redirect to dashboard
  useEffect(() => {
    if (user && existingSubscription && isUsableStatus(existingSubscription.status)) {
      router.replace("/dashboard");
    }
  }, [user, existingSubscription, router]);

  // Payment Form state
  const [cardNumber, setCardNumber] = useState(TEST_CARD.number);
  const [cardExpiry, setCardExpiry] = useState(TEST_CARD.expiry);
  const [cardCvc, setCardCvc] = useState(TEST_CARD.cvc);
  const [autoRenew, setAutoRenew] = useState(true);
  const [cardName, setCardName] = useState("Alex Vance");
  const [zipCode, setZipCode] = useState("94103");

  // Status & simulation state
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    api
      .get<PlanOption[]>("/plans/")
      .then(({ data }) => {
        if (data && data.length > 0) setPlans(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      setCheckingSub(true);
      api
        .get<SubscriptionSummary>("/subscription/")
        .then(({ data }) => setExistingSubscription(data))
        .catch(() => setExistingSubscription(null))
        .finally(() => setCheckingSub(false));
    }
  }, [user]);

  const currentPlan = plans.find((p) => p.slug === selectedPlanSlug) || plans[0] || DEFAULT_PLANS[1];
  const monthlyNum = Number(currentPlan.monthly_price_usd);
  const yearlyNum = Number(currentPlan.yearly_price_usd);
  const totalAmount = billingInterval === "yearly" ? yearlyNum : monthlyNum;
  const savings = monthlyNum * 12 - yearlyNum;
  const Icon = PLAN_ICONS[currentPlan.slug] ?? Zap;

  const handleFillTestCard = () => {
    setCardNumber(TEST_CARD.number);
    setCardExpiry(TEST_CARD.expiry);
    setCardCvc(TEST_CARD.cvc);
    setCardName(user?.agency?.name ?? "Alex Vance");
    setZipCode("94107");
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cardError = validateTestCard(cardNumber, cardExpiry, cardCvc);
    if (cardError) {
      setErrorMessage(cardError);
      return;
    }

    if (!user) {
      const returnUrl = `/checkout?plan=${selectedPlanSlug}&interval=${billingInterval}`;
      router.replace(`/login?redirect=${encodeURIComponent(returnUrl)}`);
      return;
    }

    try {
      // Step 1: Processing simulation start
      setProcessingStep("Verifying test payment authorization...");
      await new Promise((r) => setTimeout(r, 400));

      // Step 2: Assign plan
      setProcessingStep("Updating plan selection to " + currentPlan.name + " (" + currentPlan.prompt_runs_included.toLocaleString() + " runs)...");
      await api.post("/subscription/choose-plan/", {
        plan: currentPlan.slug,
        billing_interval: billingInterval,
      });

      // Step 3: Activate test subscription
      setProcessingStep("Allotting " + currentPlan.prompt_runs_included.toLocaleString() + " Prompt Run credits...");
      await new Promise((r) => setTimeout(r, 400));
      await api.post("/subscription/activate-test/", { auto_renew: autoRenew, ...cardSummary(cardNumber, cardExpiry) });

      // Step 4: Finalize
      setProcessingStep("Workspace active! Launching dashboard...");
      setIsSuccess(true);
      await new Promise((r) => setTimeout(r, 500));

      router.push("/dashboard");
    } catch (err) {
      setProcessingStep(null);
      setErrorMessage(extractErrorMessage(err));
    }
  };

  // If the user is already logged in and has an active subscription, block checkout and redirect them
  if (user && existingSubscription && isUsableStatus(existingSubscription.status)) {
    const activePlan = existingSubscription.plan;
    return (
      <div className="theme-marketing min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Back to Dashboard</span>
            </Link>

            <div className="flex items-center gap-2">
              <AvtrMark className="size-7" />
              <span className="text-base font-semibold tracking-tight">RankLens Checkout</span>
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="size-3.5" />
              <span>Active Subscription</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8 text-center">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-lg flex flex-col items-center gap-6">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-8" />
            </div>

            <div className="flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 self-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" /> Subscription Active
              </span>
              <h1 className="text-2xl font-bold sm:text-3xl text-foreground">
                {user.agency?.name ?? "Your Agency"} is already on the {activePlan.name} Tier
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your workspace is active with <strong>{activePlan.prompt_runs_included.toLocaleString()} Prompt Runs</strong> and full AI search visibility tracking enabled. You do not need to check out again.
              </p>
            </div>

            <div className="w-full rounded-xl bg-secondary/40 p-4 text-xs flex flex-col gap-2 border border-border/60 text-left">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Plan</span>
                <span className="font-semibold text-foreground">{activePlan.name} ({existingSubscription.billing_interval})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Billing Cycle</span>
                <span className="font-semibold text-foreground">{existingSubscription.current_period_start} &rarr; {existingSubscription.current_period_end}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client Workspace Limit</span>
                <span className="font-semibold text-foreground">Up to {activePlan.client_limit ?? 25} Clients</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
              <Button
                className="w-full sm:flex-1 font-semibold py-5"
                onClick={() => router.push("/dashboard")}
              >
                Go to Agency Dashboard &rarr;
              </Button>
              <Button
                variant="outline"
                className="w-full sm:flex-1 py-5"
                onClick={() => router.push("/billing")}
              >
                Manage &amp; Upgrade in Billing
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="theme-marketing min-h-screen bg-background text-foreground">
      {/* Top Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span>Back to Pricing</span>
          </Link>

          <div className="flex items-center gap-2">
            <AvtrMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">RankLens Checkout</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="size-3.5" />
            <span>Test Mode Active</span>
          </div>
        </div>
      </header>

      {/* Main Checkout Area */}
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
          {/* Left Column: Form Steps */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Complete your subscription</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Get immediate access to multi-engine AI visibility tracking and automated client reporting.
              </p>
            </div>

            {/* Test Mode Notification Box */}
            <div className="rounded-xl border border-amber-600/20 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertCircle className="size-5 shrink-0 text-amber-700 mt-0.5" />
                <div className="flex-1 text-xs">
                  <p className="font-semibold text-sm text-amber-900">
                    Payment Gateway is running in Test Mode
                  </p>
                  <p className="mt-1 text-amber-800">
                    No real card is charged. Pay with the test card <strong>4242 4242 4242 4242</strong>, any future expiry
                    date and any 3-digit CVC. To see a failed payment, use <strong>4000 0000 0000 0002</strong> (declined).
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleCheckout} className="flex flex-col gap-6" noValidate>
              {/* Step 1: User Account */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      1
                    </span>
                    <span>Account Information</span>
                  </div>
                  {user && (
                    <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" /> Verified
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-3.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{user?.agency?.name ?? "Agency Account"}</p>
                    <p className="text-xs text-muted-foreground">Logged in as {user?.email}</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    Active Session
                  </span>
                </div>
              </div>

              {/* Step 2: Plan Selection Customizer */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      2
                    </span>
                    <span>Select Tier & Cycle</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setBillingInterval("monthly")}
                      className={cn(
                        "px-2.5 py-1 rounded-md font-medium transition-colors",
                        billingInterval === "monthly" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingInterval("yearly")}
                      className={cn(
                        "px-2.5 py-1 rounded-md font-medium transition-colors",
                        billingInterval === "yearly" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                      )}
                    >
                      Yearly (Save 20%)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {plans.map((p) => {
                    const isSelected = selectedPlanSlug === p.slug;
                    const price = billingInterval === "yearly" ? Number(p.yearly_price_usd) : Number(p.monthly_price_usd);
                    const periodPrice = billingInterval === "yearly" ? Math.round(price / 12) : price;

                    return (
                      <button
                        key={p.slug}
                        type="button"
                        onClick={() => setSelectedPlanSlug(p.slug)}
                        className={cn(
                          "flex flex-col items-start p-3.5 rounded-xl border text-left transition-all",
                          isSelected
                            ? "border-primary bg-primary/5 ring-2 ring-primary"
                            : "border-border bg-card hover:border-foreground/20"
                        )}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="font-semibold text-sm">{p.name}</span>
                          {isSelected && <Check className="size-4 text-primary" />}
                        </div>
                        <p className="mt-2 text-xl font-bold">
                          ${periodPrice}
                          <span className="text-xs font-normal text-muted-foreground">/mo</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {p.prompt_runs_included.toLocaleString()} Prompt Runs
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Payment Method Form */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      3
                    </span>
                    <span>Test Payment Details</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFillTestCard}
                    className="text-xs h-7"
                  >
                    <Sparkles className="size-3 mr-1 text-primary" /> Auto-fill Test Card
                  </Button>
                </div>

                <div className="flex flex-col gap-3.5">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Card Number</label>
                    <div className="relative">
                      <Input
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="4242 4242 4242 4242"
                        className="pl-10 font-mono text-sm"
                        required
                      />
                      <CreditCard className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase text-primary">
                        Visa Test
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Expires (MM/YY)</label>
                      <Input
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="12/28"
                        className="font-mono text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">CVC / CVV</label>
                      <Input
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        placeholder="123"
                        className="font-mono text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Cardholder Name</label>
                      <Input
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="Alex Morgan"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Postal / ZIP Code</label>
                      <Input
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        placeholder="94107"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <AutoRenewCheckbox checked={autoRenew} onChange={setAutoRenew} interval={billingInterval} />

              {/* Error Message */}
              {errorMessage && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit CTA */}
              <div className="flex flex-col gap-3">
                <Button
                  type="submit"
                  size="lg"
                  disabled={!!processingStep}
                  className="w-full text-base font-semibold py-6 shadow-md"
                >
                  {processingStep ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="size-5 animate-spin" />
                      <span>{processingStep}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Lock className="size-4" />
                      <span>
                        Complete Test Payment · Pay ${totalAmount} & Unlock Dashboard
                      </span>
                    </div>
                  )}
                </Button>

                <p className="text-center text-[11px] text-muted-foreground">
                  By completing this order, you agree to RankLens Terms of Service and Privacy Policy. All credit allocations
                  are activated instantly in dev/test mode.
                </p>
              </div>
            </form>
          </div>

          {/* Right Column: Sticky Order Summary */}
          <div className="lg:col-span-5 sticky top-20">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-md flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-lg font-bold">Order Summary</h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {billingInterval === "yearly" ? "Annual Plan" : "Monthly Plan"}
                </span>
              </div>

              {/* Plan Card Mini */}
              <div className="flex items-start gap-4 rounded-xl bg-secondary/40 p-4">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-base">{currentPlan.name} Tier</p>
                    <p className="font-bold text-base">${totalAmount}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {currentPlan.prompt_runs_included.toLocaleString()} Prompt Runs included
                  </p>
                </div>
              </div>

              {/* Included Benefits */}
              <div className="flex flex-col gap-2.5 text-xs text-muted-foreground border-b border-border pb-4">
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span>
                    <strong>{currentPlan.prompt_runs_included.toLocaleString()}</strong> AI Prompt Runs per period
                  </span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span>
                    Up to <strong>{currentPlan.client_limit ?? (currentPlan.slug === "starter" ? 5 : 25)}</strong> Client workspaces
                  </span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span>OpenAI, Claude, Gemini & Perplexity engines</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span>Traceable Citation Extraction & Sentiments</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500 shrink-0" />
                  <span>PostgreSQL RLS strict multi-tenant isolation</span>
                </div>
              </div>

              {/* Price Calculation Breakdown */}
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base Plan Subscription</span>
                  <span className="font-medium">${totalAmount}.00</span>
                </div>

                {billingInterval === "yearly" && savings > 0 && (
                  <div className="flex justify-between text-emerald-500">
                    <span>Annual Discount (2 Months Free)</span>
                    <span>-${savings}.00</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated Tax (0%)</span>
                  <span className="font-medium">$0.00</span>
                </div>

                <div className="flex justify-between border-t border-border pt-3 text-base font-bold text-foreground">
                  <span>Total Due Today</span>
                  <span className="text-primary">${totalAmount}.00</span>
                </div>
              </div>

              {/* Security Badges */}
              <div className="rounded-xl bg-secondary/30 p-3 text-[11px] text-muted-foreground flex flex-col gap-2">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <ShieldCheck className="size-4 text-emerald-500" />
                  <span>Guaranteed Instant Activation</span>
                </div>
                <p>
                  Your subscription and credit balance update immediately upon payment confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
