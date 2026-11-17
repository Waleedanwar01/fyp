/** Categorical series colours shared by dashboard charts. The first slot is
 * always the theme primary, so the tracked brand takes the agency's own
 * colour in a white-labelled workspace; the rest are mid-tone hues chosen
 * to stay distinct from each other and readable on light and dark cards. */
export const SERIES_COLORS = [
  "var(--primary)",
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ec4899", // pink
  "#64748b", // slate
  "#22c55e", // green
  "#f97316", // orange
] as const;

export function seriesColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/** Recharts tooltip box that follows the app's card styling. */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
} as const;
