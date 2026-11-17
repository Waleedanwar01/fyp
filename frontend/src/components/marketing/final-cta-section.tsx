"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/8bit-button";
import { useScrollReveal } from "@/lib/animations";
import { useAuth } from "@/lib/auth-context";

/** The page's one bold accent card -- everywhere else is the cream/card
 * palette, so a solid primary-blue band here reads as "the last thing
 * we want you to notice" instead of blending into another white rounded
 * box like the rest of the page. */
export function FinalCtaSection() {
  const { user } = useAuth();
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <section className="px-5 py-28 sm:px-8">
      <div
        ref={ref}
        className="dark relative mx-auto flex max-w-4xl flex-col items-center gap-6 overflow-hidden rounded-2xl bg-[#0b1120] px-6 py-20 text-center text-white"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, white, transparent 42%), radial-gradient(circle at 85% 85%, white, transparent 42%)",
          }}
        />
        <span className="relative rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide uppercase">
          Get started in minutes
        </span>
        <h2 className="relative text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          See how AI sees you.
        </h2>
        <p className="relative max-w-lg text-slate-300">
          Start tracking real AI visibility for your clients, with a traceable score behind every number.
        </p>
        <Button
          render={<Link href={user ? "/dashboard" : "/checkout?plan=growth&interval=monthly"} />}
          nativeButton={false}
          size="lg"
          className="h-12 px-6"
        >
          {user ? "Go to Dashboard" : "Start with RankLens"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </section>
  );
}
