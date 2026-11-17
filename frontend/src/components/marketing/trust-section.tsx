"use client";

import { ShieldCheck, GaugeCircle, RefreshCw } from "lucide-react";

import { useScrollReveal } from "@/lib/animations";

// Real architectural facts, not compliance badges RankLens hasn't actually
// earned (no SOC 2 audit, no GDPR certification exists for this product
// -- claiming otherwise would be exactly the "fake data" design bible
// #58 rules out, just dressed up as a trust badge instead of a metric).
// The copy leans into that honestly: "trusted by construction" instead
// of a badge wall, since that's the real, differentiated claim RankLens can
// actually make.
const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "Tenant isolation",
    description:
      "Enforced at the application layer and again at the database layer (PostgreSQL row-level security) -- a bug in one check doesn't mean a breach.",
  },
  {
    icon: GaugeCircle,
    title: "Confidence scored",
    description:
      "Every detected mention carries a 0-1 confidence score. A shaky match is flagged for review, never silently presented as fact.",
  },
  {
    icon: RefreshCw,
    title: "Retry-safe",
    description:
      "Every AI call retries automatically on rate limits and timeouts, and every run is idempotent -- a retry never double-counts in your score.",
  },
];

/** Dark, full-bleed banner (same `.dark` scoping ProblemSection already
 * uses) -- the structural slot a template fills with a compliance-badge
 * wall (SOC 2, GDPR, etc). RankLens hasn't earned those certifications, so
 * this makes the honest version of that same claim instead: real
 * mechanisms a visitor can verify, not a badge they have to take on
 * faith. */
export function TrustSection() {
  const ref = useScrollReveal<HTMLDivElement>({ y: 16 });

  return (
    <section className="dark bg-background px-5 py-24 text-foreground sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-14 lg:flex-row lg:items-center lg:justify-between lg:gap-20">
        <div className="flex max-w-sm flex-col gap-3">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            <span className="text-muted-foreground">Built for agencies.</span>
            <br />
            Trusted by construction.
          </h2>
          <p className="text-sm text-muted-foreground">
            No compliance badge to take our word for -- just the real mechanisms behind every score: data
            isolated per agency, every detection confidence-scored, every run retried and idempotent.
          </p>
        </div>

        <div ref={ref} className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:divide-x sm:divide-border">
          {PRINCIPLES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col gap-2 sm:pl-8 sm:first:pl-0">
              <Icon className="size-6 text-foreground" />
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
