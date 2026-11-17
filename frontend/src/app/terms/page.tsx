"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function TermsPage() {
  return (
    <div className="theme-marketing flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1 px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-8 sm:p-12 shadow-xs flex flex-col gap-6">
          <div className="border-b border-border pb-4">
            <h1 className="text-3xl font-bold">Terms of Service</h1>
            <p className="text-xs text-muted-foreground mt-1">Last updated: October 2026</p>
          </div>

          <div className="space-y-4 text-xs sm:text-sm text-foreground/90 leading-relaxed">
            <h2 className="text-base font-bold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By creating an account or accessing RankLens services, your agency agrees to be bound by these Terms of Service.
            </p>

            <h2 className="text-base font-bold text-foreground">2. Prompt Run Credits & Subscriptions</h2>
            <p>
              Subscription plans include monthly or yearly allotments of Prompt Run credits. Unused credits from the preceding period may roll over to the subsequent period if enabled on your tier. Over-quota executions require tier upgrade or supplemental credit provisioning.
            </p>

            <h2 className="text-base font-bold text-foreground">3. Acceptable Use Policy</h2>
            <p>
              Agencies agree not to submit prompt queries intended to generate defamatory, malicious, abusive, or infringing content.
            </p>

            <h2 className="text-base font-bold text-foreground">4. Limitation of Liability</h2>
            <p>
              RankLens provides third-party AI visibility and citation scoring on an &quot;as is&quot; basis. We are not liable for autonomous changes made by third-party AI provider models or ranking algorithms.
            </p>

            <h2 className="text-base font-bold text-foreground">5. Inquiries & Notices</h2>
            <p>
              Legal inquiries and notices should be directed to <a href="mailto:legal@ranklens.app" className="text-primary underline">legal@ranklens.app</a>.
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
