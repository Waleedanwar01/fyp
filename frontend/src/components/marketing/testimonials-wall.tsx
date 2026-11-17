"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Testimonial = {
  id: string;
  name: string;
  role: string;
  company: string;
  quote: string;
  country_code: string;
  avatar_url: string;
};

const COLUMNS = 4;
// Each column needs enough cards to overflow the viewport so the loop
// never shows a gap; short lists are cycled (same real quotes, repeated).
const MIN_PER_COLUMN = 5;

// Design-preview content ONLY (see isTestimonialsPreview): fictional people
// and agencies with placeholder portraits from randomuser.me, for showing
// the layout in a local demo. Never stored, never in a production build --
// real quotes are added in Django admin (core.Testimonial).
const P = (g: "men" | "women", n: number) => `https://randomuser.me/api/portraits/${g}/${n}.jpg`;
const PREVIEW_SAMPLES: Testimonial[] = [
  { name: "Sarah Mitchell", role: "Head of SEO", company: "Brightlane Digital", country_code: "GB", avatar_url: P("women", 44),
    quote: "We finally have a number to show clients for AI search. The citation evidence makes every report easy to defend." },
  { name: "Omar Haddad", role: "Founder", company: "Northpeak Agency", country_code: "AE", avatar_url: P("men", 32),
    quote: "Seeing exactly where Gemini ranks a client next to competitors changed how we pitch GEO retainers." },
  { name: "Emily Carter", role: "Client Services Lead", company: "Harbor & Co.", country_code: "US", avatar_url: P("women", 68),
    quote: "The white-label PDF goes straight to our clients every month. Zero formatting work on our side." },
  { name: "Daniel Okafor", role: "Growth Strategist", company: "Lumen Media", country_code: "GB", avatar_url: P("men", 75),
    quote: "Scheduled runs mean we spot a drop in AI mentions the same week it happens, not at quarter end." },
  { name: "Ayesha Raza", role: "Digital Director", company: "Crescent Labs", country_code: "PK", avatar_url: P("women", 21),
    quote: "Our team tracks 30+ brands from one dashboard. Onboarding a new client takes minutes." },
  { name: "Lukas Weber", role: "SEO Manager", company: "Stadtwerk Digital", country_code: "DE", avatar_url: P("men", 46),
    quote: "Sentiment per mention is the detail clients ask about most -- now we can actually show it." },
  { name: "Hannah Brooks", role: "Account Director", company: "Fieldnote Studio", country_code: "AU", avatar_url: P("women", 90),
    quote: "Competitor comparison made our last renewal conversation very short. In a good way." },
  { name: "Marcus Lee", role: "Co-founder", company: "Signal Room", country_code: "CA", avatar_url: P("men", 11),
    quote: "Every score links back to the actual AI answer. That traceability is why clients trust it." },
  { name: "Fatima Noor", role: "Content Lead", company: "Oasis Creative", country_code: "AE", avatar_url: P("women", 57),
    quote: "We use the prompt insights to decide what content to write next. It's become part of our planning." },
  { name: "Tom Fischer", role: "Technical SEO", company: "Bergmann & Partner", country_code: "DE", avatar_url: P("men", 52),
    quote: "Clean data, clear evidence, no black box. Exactly what an agency needs to sell AI visibility work." },
  { name: "Priya Sharma", role: "Marketing Manager", company: "Kite Collective", country_code: "US", avatar_url: P("women", 33),
    quote: "Setup was quick and the dashboard is easy enough that account managers use it without training." },
  { name: "James O'Connor", role: "Agency Owner", company: "Greenline Digital", country_code: "IE", avatar_url: P("men", 64),
    quote: "RankLens gave us a new service line. Clients understand the visibility score immediately." },
].map((t, i) => ({ id: `preview-${i}`, ...t }));

/** Local design preview: on by default under `next dev` (so a local demo
 * shows a full wall), off with ?testimonials=live to see real data. Never
 * active in a production build -- the live site only shows published,
 * real quotes from Django admin. */
export function isTestimonialsPreview() {
  return (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("testimonials") !== "live"
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  const subtitle = [t.role, t.company].filter(Boolean).join(" · ");
  return (
    <figure className="w-64 shrink-0 rounded-xl border border-white/10 bg-[#111827] p-4 shadow-lg shadow-black/30">
      <figcaption className="flex items-center gap-3">
        {t.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-provided URL on any host
          <img src={t.avatar_url} alt="" className="size-9 shrink-0 rounded-full object-cover" loading="lazy" />
        ) : (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-sm font-semibold text-teal-300"
            aria-hidden
          >
            {t.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{t.name}</p>
          {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
        </div>
        {t.country_code && (
          <span className="shrink-0 text-[10px] font-medium tracking-wider text-slate-500 uppercase">
            {t.country_code}
          </span>
        )}
      </figcaption>
      <blockquote className="mt-3 text-sm leading-relaxed text-slate-300">&ldquo;{t.quote}&rdquo;</blockquote>
    </figure>
  );
}

function buildColumns(items: Testimonial[]) {
  return Array.from({ length: COLUMNS }, (_, col) => {
    const out: Testimonial[] = [];
    const count = Math.max(MIN_PER_COLUMN, Math.ceil(items.length / COLUMNS));
    for (let i = 0; i < count; i++) out.push(items[(col * 2 + i) % items.length]);
    return out;
  });
}

/** Homepage social proof: real quotes managed by staff in Django admin
 * (core.Testimonial, published only -- GET /testimonials/), laid out as
 * a tilted 3D wall of vertically scrolling columns. Renders nothing at
 * all until at least one quote is published, so the site never shows
 * placeholder people. Hovering pauses the motion; reduced-motion users
 * get a still wall (global rule in globals.css). */
// One request per page load, shared by the hero badge and the wall.
let testimonialsRequest: Promise<Testimonial[]> | null = null;

function loadTestimonials(): Promise<Testimonial[]> {
  // Local layout preview only (`next dev` + ?testimonials=preview):
  // clearly-labelled sample cards, never real-looking people, and the
  // branch is compiled out of production builds entirely.
  if (isTestimonialsPreview()) return Promise.resolve(PREVIEW_SAMPLES);
  testimonialsRequest ??= api
    .get<Testimonial[]>("/testimonials/")
    .then(({ data }) => (Array.isArray(data) ? data : []))
    .catch(() => {
      testimonialsRequest = null; // let a later mount retry
      return [];
    });
  return testimonialsRequest;
}

/** Published testimonials (GET /testimonials/), or null while loading. */
export function useTestimonials() {
  const [items, setItems] = useState<Testimonial[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTestimonials().then((data) => !cancelled && setItems(data));
    return () => {
      cancelled = true;
    };
  }, []);
  return items;
}

export function TestimonialsWall() {
  const items = useTestimonials();

  if (!items || items.length === 0) return null;

  const columns = buildColumns(items);

  return (
    <section
      id="testimonials"
      className="dark relative scroll-mt-28 overflow-hidden bg-[#0b1120] py-24 text-white"
      aria-labelledby="testimonials-heading"
    >
      <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-3 px-5 text-center">
        <p className="text-xs font-medium tracking-wider text-teal-300 uppercase">Customers</p>
        {isTestimonialsPreview() && (
          <p className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-medium text-amber-200">
            Preview · sample content
          </p>
        )}
        <h2 id="testimonials-heading" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Agencies that track AI visibility with RankLens
        </h2>
      </div>

      {/* Accessible, non-animated copy of every quote for screen readers. */}
      <ul className="sr-only">
        {items.map((t) => (
          <li key={t.id}>
            {t.quote} — {t.name}
            {t.company ? `, ${t.company}` : ""}
          </li>
        ))}
      </ul>

      <div className="relative mt-12 h-[560px] overflow-hidden [perspective:1000px]" aria-hidden>
        <div className="testimonials-plane absolute inset-0 flex justify-center gap-5">
          {columns.map((col, i) => (
            <div key={i} className="group h-full shrink-0 overflow-hidden">
              <div
                className={cn(
                  "flex flex-col gap-5 group-hover:[animation-play-state:paused]",
                  i % 2 === 0 ? "animate-marquee-up" : "animate-marquee-down"
                )}
                style={{ animationDuration: `${38 + i * 6}s` }}
              >
                {/* Two copies so translating exactly -50% loops seamlessly. */}
                {[...col, ...col].map((t, j) => (
                  <TestimonialCard key={`${t.id}-${j}`} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Edge fades into the section background. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0b1120] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0b1120] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0b1120] to-transparent sm:w-48" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0b1120] to-transparent sm:w-48" />
      </div>
    </section>
  );
}
