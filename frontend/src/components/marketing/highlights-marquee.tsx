import { Workflow, ShieldCheck, GaugeCircle, Sparkles, CheckCircle2, RefreshCw, Repeat } from "lucide-react";

// Real facts already established elsewhere on this page (How it works,
// Trust, Stats, Providers) -- this is the structural slot a template
// would fill with a customer-logo carousel (Auxia's own reference uses
// real enterprise logos + revenue figures). RankLens doesn't have customers
// like that to show yet, and the one real pilot agency's business data
// doesn't belong on a public page either (design bible #58 "no fake
// data") -- so this reuses RankLens's own verified facts in the same
// sliding-card format instead of inventing logos.
const HIGHLIGHTS = [
  { icon: Workflow, eyebrow: "Pipeline", stat: "5", description: "Steps from a raw prompt to a traceable score" },
  {
    icon: ShieldCheck,
    eyebrow: "Security",
    stat: "2 layers",
    description: "Tenant isolation enforced at the app layer and again at the database layer",
  },
  {
    icon: GaugeCircle,
    eyebrow: "Detection",
    stat: "0-1",
    description: "Confidence score on every mention RankLens detects",
  },
  {
    icon: Sparkles,
    eyebrow: "AI engines",
    stat: "3",
    description: "OpenAI and Gemini live today, Perplexity integration in progress",
  },
  {
    icon: CheckCircle2,
    eyebrow: "Quality",
    stat: "500+",
    description: "Automated tests covering the scoring pipeline end to end",
  },
  {
    icon: RefreshCw,
    eyebrow: "Reliability",
    stat: "Auto-retry",
    description: "Every AI call retries automatically on rate limits and timeouts",
  },
  {
    icon: Repeat,
    eyebrow: "Reliability",
    stat: "Idempotent",
    description: "A retried run never gets double-counted in your score",
  },
];

function HighlightCard({ icon: Icon, eyebrow, stat, description }: (typeof HIGHLIGHTS)[number]) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
      <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5 text-primary" />
        {eyebrow}
      </div>
      <span className="font-mono text-3xl font-semibold tracking-tight">{stat}</span>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** A continuously sliding strip of real engineering facts, right before
 * the footer. The list is duplicated once so the CSS animation
 * (globals.css, `.animate-marquee`) can loop seamlessly by translating
 * exactly -50% -- pauses on hover so a visitor can actually read a card
 * that catches their eye. */
export function HighlightsMarquee() {
  return (
    <section className="overflow-hidden border-y border-border py-10">
      <div className="animate-marquee flex w-max gap-5">
        {[...HIGHLIGHTS, ...HIGHLIGHTS].map((item, i) => (
          <HighlightCard key={`${item.stat}-${i}`} {...item} />
        ))}
      </div>
    </section>
  );
}
