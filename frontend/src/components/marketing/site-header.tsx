"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/8bit-button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { AvtrMark } from "@/components/brand/avtr-logo";

const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/demo", label: "Live Demo" },
  { href: "/pricing", label: "Pricing" },
];

const ANNOUNCEMENT = "RankLens's traceable Visibility Score is live";
const MENU_ID = "mobile-site-menu";
// iOS-style ease: quick start, long soft settle.
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

/** Three bars that morph into an X -- the toggle's only icon. */
function MenuIcon({ open }: { open: boolean }) {
  const bar = "absolute left-0 h-[1.5px] w-full rounded-full bg-current transition-all duration-300 " + EASE;
  return (
    <span className="relative block h-3.5 w-4.5" aria-hidden>
      <span className={cn(bar, open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0")} />
      <span className={cn(bar, "top-1/2 -translate-y-1/2", open ? "scale-x-0 opacity-0" : "opacity-100")} />
      <span className={cn(bar, open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0")} />
    </span>
  );
}

export function SiteHeader() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  // Close on navigation -- adjusting state during render for a route change.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  // Lock page scroll behind the open menu. Only on <html>: also hiding
  // <body>'s overflow turns <body> into the sticky header's scroll
  // container, so after scrolling down the header (and this menu) jumped
  // back to the top of the page, off screen -- only the backdrop showed.
  useEffect(() => {
    if (!mobileOpen) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Esc closes and hands focus back to the toggle; opening focuses the first link;
  // growing to desktop width closes it so it can't linger off-screen.
  useEffect(() => {
    if (!mobileOpen) return;
    const frame = requestAnimationFrame(() => firstLinkRef.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        toggleRef.current?.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => desktop.matches && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [mobileOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="sticky top-0 z-40">
      {/* Tap-anywhere-to-close backdrop, below the header within this layer. */}
      <div
        className={cn(
          "fixed inset-0 bg-[#0b1120]/40 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          EASE,
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />

      <div className="relative">
        {announcementOpen && (
          <div className="relative flex items-center justify-center bg-foreground px-10 py-2 text-center text-xs font-medium text-background sm:text-sm">
            <Link href="/#how-it-works" className="hover:underline">
              {ANNOUNCEMENT} &rarr;
            </Link>
            <button
              type="button"
              onClick={() => setAnnouncementOpen(false)}
              className="absolute right-3 flex size-8 items-center justify-center rounded-md opacity-80 transition-opacity hover:opacity-100"
              aria-label="Dismiss announcement"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <header className={cn("border-b border-border/70", mobileOpen ? "bg-background" : "glass")}>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
            <Link href="/" className="flex items-center gap-2.5">
              <AvtrMark className="size-7.5" />
              <span className="text-base font-semibold tracking-tight text-foreground">RankLens</span>
            </Link>

            <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "text-sm font-medium transition-colors hover:text-foreground",
                    isActive(link.href) ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="hidden items-center gap-3 md:flex">
              {!loading &&
                (user ? (
                  <Button render={<Link href="/dashboard" />} nativeButton={false} size="sm" className="h-9 px-4">
                    Dashboard
                  </Button>
                ) : (
                  <>
                    <Link href="/login" className="text-sm font-medium text-foreground hover:underline">
                      Log in
                    </Link>
                    <span className="h-4 w-px bg-border" aria-hidden />
                    <Button
                      render={<Link href="/checkout?plan=growth&interval=monthly" />}
                      nativeButton={false}
                      size="sm"
                      className="h-9 px-4"
                    >
                      Get Started
                    </Button>
                  </>
                ))}
            </div>

            <button
              ref={toggleRef}
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
              aria-controls={MENU_ID}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl border text-foreground transition-colors duration-200 active:scale-95 md:hidden",
                mobileOpen ? "border-foreground/15 bg-muted" : "border-border/70 bg-card hover:bg-muted"
              )}
            >
              <MenuIcon open={mobileOpen} />
            </button>
          </div>
        </header>

        {/* Mobile menu -- hangs off the bottom of the header, so it always
            starts exactly below it whatever the announcement bar's height. */}
        <div
          id={MENU_ID}
          className={cn(
            "absolute inset-x-0 top-full grid transition-[grid-template-rows,opacity] duration-400 md:hidden",
            EASE,
            mobileOpen ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
          )}
          inert={!mobileOpen}
        >
          <div className="overflow-hidden">
            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-b-3xl border-b border-border bg-background px-5 pt-3 pb-6 shadow-2xl">
              <nav className="flex flex-col" aria-label="Mobile">
                {NAV_LINKS.map((link, i) => (
                  <Link
                    key={link.href}
                    ref={i === 0 ? firstLinkRef : undefined}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    style={{ transitionDelay: mobileOpen ? `${80 + i * 45}ms` : "0ms" }}
                    className={cn(
                      "group flex items-center justify-between border-b border-border/60 py-4 text-lg font-medium transition-all duration-300 outline-none last:border-0 focus-visible:text-primary",
                      EASE,
                      mobileOpen ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
                      isActive(link.href) ? "text-primary" : "text-foreground"
                    )}
                  >
                    {link.label}
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                ))}
              </nav>

              <div
                style={{ transitionDelay: mobileOpen ? `${80 + NAV_LINKS.length * 45}ms` : "0ms" }}
                className={cn(
                  "mt-5 flex flex-col gap-5 px-1.5 transition-all duration-300",
                  EASE,
                  mobileOpen ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
                )}
              >
                {user ? (
                  <Button render={<Link href="/dashboard" />} nativeButton={false} className="h-12 w-full">
                    Go to Dashboard
                  </Button>
                ) : (
                  <>
                    <Button
                      render={<Link href="/checkout?plan=growth&interval=monthly" />}
                      nativeButton={false}
                      className="h-12 w-full"
                    >
                      Get Started
                    </Button>
                    <Button render={<Link href="/login" />} nativeButton={false} variant="outline" className="h-12 w-full">
                      Log in
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
