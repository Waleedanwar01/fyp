"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  ShieldCheck,
  Zap,
  Rocket,
  Building2,
  Check,
  AlertCircle,
  Sparkles,
  Lock,
  Loader2,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, extractErrorMessage } from "@/lib/api";
import { TEST_CARD, cardSummary, formatCardNumber, formatExpiry, validateTestCard } from "@/lib/test-card";
import { AutoRenewCheckbox } from "@/components/billing/auto-renew-checkbox";
import { useAuth } from "@/lib/auth-context";
import {
  isUsableStatus,
  NOT_USABLE_MESSAGES,
  STATUS_STYLES,
  type PlanOption,
  type SubscriptionSummary,
} from "@/lib/subscription";
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

export default function SubscribePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>(DEFAULT_PLANS);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState<string>("growth");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");

  // Payment Form state
  const [cardNumber, setCardNumber] = useState(TEST_CARD.number);
  const [cardExpiry, setCardExpiry] = useState(TEST_CARD.expiry);
  const [cardCvc, setCardCvc] = useState(TEST_CARD.cvc);
  const [autoRenew, setAutoRenew] = useState(true);
  const [cardName, setCardName] = useState("Alex Vance");

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api
      .get<SubscriptionSummary>("/subscription/")
      .then(({ data }) => {
        setSubscription(data);
        if (data?.plan?.name) {
          const match = plans.find((p) => p.name.toLowerCase() === data.plan.name.toLowerCase());
          if (match) setSelectedPlanSlug(match.slug);
        }
        if (data?.billing_interval) {
          setBillingInterval(data.billing_interval);
        }
      })
      .catch(() => setSubscription(null));
  }, [user, refreshKey, plans]);

  useEffect(() => {
    api
      .get<PlanOption[]>("/plans/")
      .then(({ data }) => {
        const ORDER = ["starter", "growth", "agency"];
        const filtered = (data || [])
          .filter((p) => ORDER.includes(p.slug))
          .sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));
        if (filtered.length > 0) setPlans(filtered);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (subscription && isUsableStatus(subscription.status)) {
      router.replace("/dashboard");
    }
  }, [subscription, router]);

  const handleFillTestCard = () => {
    setCardNumber(TEST_CARD.number);
    setCardExpiry(TEST_CARD.expiry);
    setCardCvc(TEST_CARD.cvc);
    setCardName(user?.agency?.name ?? "Alex Vance");
  };

  const handleActivatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cardError = validateTestCard(cardNumber, cardExpiry, cardCvc);
    if (cardError) {
      setErrorMessage(cardError);
      return;
    }
    setProcessing(true);

    try {
      setProcessingStatus("Contacting test payment gateway...");
      await new Promise((r) => setTimeout(r, 500));

      // Choose / sync plan
      setProcessingStatus("Assigning " + selectedPlanSlug.toUpperCase() + " plan...");
      await api.post("/subscription/choose-plan/", {
        plan: selectedPlanSlug,
        billing_interval: billingInterval,
      });

      // Activate test subscription
      setProcessingStatus("Provisioning prompt run credits...");
      await new Promise((r) => setTimeout(r, 500));
      await api.post("/subscription/activate-test/", { auto_renew: autoRenew, ...cardSummary(cardNumber, cardExpiry) });

      setProcessingStatus("Subscription active! Launching dashboard...");
      await new Promise((r) => setTimeout(r, 600));

      router.replace("/dashboard");
    } catch (err) {
      setProcessing(false);
      setProcessingStatus(null);
      setErrorMessage(extractErrorMessage(err));
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentPlan = plans.find((p) => p.slug === selectedPlanSlug) || plans[0] || DEFAULT_PLANS[1];
  const monthlyNum = Number(currentPlan.monthly_price_usd);
  const yearlyNum = Number(currentPlan.yearly_price_usd);
  const price = billingInterval === "yearly" ? yearlyNum : monthlyNum;
  const Icon = PLAN_ICONS[currentPlan.slug] ?? Zap;

  return (
    <div className="theme-marketing min-h-screen bg-background text-foreground flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md px-5 py-3.5 sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <AvtrMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">RankLens Activation</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/20 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="size-3.5" />
              <span>Test Mode Gateway</span>
            </span>
            <Button variant="ghost" size="sm" onClick={logout} className="text-xs">
              Log out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 w-full">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left: Test Payment Checkout */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Activate your workspace</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Welcome, <strong>{user.agency?.name ?? user.email}</strong>. Complete your test subscription to unlock all client monitoring features.
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

            <form onSubmit={handleActivatePayment} className="flex flex-col gap-5">
              {/* Plan Choice Selector */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="font-semibold text-sm">Select Subscription Tier</span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setBillingInterval("monthly")}
                      className={cn(
                        "px-2 py-1 rounded-md font-medium transition-colors",
                        billingInterval === "monthly"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingInterval("yearly")}
                      className={cn(
                        "px-2 py-1 rounded-md font-medium transition-colors",
                        billingInterval === "yearly"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      Yearly (Save 20%)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {plans.map((p) => {
                    const isSelected = selectedPlanSlug === p.slug;
                    const pPrice =
                      billingInterval === "yearly" ? Number(p.yearly_price_usd) : Number(p.monthly_price_usd);
                    const periodP = billingInterval === "yearly" ? Math.round(pPrice / 12) : pPrice;

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
                        <p className="mt-2 text-lg font-bold">
                          ${periodP}
                          <span className="text-xs font-normal text-muted-foreground">/mo</span>
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {p.prompt_runs_included.toLocaleString()} Runs
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Details Form */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="font-semibold text-sm">Test Payment Credentials</span>
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
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Expires</label>
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
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">CVC</label>
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

                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Cardholder Name</label>
                    <Input
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      placeholder="Alex Vance"
                      required
                    />
                  </div>
                </div>
              </div>

              <AutoRenewCheckbox checked={autoRenew} onChange={setAutoRenew} interval={billingInterval} />

              {/* Error Message */}
              {errorMessage && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit CTA */}
              <Button
                type="submit"
                size="lg"
                disabled={processing}
                className="w-full text-base font-semibold py-6 shadow-md"
              >
                {processing ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-5 animate-spin" />
                    <span>{processingStatus}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Lock className="size-4" />
                    <span>
                      Pay ${price} & Activate Agency (Test Mode)
                    </span>
                  </div>
                )}
              </Button>
            </form>
          </div>

          {/* Right: Summary Card */}
          <div className="lg:col-span-5 sticky top-20">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-base font-bold">Plan Summary</h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary capitalize">
                  {billingInterval}
                </span>
              </div>

              <div className="flex items-start gap-3.5 rounded-xl bg-secondary/40 p-4">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-bold text-base">{currentPlan.name} Tier</h3>
                  <p className="text-xs text-muted-foreground">
                    {currentPlan.prompt_runs_included.toLocaleString()} Prompt Runs included / period
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 text-xs text-muted-foreground border-b border-border pb-4">
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500" />
                  <span>
                    <strong>{currentPlan.prompt_runs_included.toLocaleString()}</strong> AI Prompt Runs
                  </span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500" />
                  <span>Up to <strong>{currentPlan.client_limit ?? 25}</strong> Client workspaces</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500" />
                  <span>OpenAI, Claude, Gemini & Perplexity engines</span>
                </div>
                <div className="flex items-center gap-2 text-foreground">
                  <Check className="size-3.5 text-emerald-500" />
                  <span>Row-Level Security multi-tenant isolation</span>
                </div>
              </div>

              <div className="flex justify-between items-baseline pt-2">
                <span className="text-sm font-semibold">Total Due Today</span>
                <span className="text-2xl font-extrabold text-primary">${price}.00</span>
              </div>

              <div className="rounded-xl bg-secondary/30 p-3 text-[11px] text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
                <span>Instant test mode unlock into your agency dashboard.</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        RankLens Multi-Tenant AI Visibility Platform · Test Mode Active
      </footer>
    </div>
  );
}
