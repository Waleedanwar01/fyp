"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";

import { api } from "@/lib/api";
import { useCountUp } from "@/lib/animations/counter";
import { PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/8bit-button";

/** GET /plans/ shape (core.serializers.SubscriptionPlanSerializer). */
type Plan = {
  id: string;
  slug: string;
  name: string;
  monthly_price_usd: string;
  yearly_price_usd: string;
  prompt_runs_included: number;
  client_limit: number;
  stored_prompt_limit: number;
  active_schedule_limit: number;
  team_member_limit: number;
  providers: string[];
  white_label_level: string;
  support_level: string;
  rollover_enabled: boolean;
  rollover_percent: string;
};

type Interval = "monthly" | "yearly";

const ORDER = ["starter", "growth", "agency"];
// The plan we point people at. A recommendation, not a popularity claim.
const RECOMMENDED = "growth";

const TAGLINES: Record<string, string> = {
  starter: "For small agencies tracking their first clients.",
  growth: "For growing agencies running multi-client tracking.",
  agency: "For large agencies managing many brands at scale.",
};

function money(n: number) {
  return n % 1 === 0 ? `$${n.toLocaleString()}` : `$${n.toFixed(2)}`;
}

/** Per-month price that counts from the previous value to the new one. */
function AnimatedPrice({ value }: { value: number }) {
  const ref = useCountUp(value, (n) => money(Math.round(n * 100) / 100));
  return (
    <span ref={ref} className="tabular-nums">
      {money(value)}
    </span>
  );
}

/** Four L-shaped corner marks around the recommended card. */
function Brackets() {
  const base = "pointer-events-none absolute size-5 border-primary";
  return (
    <>
      <span className={cn(base, "-top-1.5 -left-1.5 rounded-tl-md border-t-2 border-l-2")} aria-hidden />
      <span className={cn(base, "-top-1.5 -right-1.5 rounded-tr-md border-t-2 border-r-2")} aria-hidden />
      <span className={cn(base, "-bottom-1.5 -left-1.5 rounded-bl-md border-b-2 border-l-2")} aria-hidden />
      <span className={cn(base, "-right-1.5 -bottom-1.5 rounded-br-md border-r-2 border-b-2")} aria-hidden />
    </>
  );
}

/** A slow dashed orbit with one travelling dot, behind the recommended price. */
function Orbit() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="pointer-events-none absolute -top-6 -left-5 size-28 text-primary/40 motion-safe:animate-[spin_18s_linear_infinite]"
      aria-hidden
    >
      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
      <circle cx="60" cy="8" r="3" className="fill-primary" />
    </svg>
  );
}

function features(plan: Plan) {
  const engines = plan.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ");
  const list = [
    `${plan.prompt_runs_included.toLocaleString()} prompt runs per period`,
    `Up to ${plan.client_limit.toLocaleString()} client workspaces`,
    `${plan.stored_prompt_limit.toLocaleString()} stored prompts`,
    `${plan.active_schedule_limit.toLocaleString()} active schedules`,
    `${plan.team_member_limit.toLocaleString()} team members`,
  ];
  if (engines) list.push(`AI engines: ${engines}`);
  if (plan.white_label_level) list.push(`White-label: ${plan.white_label_level}`);
  if (plan.support_level) list.push(`Support: ${plan.support_level}`);
  if (plan.rollover_enabled && Number(plan.rollover_percent) > 0) {
    list.push(`${Number(plan.rollover_percent)}% of unused runs roll over`);
  }
  return list;
}

/** Pricing section in the "ink orbit" style: monthly/yearly toggle, prices
 * that count to the new amount, a bracketed recommended plan and
 * selectable cards. Every number -- prices, limits, savings -- comes from
 * GET /plans/, so changing a plan in Django admin changes this section;
 * nothing is hard-coded and there's no stale fallback list. */
export function InkOrbitPricing({
  eyebrow = "Pricing",
  title = "Simple plans for every agency",
  description = "Pick a plan by how many clients you track. Switch or cancel any time.",
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  as?: "h1" | "h2";
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [interval, setBillingInterval] = useState<Interval>("monthly");
  const [selected, setSelected] = useState(RECOMMENDED);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Plan[]>("/plans/")
      .then(({ data }) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).sort((a, b) => {
          const ia = ORDER.indexOf(a.slug);
          const ib = ORDER.indexOf(b.slug);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
        setPlans(list);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Best real yearly discount across plans, e.g. 490 vs 49×12 → 17%.
  const maxSavingPct = (plans ?? []).reduce((best, p) => {
    const full = Number(p.monthly_price_usd) * 12;
    const pct = full > 0 ? Math.round((1 - Number(p.yearly_price_usd) / full) * 100) : 0;
    return Math.max(best, pct);
  }, 0);

  return (
    <section id="pricing" className="px-5 py-24 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
        <div className="flex max-w-2xl flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium tracking-[0.2em] text-primary uppercase">{eyebrow}</p>
          <Heading className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</Heading>
          <p className="text-muted-foreground">{description}</p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center gap-3">
          <div role="radiogroup" aria-label="Billing period" className="relative flex rounded-full border border-border bg-card p-1">
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-foreground transition-transform duration-300 ease-out",
                interval === "yearly" && "translate-x-full"
              )}
            />
            {(["monthly", "yearly"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={interval === key}
                onClick={() => setBillingInterval(key)}
                className={cn(
                  "relative z-10 w-28 rounded-full py-2 text-sm font-medium capitalize transition-colors",
                  interval === key ? "text-background" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {key}
              </button>
            ))}
          </div>
          {maxSavingPct > 0 && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              Save up to {maxSavingPct}% yearly
            </span>
          )}
        </div>

        {/* Plans */}
        {failed ? (
          <p className="text-sm text-muted-foreground">
            Plans couldn&apos;t load right now.{" "}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Contact us
            </Link>{" "}
            for pricing.
          </p>
        ) : !plans ? (
          <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[520px] animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Plans" className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
            {plans.map((plan) => {
              const monthly = Number(plan.monthly_price_usd);
              const yearly = Number(plan.yearly_price_usd);
              const perMonth = interval === "yearly" ? Math.round((yearly / 12) * 100) / 100 : monthly;
              const saving = Math.max(0, monthly * 12 - yearly);
              const isRecommended = plan.slug === RECOMMENDED;
              const isSelected = selected === plan.slug;

              return (
                <div
                  key={plan.id}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => setSelected(plan.slug)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      setSelected(plan.slug);
                    }
                  }}
                  className={cn(
                    "relative flex cursor-pointer flex-col rounded-2xl border bg-card p-7 text-left outline-none transition-all duration-300 focus-visible:ring-4 focus-visible:ring-primary/20",
                    isSelected ? "border-primary shadow-lg" : "border-border hover:border-foreground/25"
                  )}
                >
                  {isRecommended && <Brackets />}

                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{plan.name}</h3>
                    {isRecommended && (
                      <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">{TAGLINES[plan.slug] ?? ""}</p>

                  <div className="relative mt-8">
                    {isRecommended && <Orbit />}
                    <p className="relative flex items-baseline gap-1">
                      <span className="text-5xl font-semibold tracking-tight">
                        <AnimatedPrice value={perMonth} />
                      </span>
                      <span className="text-sm text-muted-foreground">/ month</span>
                    </p>
                    <p className="relative mt-2 h-5 text-xs text-muted-foreground">
                      {interval === "yearly" ? (
                        <>
                          Billed {money(yearly)} yearly
                          {saving > 0 && <span className="ml-1 font-medium text-primary">· save {money(saving)}</span>}
                        </>
                      ) : (
                        "Billed monthly"
                      )}
                    </p>
                  </div>

                  <Button
                    render={<Link href={`/checkout?plan=${encodeURIComponent(plan.slug)}&interval=${interval}`} />}
                    nativeButton={false}
                    variant={isSelected ? "default" : "outline"}
                    onClick={(e) => e.stopPropagation()}
                    className="mx-1.5 mt-8 h-12"
                  >
                    Choose {plan.name}
                    <ArrowRight className="size-4" />
                  </Button>

                  <ul className="mt-7 flex flex-col gap-3 border-t border-border pt-6 text-sm">
                    {features(plan).map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
