"use client";

import { ChevronRight } from "lucide-react";

import { useTestimonials, type Testimonial } from "@/components/marketing/testimonials-wall";
import { cn } from "@/lib/utils";

const MAX_AVATARS = 4;

function Avatar({ t, index }: { t: Testimonial; index: number }) {
  const base =
    "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-card transition-transform duration-300 ease-out group-hover:translate-x-[calc(var(--i)*2px)]";
  return t.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- admin-provided URL on any host
    <img src={t.avatar_url} alt="" className={cn(base, "object-cover")} style={{ ["--i" as string]: index }} />
  ) : (
    <span
      className={cn(base, "bg-teal-100 text-[10px] font-semibold text-teal-800")}
      style={{ ["--i" as string]: index }}
    >
      {t.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Hero pill. With published testimonials it becomes a social-proof badge
 * -- real customer avatars and the real count -- that slides down to the
 * testimonial wall (#testimonials; Lenis smooth-scrolls hash links). With
 * none yet (or while loading) it stays the product-category pill, so it
 * never links to a section that isn't on the page or shows a made-up number. */
export function TestimonialBadge() {
  const items = useTestimonials();

  if (!items || items.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-xs">
        <span className="flex size-2 rounded-full bg-primary" />
        <span>Generative Engine Optimization (GEO) Platform for Agencies</span>
      </div>
    );
  }

  const shown = items.slice(0, MAX_AVATARS);
  const count = items.length;

  return (
    <a
      href="#testimonials"
      className="group inline-flex items-center gap-2.5 rounded-full border border-border bg-card py-1 pr-3 pl-1 text-xs text-muted-foreground shadow-xs transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:outline-none"
    >
      <span className="flex -space-x-2" aria-hidden>
        {shown.map((t, i) => (
          <Avatar key={t.id} t={t} index={i} />
        ))}
      </span>
      <span>
        See what <strong className="font-semibold text-foreground">{count.toLocaleString()}</strong>{" "}
        {count === 1 ? "customer says" : "customers say"}
      </span>
      <ChevronRight className="size-3.5 transition-transform group-hover:translate-y-0.5 group-hover:rotate-90" aria-hidden />
    </a>
  );
}
