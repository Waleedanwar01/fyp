"use client";

import Image from "next/image";

import { AI_ENGINES, LIVE_ENGINE_NAMES, type AIEngine } from "@/lib/ai-engines";
import { cn } from "@/lib/utils";

const ENGINES = AI_ENGINES;
const ROWS = 3;

/** Same engines in each row, rotated so neighbouring rows don't line up. */
function row(offset: number) {
  return ENGINES.map((_, i) => ENGINES[(i + offset) % ENGINES.length]);
}

function EngineCard({ engine }: { engine: AIEngine }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 rounded-2xl border bg-card py-3 pr-4 pl-3",
        engine.live ? "border-primary/50 shadow-[0_0_0_4px_rgb(20_184_166/0.08)]" : "border-border"
      )}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-xl",
          engine.live ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted"
        )}
        aria-hidden
      >
        <Image src={engine.logo} alt="" width={22} height={22} className="size-5.5" unoptimized />
      </span>
      <span className="text-sm font-semibold whitespace-nowrap text-foreground">{engine.name}</span>
      {engine.live ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
          Coming soon
        </span>
      )}
    </div>
  );
}

export function ProvidersSection() {
  const live = LIVE_ENGINE_NAMES;

  return (
    <section id="providers" className="overflow-hidden py-28">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 text-center sm:px-8">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">AI engines</p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Every answer engine, one dashboard.
        </h2>
        <p className="max-w-xl text-muted-foreground">
          {live.length > 0
            ? `Live today on ${live.join(", ")}, with more engines on the way. Every prompt runs against the real engine, never a mock.`
            : "More engines are on the way. Every prompt runs against the real engine, never a mock."}
        </p>
      </div>

      {/* Screen readers get one plain list instead of three looping rows. */}
      <ul className="sr-only">
        {ENGINES.map((e) => (
          <li key={e.name}>
            {e.name}: {e.live ? "live" : "coming soon"}
          </li>
        ))}
      </ul>

      <div
        className="relative mt-14 flex flex-col gap-4 mask-[linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
        aria-hidden
      >
        {Array.from({ length: ROWS }, (_, r) => {
          const items = row(r * 3);
          return (
            <div key={r} className="group flex overflow-hidden">
              <div
                className={cn(
                  "flex w-max gap-4 pr-4 group-hover:paused",
                  r % 2 === 0 ? "animate-marquee" : "animate-marquee-reverse"
                )}
                style={{ animationDuration: `${44 + r * 8}s` }}
              >
                {/* Two copies so translating exactly -50% loops seamlessly. */}
                {[...items, ...items].map((engine, i) => (
                  <EngineCard key={`${engine.name}-${i}`} engine={engine} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
