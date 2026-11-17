import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats numbers into clean, human-readable compact notation (e.g. 1.2k, 25k, 1.5M, 10M).
 * - Numbers < 1,000 stay as exact integers.
 * - 1,000 to 999,999 -> "1.2k", "25k", "950k".
 * - 1,000,000+ -> "1.5M", "10.2M".
 * - 1,000,000,000+ -> "1.2B".
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "0";
  const num = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (num < 1000) {
    return `${sign}${Math.round(num)}`;
  }
  if (num < 1000000) {
    const k = num / 1000;
    const formatted = k >= 100
      ? Math.round(k).toString()
      : (Math.round(k * 10) / 10).toFixed((k * 10) % 10 === 0 ? 0 : 1);
    return `${sign}${formatted}k`;
  }
  if (num < 1000000000) {
    const m = num / 1000000;
    const formatted = m >= 100
      ? Math.round(m).toString()
      : (Math.round(m * 10) / 10).toFixed((m * 10) % 10 === 0 ? 0 : 1);
    return `${sign}${formatted}M`;
  }
  const b = num / 1000000000;
  const formatted = b >= 100
    ? Math.round(b).toString()
    : (Math.round(b * 10) / 10).toFixed((b * 10) % 10 === 0 ? 0 : 1);
  return `${sign}${formatted}B`;
}

/**
 * Standard number formatter with thousand separators (e.g. 1,250, 25,000)
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}


/** A post-login `?redirect=` target, only if it's a path on this site.
 * Anything else -- absolute URLs, protocol-relative `//host`, `/\host`,
 * `javascript:` -- falls back, so the param can't be used to bounce a
 * freshly signed-in user to an attacker's page (open redirect). */
export function safeRedirect(target: string | null | undefined, fallback = "/dashboard"): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  return target;
}
