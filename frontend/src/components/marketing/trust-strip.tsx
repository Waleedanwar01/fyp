"use client";

import Image from "next/image";

import { AI_ENGINES, LIVE_ENGINE_NAMES } from "@/lib/ai-engines";
import { cn } from "@/lib/utils";

/** A single scrolling row of the AI engines RankLens tracks -- real logos,
 * with "Live" only on engines actually wired up (lib/ai-engines). No
 * customer-logo wall: those would be fake for a product this early
 * (design bible #58 "no fake data"). */
export function TrustStrip() {
  const items = [...AI_ENGINES, ...AI_ENGINES]; // two copies -> seamless -50% loop

  return (
    <section className="overflow-hidden border-y border-border py-7" aria-label="AI engines RankLens tracks">
      <p className="mb-5 px-5 text-center text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {LIVE_ENGINE_NAMES.length > 0
          ? `Tracking ${LIVE_ENGINE_NAMES.join(", ")} today · more AI engines coming`
          : "AI engines RankLens tracks"}
      </p>

      <ul className="sr-only">
        {AI_ENGINES.map((e) => (
          <li key={e.name}>
            {e.name}: {e.live ? "live" : "coming soon"}
          </li>
        ))}
      </ul>

      <div
        className="group flex mask-[linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
        aria-hidden
      >
        <div className="flex w-max animate-marquee items-center gap-12 pr-12 group-hover:paused" style={{ animationDuration: "40s" }}>
          {items.map((engine, i) => (
            <div
              key={`${engine.name}-${i}`}
              className={cn(
                "flex shrink-0 items-center gap-2.5 transition-opacity",
                engine.live ? "opacity-100" : "opacity-60 grayscale hover:opacity-100 hover:grayscale-0"
              )}
            >
              <Image src={engine.logo} alt="" width={24} height={24} className="size-6" unoptimized />
              <span className="text-base font-semibold tracking-tight whitespace-nowrap text-foreground">
                {engine.name}
              </span>
              {engine.live && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
