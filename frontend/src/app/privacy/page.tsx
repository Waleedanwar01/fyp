"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function PrivacyPage() {
  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1 px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 sm:p-12 shadow-xs flex flex-col gap-6">
          <div className="border-b border-border pb-4">
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
            <p className="text-xs text-muted-foreground mt-1">Last updated: October 2026</p>
          </div>

          <div className="space-y-4 text-xs sm:text-sm text-foreground/90 leading-relaxed">
            <h2 className="text-base font-bold text-foreground">1. Introduction</h2>
            <p>
              RankLens (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is dedicated to protecting the privacy of digital marketing agencies
              and their clients. This Privacy Policy explains how we collect, process, and safeguard information when you
              use our AI visibility tracking platform.
            </p>

            <h2 className="text-base font-bold text-foreground">2. Information We Collect</h2>
            <p>
              We collect information necessary to deliver multi-tenant AI visibility monitoring:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><strong>Agency Account Data:</strong> Agency name, admin email address, encrypted passwords, and billing records.</li>
              <li><strong>Client Tracking Metadata:</strong> Client brand names, product entities, competitor keywords, and search prompt configurations.</li>
              <li><strong>AI Query Logs:</strong> Ground-truth responses, citation links, and sentiment scores returned by AI provider APIs.</li>
            </ul>

            <h2 className="text-base font-bold text-foreground">3. Multi-Tenant Data Isolation</h2>
            <p>
              All client information and search prompt histories are strictly isolated using PostgreSQL Row-Level Security (RLS).
              We never use your agency&apos;s proprietary client prompts or visibility data to train public AI models.
            </p>

            <h2 className="text-base font-bold text-foreground">4. Third-Party AI Providers</h2>
            <p>
              When executing automated prompt schedules, RankLens transmits search prompts to authorized AI API endpoints (OpenAI, Anthropic, Google, and Perplexity) under strict business-tier data processing agreements.
            </p>

            <h2 className="text-base font-bold text-foreground">5. Contact Us</h2>
            <p>
              If you have any questions regarding this Privacy Policy, please email us at <a href="mailto:privacy@ranklens.app" className="text-primary underline">privacy@ranklens.app</a>.
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
