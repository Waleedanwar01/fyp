"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  UserCircle,
  CreditCard,
  Zap,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Search,
  Moon,
  Sun,
  ChevronRight,
  Globe,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AvtrMark } from "@/components/brand/avtr-logo";
import { Button } from "@/components/ui/button";
import { CommandPalette, type CommandItem } from "@/components/dashboard/command-palette";
import { GlobalNotificationToast } from "@/components/notifications/global-notification-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isLapsedStatus, isUsableStatus, type SubscriptionSummary } from "@/lib/subscription";
import { RenewRequiredDialog, SubscriptionLockBanner } from "@/components/billing/subscription-lock";
import { cn } from "@/lib/utils";
import { brandingCssVars, getBranding, type Branding } from "@/lib/white-label";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/", label: "Home page", icon: Globe },
    ],
  },
  { label: "Workspace", items: [{ href: "/clients", label: "Clients", icon: Building2 }] },
  {
    label: "System",
    items: [
      { href: "/billing", label: "Billing & Credits", icon: CreditCard },
      { href: "/team", label: "Team", icon: Users },
      { href: "/agency-settings", label: "Agency", icon: Settings },
      { href: "/account", label: "Account", icon: UserCircle },
    ],
  },
];

const COMMAND_ITEMS: CommandItem[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, group: g.label }))
);

const SIDEBAR_COLLAPSED_KEY = "avtr:sidebar-collapsed";
const THEME_KEY = "avtr:theme";

// useLayoutEffect warns during SSR; fall back to useEffect there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The app is dark by default (Midnight Teal); light mode is opt-in and
 * remembered. The class goes on <html> (not a wrapper div) so portaled
 * dialogs and menus pick up the same theme, and is removed on unmount
 * so the public marketing pages keep their light theme. */
function useAppTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    return () => {
      root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  }, [theme]);

  const toggle = () =>
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage unavailable -- theme still applies for this session */
      }
      return next;
    });

  return { theme, toggle };
}

/** Applies the agency's white-label branding while inside the app: brand
 * colours as CSS variables on <html> (so portaled dialogs match), the
 * agency logo as the tab icon, and its name in page titles. Everything is
 * restored on unmount so the public RankLens site keeps its own branding. */
function useAgencyBranding(branding: Branding, theme: "dark" | "light") {
  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    const vars = brandingCssVars(branding, theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [branding.primary, branding.accent, theme]);

  useEffect(() => {
    if (!branding.logo) return;
    const links = [...document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")];
    const original = links.map((l) => [l, l.href, l.type] as const);
    for (const l of links) {
      l.href = branding.logo;
      l.removeAttribute("type");
    }
    return () => {
      for (const [l, href, type] of original) {
        l.href = href;
        if (type) l.type = type;
      }
    };
  }, [branding.logo]);

  useEffect(() => {
    if (branding.name === "RankLens") return;
    const retitle = () => {
      if (document.title.endsWith("| RankLens")) document.title = document.title.replace(/\| RankLens$/, `| ${branding.name}`);
    };
    retitle();
    const titleEl = document.querySelector("title");
    const observer = new MutationObserver(retitle);
    if (titleEl) observer.observe(titleEl, { childList: true });
    return () => observer.disconnect();
  }, [branding.name]);
}

/** Every AppShell page is the paid product. A never-paid agency lands on
 * /subscribe; a lapsed one (expired, cancelled, past due) gets in
 * read-only -- banner on every page, and any write the API refuses (402)
 * opens the "Renew to continue" dialog -- until it renews. */
function useSubscriptionGate(enabled: boolean) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [usable, setUsable] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const fetchSubscription = () => {
      api
        .get<SubscriptionSummary>("/subscription/")
        .then(({ data }) => {
          setSubscription(data);
          setUsable(isUsableStatus(data.status));
        })
        .catch(() => {
          setSubscription(null);
          setUsable(false);
        })
        .finally(() => setChecked(true));
    };

    fetchSubscription();

    const handleUpdate = () => {
      fetchSubscription();
    };

    window.addEventListener("avtr:subscription-updated", handleUpdate);
    // Light refresh only while the tab is visible -- a hidden tab polling
    // every few seconds kept the (serverless) database awake around the clock.
    const onVisible = () => document.visibilityState === "visible" && fetchSubscription();
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchSubscription();
    }, 5 * 60_000);

    return () => {
      window.removeEventListener("avtr:subscription-updated", handleUpdate);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [enabled]);

  // Lapsed (paid before, now expired/cancelled/past due): open read-only.
  // Never paid (pending / no subscription): straight to /subscribe.
  const lapsed = !!subscription && isLapsedStatus(subscription.status);
  useEffect(() => {
    if (enabled && checked && !usable && !lapsed) {
      router.replace("/subscribe");
    }
  }, [enabled, checked, usable, lapsed, router]);

  return { isReady: checked && (usable || lapsed), readOnly: lapsed, subscription };
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group/nav relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      )}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground"
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** The agency's own logo in the sidebar. Wide wordmarks (most agency
 * logos) keep their shape up to the sidebar width; square marks render as
 * a tile. Reports its shape so the sidebar can drop the duplicate name. */
function AgencyLogo({
  src,
  name,
  compact,
  onShape,
}: {
  src: string;
  name: string;
  compact: boolean;
  onShape: (wide: boolean) => void;
}) {
  const [wide, setWide] = useState(false);
  const showWide = wide && !compact;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- agency-provided logo (data URL or external https)
    <img
      src={src}
      alt={`${name} logo`}
      onLoad={(e) => {
        const isWide = e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight) > 1.6;
        setWide(isWide);
        onShape(isWide);
      }}
      className={cn(
        "shrink-0 object-contain",
        // Most agency logos are drawn for white backgrounds, so in dark mode
        // they sit on a light plate instead of vanishing into the sidebar.
        showWide
          ? "h-9 w-auto max-w-[176px] object-left dark:h-10 dark:rounded-lg dark:bg-white dark:px-2 dark:py-1"
          : "size-9 rounded-xl border border-border/60 bg-white p-0.5 shadow-xs"
      )}
    />
  );
}

export function BrandMark({ className }: { className?: string }) {
  return <AvtrMark className={cn("size-9", className)} />;
}

/** Top-level links match exactly; section links also match their sub-pages. */
function isActive(href: string, pathname: string) {
  return href === "/dashboard" || href === "/" ? pathname === href : pathname.startsWith(href);
}

function pageTitle(pathname: string) {
  for (const g of NAV_GROUPS) {
    for (const i of g.items) {
      if (isActive(i.href, pathname)) {
        return { group: g.label, label: i.label };
      }
    }
  }
  if (pathname.startsWith("/runs")) return { group: "Workspace", label: "Run Detail" };
  return { group: "RankLens", label: "Workspace" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { isReady: subscribed, readOnly, subscription } = useSubscriptionGate(!loading && !!user);
  const { theme, toggle: toggleTheme } = useAppTheme();
  const branding = getBranding(user?.agency);
  useAgencyBranding(branding, theme);
  // Wide wordmark logos replace the text name; square marks sit beside it.
  const [wideLogo, setWideLogo] = useState(false);
  // Lazy initializer (not an effect) -- reads localStorage once, on first
  // client render, so there's no flash of expanded-then-collapsed. Guarded
  // for SSR, where `window` doesn't exist yet.
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === "undefined" ? false : window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Closes the mobile off-canvas sidebar on navigation -- adjusting state
  // during render (not in an effect) for a prop/route change, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading || !user || !subscribed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-aurora">
        <BrandMark className="animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </div>
    );
  }

  const initial = user.email.charAt(0).toUpperCase();
  const current = pageTitle(pathname);
  const period = subscription?.current_billing_period;
  const usedPct = period
    ? Math.min(100, Math.round((period.prompt_runs_used / Math.max(1, period.total_available)) * 100))
    : 0;

  const renderSidebarContent = (isMobile = false) => {
    const isCollapsed = !isMobile && collapsed;
    return (
      <div className="flex h-full flex-col">
        <div className={cn("flex items-center justify-between px-4 pt-5 pb-4", isCollapsed && "justify-center px-0")}>
          <div className="flex min-w-0 items-center gap-3">
            {branding.logo ? (
              <AgencyLogo src={branding.logo} name={branding.name} compact={isCollapsed} onShape={setWideLogo} />
            ) : (
              <BrandMark />
            )}
            {!isCollapsed && !(branding.logo && wideLogo) && (
              <div className="flex min-w-0 flex-col">
                <span className="max-w-[150px] truncate text-sm leading-none font-semibold tracking-tight text-foreground">
                  {branding.name}
                </span>
                <span className="mt-1 truncate text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  AI Visibility
                </span>
              </div>
            )}
          </div>
          {isMobile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="size-9 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        {!isCollapsed && (
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-full items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/50 px-3 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Quick jump…</span>
              <kbd className="rounded border border-border bg-background/60 px-1 font-mono text-[10px]">Ctrl K</kbd>
            </button>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3" aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              {!isCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 uppercase">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={isCollapsed}
                  active={isActive(item.href, pathname)}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          ))}
        </nav>

        {period && (
          <div className="p-3">
            {!isCollapsed ? (
              <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <span className="flex size-6 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Zap className="size-3.5 fill-current" />
                    </span>
                    Runs left
                  </span>
                  <Link
                    href="/billing"
                    onClick={() => setMobileOpen(false)}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    Manage
                  </Link>
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="font-mono text-xl font-bold tracking-tight text-foreground tabular-nums">
                    {period.prompt_runs_remaining.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">/ {period.total_available.toLocaleString()}</span>
                </div>
                <div
                  className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
                  role="progressbar"
                  aria-label="Prompt runs used"
                  aria-valuenow={usedPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">{usedPct}% of this period used</p>
              </div>
            ) : (
              <Link
                href="/billing"
                title={`Prompt runs: ${period.prompt_runs_remaining.toLocaleString()} left`}
                aria-label="Billing & credits"
                className="mx-auto flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary transition-colors hover:bg-primary/20"
              >
                <Zap className="size-4 fill-current" />
              </Link>
            )}
          </div>
        )}

        <div className="border-t border-sidebar-border p-3">
          <div className={cn("flex items-center gap-2.5 rounded-xl p-1.5", isCollapsed && "flex-col justify-center")}>
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary"
              title={isCollapsed ? user.email : undefined}
            >
              <span className="text-xs font-semibold text-foreground">{initial}</span>
            </span>
            {!isCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{user.email}</p>
                <p className="truncate text-[11px] text-muted-foreground">{branding.name}</p>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              title="Log out"
              aria-label="Log out"
              className="size-8 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>

        {!isMobile && (
          <div className="hidden border-t border-sidebar-border p-2.5 md:block">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggleCollapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("text-muted-foreground hover:text-foreground", collapsed ? "mx-auto flex" : "")}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </div>
        )}
      </div>
    );
  };

  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <div className="relative flex min-h-screen bg-aurora">

      {/* Desktop sidebar -- persistent, collapsible to an icon rail. */}
      <aside
        className={cn(
          "glass sticky top-0 z-20 hidden h-screen shrink-0 border-r border-sidebar-border transition-[width] duration-300 ease-out md:block",
          collapsed ? "w-[72px]" : "w-64"
        )}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile off-canvas backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out md:hidden",
          mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile off-canvas drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl transition-transform duration-300 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Mobile Navigation"
      >
        {renderSidebarContent(true)}
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top command bar */}
        <header className="glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              className="size-10 rounded-xl md:hidden"
            >
              <Menu className="size-4.5" />
            </Button>
            <BrandMark className="size-8 md:hidden" />
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
              <span className="text-muted-foreground">{current.group}</span>
              <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
              <span className="truncate font-semibold text-foreground">{current.label}</span>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-10 w-64 items-center gap-2 rounded-xl border border-border/70 bg-background/40 px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-primary/40 hover:text-foreground lg:flex"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search pages…</span>
              <kbd className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
            </button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search pages"
              className="size-10 rounded-xl lg:hidden"
            >
              <Search className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
              className="size-10 rounded-xl"
            >
              <ThemeIcon className="size-4" />
            </Button>
            {user.agency && (
              <span className="hidden max-w-[200px] items-center gap-2 truncate rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground xl:inline-flex">
                <Building2 className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{branding.name}</span>
              </span>
            )}
          </div>
        </header>

        <main key={pathname} className="relative flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1600px]">
            {readOnly && subscription && <SubscriptionLockBanner subscription={subscription} />}
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={COMMAND_ITEMS} />
      <RenewRequiredDialog />

      {/* Global Real-time Sliding Notification Toast */}
      <GlobalNotificationToast />
    </div>
  );
}
