import type { Agency } from "@/lib/auth-context";

/** What a workspace shows as its own brand: the agency's display name,
 * logo and colours from Agency settings (white_label_config), falling
 * back to RankLens's defaults. Colours are re-checked here even though the
 * API validates them, because they're written straight into CSS. */
export type Branding = {
  name: string;
  logo: string;
  primary: string | null;
  accent: string | null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function getBranding(agency: Agency | null | undefined): Branding {
  const config = (agency?.white_label_config ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v : null);
  const companyName = typeof config.company_name === "string" ? config.company_name.trim() : "";
  return {
    name: companyName || agency?.name || "RankLens",
    logo: agency?.logo_url || "",
    primary: pick(config.primary_color),
    accent: pick(config.accent_color),
  };
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixWithWhite(hex: string, amount: number) {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** CSS variables that re-skin the app in the agency's colours. Text on a
 * primary-coloured surface is whichever of white / near-black reads
 * better; in dark mode a very dark brand colour is lifted so it stays
 * visible against the dark background. */
export function brandingCssVars(branding: Branding, theme: "dark" | "light"): Record<string, string> {
  if (!branding.primary) return {};
  let primary = branding.primary;
  if (theme === "dark" && luminance(primary) < 0.12) primary = mixWithWhite(primary, 0.35);
  const onPrimary = luminance(primary) > 0.4 ? "#0b1120" : "#ffffff";
  const accent = branding.accent ?? primary;
  const [r, g, b] = rgb(primary);
  return {
    "--primary": primary,
    "--primary-foreground": onPrimary,
    "--ring": primary,
    "--brand": primary,
    "--brand-2": accent,
    "--chart-1": primary,
    "--chart-2": accent,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": onPrimary,
    "--sidebar-ring": primary,
    "--glow": `${r} ${g} ${b}`,
  };
}
