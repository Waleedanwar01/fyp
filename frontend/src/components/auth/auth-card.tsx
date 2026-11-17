"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AvtrMark } from "@/components/brand/avtr-logo";

// Three.js/WebGL never runs server-side, and the chunk is heavy enough
// that it shouldn't block the form's first paint (design bible #45).
const AuthBackdrop = dynamic(
  () => import("@/components/auth/auth-backdrop").then((m) => m.AuthBackdrop),
  { ssr: false }
);

const PROVIDERS = ["OpenAI", "Gemini", "Perplexity"];

/** Split-screen auth shell shared by every auth page (login, register,
 * forgot/reset password, verify email, accept invite, subscribe) -- a
 * real RankLens 3D brand panel on one side, a clean form on the other. No
 * "Continue with Google/Microsoft" buttons: RankLens doesn't have OAuth
 * login wired up, so a button for it would be a feature that doesn't
 * exist (design bible #58 "no fake data" applies to UI affordances,
 * not just numbers). The graphic panel hides below lg -- on a phone
 * screen it would just push the actual form off-screen. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="dark relative hidden w-1/2 overflow-hidden bg-background text-foreground lg:block">
        <div className="pointer-events-none absolute inset-0">
          <AuthBackdrop />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex w-fit items-center gap-2">
            <AvtrMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">RankLens</span>
          </Link>

          <div className="flex flex-col gap-4">
            <h2 className="max-w-sm text-3xl font-semibold tracking-tight text-balance">
              AI sees your brand. Now you can trace it.
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Track how your clients are discovered, mentioned and ranked across real AI engines, with a
              traceable score behind every number.
            </p>
            <div className="flex items-center gap-2">
              {PROVIDERS.map((name) => (
                <span
                  key={name}
                  className="rounded-full px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase ring-1 ring-foreground/15"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex w-fit items-center gap-2 lg:hidden">
            <AvtrMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">RankLens</span>
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}

          <div className="mt-6">{children}</div>

          {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
