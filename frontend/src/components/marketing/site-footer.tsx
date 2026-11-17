"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";

import { Button } from "@/components/ui/8bit-button";
import HalftoneWordmarkFooter, { type FooterColumn } from "@/components/ui/halftone-wordmark-footer";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PROVIDER_STATUS } from "@/lib/providers";
import type { PlanOption } from "@/lib/subscription";
import { AvtrMark } from "@/components/brand/avtr-logo";

const PLAN_ORDER = ["starter", "growth", "agency"];

// Midnight Teal. The dots rest in a quiet slate so the giant word reads as
// texture, not a wall of white, and warm to the brand teal when pushed.
// Text colour is set separately in globals.css (.avtr-footer).
const PALETTE = { background: "#0b1120", ink: "#2b3a52", warm: "#2dd4bf" };

/** Resolves a next/font CSS variable (set on <html> in layout.tsx) to the
 * real family list -- the halftone wordmark is drawn on a canvas, and
 * canvas `font` strings can't read CSS variables. Lazy state, not an
 * effect: the value only feeds the canvas, never server-rendered markup. */
function useResolvedFont(variable: string, fallback: string) {
  const [family] = useState(() => {
    if (typeof window === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return value ? `${value}, ${fallback}` : fallback;
  });
  return family;
}

/** Plans come from the same public GET /plans/ the pricing page uses, so
 * the footer never lists a plan that doesn't exist (or misses a new one).
 * Until they load -- or if the API is unreachable -- the column still
 * offers the pricing page itself. */
function usePlans() {
  const [plans, setPlans] = useState<PlanOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get<PlanOption[]>("/plans/")
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        setPlans(
          [...data].sort((a, b) => {
            const ia = PLAN_ORDER.indexOf(a.slug);
            const ib = PLAN_ORDER.indexOf(b.slug);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          })
        );
      })
      .catch(() => {
        /* keep the static pricing link */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return plans;
}

export function SiteFooter() {
  const { user } = useAuth();
  const plans = usePlans();
  const sans = useResolvedFont("--font-geist-sans", "Helvetica Neue, Arial, sans-serif");

  // Only engines actually wired up on the backend (see lib/providers).
  const liveEngines = Object.values(PROVIDER_STATUS)
    .filter((p) => p.enabled)
    .map((p) => p.label);

  const columns = useMemo<FooterColumn[]>(
    () => [
      {
        title: "Product",
        links: [
          { label: "Features", href: "/features" },
          { label: "How it works", href: "/how-it-works" },
          { label: "Live demo", href: "/demo" },
        ],
      },
      {
        title: "Plans",
        links: [
          ...plans.map((p) => ({
            label: p.name,
            href: `/checkout?plan=${encodeURIComponent(p.slug)}&interval=monthly`,
          })),
          { label: "Compare plans", href: "/pricing" },
        ],
      },
      {
        title: "Company",
        links: [
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
          { label: "support@ranklens.app", href: "mailto:support@ranklens.app" },
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
        ],
      },
    ],
    [plans]
  );

  return (
    <div className="dark bg-[#0b1120] text-slate-200">
      {/* Closing call to action -- same ground as the footer below, so the
          two read as one block. Padding matches the footer's own gutters. */}
      <section className="px-[clamp(20px,3.4vw,44px)] pt-[clamp(40px,6vw,72px)]">
        <div className="flex flex-col gap-8 rounded-2xl border border-white/6 bg-white/2 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-xl flex-col gap-3">
            <Link href="/" className="flex w-fit items-center gap-2.5">
              <AvtrMark className="size-8" />
              <span className="text-base font-semibold tracking-tight text-white">RankLens</span>
            </Link>
            <h2 className="text-2xl font-semibold tracking-tight text-balance text-white sm:text-3xl">
              See how AI recommends your clients.
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Mentions, rankings, sentiment and citations across AI engines — with a traceable score behind every
              number.
            </p>
          </div>

          <div className="flex flex-col gap-5 px-1.5 sm:flex-row">
            {user ? (
              <Button render={<Link href="/dashboard" />} nativeButton={false} className="h-12 px-6">
                Open dashboard
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <>
                <Button render={<Link href="/checkout?plan=growth&interval=monthly" />} nativeButton={false} className="h-12 px-6">
                  Start free trial
                  <ArrowRight className="size-4" />
                </Button>
                <Button render={<Link href="/demo" />} nativeButton={false} variant="outline" className="h-12 px-6">
                  <Play className="size-3.5 fill-current" />
                  Live demo
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      <HalftoneWordmarkFooter
        className="avtr-footer"
        wordmark="ranklens"
        label="RankLens · AI visibility for agencies"
        meta={`© ${new Date().getFullYear()} RankLens${liveEngines.length ? ` · Live on ${liveEngines.join(", ")}` : ""}`}
        columns={columns}
        palette={PALETTE}
        fontFamily={sans}
        fontWeight={800}
        monoFamily="var(--font-geist-mono), ui-monospace, Menlo, monospace"
        dotGap={7}
        radius={110}
        crop={0.34}
        grain={0.35}
        height="clamp(540px, 38vw, 560px)"
      />
    </div>
  );
}
