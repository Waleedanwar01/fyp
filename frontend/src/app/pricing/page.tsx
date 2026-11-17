"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  HelpCircle,
  ChevronDown,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { InkOrbitPricing } from "@/components/marketing/ink-orbit-pricing";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const FAQ_ITEMS = [
  {
    q: "How do Prompt Run credits work?",
    a: "Every time RankLens queries an AI provider (OpenAI, Claude, Gemini, or Perplexity) to evaluate your client's search visibility, 1 Prompt Run credit is used. Credits renew automatically at the start of each billing period.",
  },
  {
    q: "Do unused prompt credits roll over to the next month?",
    a: "Yes! If rollover is enabled on your plan, unused credits from your previous billing cycle automatically roll into your next cycle so you never lose unused search runs.",
  },
  {
    q: "Can I upgrade, downgrade, or cancel anytime?",
    a: "Absolutely. You can switch plans or change between monthly and yearly billing cycles at any time from your Billing & Credits dashboard. Prorated adjustments apply immediately.",
  },
  {
    q: "How does the Test Mode payment work?",
    a: "Currently, our billing checkout runs in Test Mode. You can experience the complete SaaS checkout flow, test cards, plan selection, and instant activation without any real charges.",
  },
  {
    q: "Are citations and sentiment analysis included in all tiers?",
    a: "Yes, every plan includes multi-engine citation extraction, sentiment scoring, rank tracking, and verifiable evidence trails.",
  },
];

const COMPARISON_FEATURES = [
  {
    category: "AI Engines & Visibility",
    items: [
      { name: "OpenAI GPT-4o & ChatGPT Search", starter: "Included", growth: "Included", agency: "Included" },
      { name: "Anthropic Claude 3.5 Sonnet", starter: "—", growth: "Included", agency: "Included" },
      { name: "Google Gemini 1.5 Pro & Search", starter: "—", growth: "Included", agency: "Included" },
      { name: "Perplexity AI Real-Time Citations", starter: "—", growth: "Included", agency: "Included" },
      { name: "Verifiable Citation & URL Extraction", starter: "Standard", growth: "Advanced", agency: "Deep Trace" },
      { name: "Sentiment & Position Ranking", starter: "Included", growth: "Included", agency: "Included" },
    ],
  },
  {
    category: "Capacity & Organization",
    items: [
      { name: "Prompt Runs Included", starter: "300 / mo", growth: "600 / mo", agency: "1,000 / mo" },
      { name: "Active Clients Limit", starter: "Up to 5", growth: "Up to 25", agency: "Unlimited (100+)" },
      { name: "Brands & Competitors per Client", starter: "Unlimited", growth: "Unlimited", agency: "Unlimited" },
      { name: "Automated Schedules (Daily / Weekly)", starter: "Weekly only", growth: "Daily & Custom", agency: "Priority Hourly / Daily" },
      { name: "Credit Rollover Support", starter: "—", growth: "1 Month Rollover", agency: "Full Rollover" },
    ],
  },
  {
    category: "Team & Security",
    items: [
      { name: "PostgreSQL Row-Level Security (RLS)", starter: "Strict Tenant Isolation", growth: "Strict Tenant Isolation", agency: "Strict Tenant Isolation" },
      { name: "Team Seats", starter: "2 Members", growth: "5 Members", agency: "Unlimited" },
      { name: "White-Label Agency Reports", starter: "Standard", growth: "Custom Branded", agency: "Custom Branded + API" },
      { name: "Customer Support", starter: "Email Support", growth: "Priority Email & Chat", agency: "Dedicated Account Lead" },
    ],
  },
];

export default function PricingPage() {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1">
        <InkOrbitPricing
          as="h1"
          title="Simple plans for every agency"
          description="Every plan includes traceable visibility scores, citation evidence and white-label reports. Switch or cancel any time."
        />

        {/* Feature Comparison Matrix */}
        <section className="border-t border-border bg-secondary/20 px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">Comprehensive Tier Comparison</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Everything your agency needs to monitor brand search presence and citations in one place.
              </p>
            </div>

            <div className="mt-12 overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="p-4 font-semibold text-foreground">Features & Capabilities</th>
                    <th className="p-4 font-semibold text-foreground">Starter</th>
                    <th className="p-4 font-semibold text-foreground text-primary">Growth (Popular)</th>
                    <th className="p-4 font-semibold text-foreground">Agency</th>
                  </tr>
                </thead>
                {COMPARISON_FEATURES.map((section) => (
                  <tbody key={section.category} className="divide-y divide-border border-t border-border">
                      <tr className="bg-secondary/30">
                        <td colSpan={4} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {section.category}
                        </td>
                      </tr>
                      {section.items.map((item) => (
                        <tr key={item.name} className="hover:bg-secondary/15 transition-colors">
                          <td className="p-4 font-medium text-foreground">{item.name}</td>
                          <td className="p-4 text-muted-foreground">{item.starter}</td>
                          <td className="p-4 font-medium text-foreground">{item.growth}</td>
                          <td className="p-4 text-muted-foreground">{item.agency}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
              </table>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <HelpCircle className="size-3.5" />
                <span>Frequently Asked Questions</span>
              </div>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Everything you need to know</h2>
            </div>

            <div className="mt-8 flex flex-col gap-3">
              {FAQ_ITEMS.map((faq, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div
                    key={idx}
                    className="overflow-hidden rounded-xl border border-border bg-card transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      className="flex w-full items-center justify-between p-4 text-left font-medium text-foreground hover:bg-secondary/40"
                    >
                      <span>{faq.q}</span>
                      <ChevronDown
                        className={cn("size-4 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground bg-secondary/10">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Bottom Banner */}
        <section className="border-t border-border px-5 py-16 sm:px-8 text-center bg-card">
          <div className="mx-auto max-w-3xl flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold sm:text-3xl">Ready to automate your AI visibility tracking?</h2>
            <p className="text-sm text-muted-foreground max-w-xl">
              Join leading digital marketing agencies tracking brand positioning across ChatGPT, Claude, Gemini, and Perplexity.
            </p>
            <div className="mt-2 flex items-center gap-3">
              {(() => {
                const bottomTarget = "/checkout?plan=growth&interval=monthly";
                const target = user ? bottomTarget : `/login?redirect=${encodeURIComponent(bottomTarget)}`;
                return (
                  <Button render={<Link href={target} />} nativeButton={false} size="lg">
                    Start Test Checkout
                    <ArrowRight className="size-4 ml-1.5" />
                  </Button>
                );
              })()}
              <Button render={<Link href="/login" />} nativeButton={false} variant="outline" size="lg">
                Existing Agency Login
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
