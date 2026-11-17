/** AIProvider values/labels (core.models.AIProvider on the backend) and
 * the shared "aggregate real prompt_runs into a per-provider breakdown"
 * logic -- used by both the dashboard's agency-wide 3D hero and a
 * client's own detail page, scoped to different sets of prompt_runs but
 * otherwise identical. */
export const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  perplexity: "Perplexity",
};

export const ACTIVE_PROVIDER_IDS = ["gemini"];

export const PROVIDER_STATUS: Record<string, { label: string; enabled: boolean; hint?: string }> = {
  gemini: { label: "Gemini", enabled: true },
  openai: { label: "OpenAI", enabled: false, hint: "API key not configured" },
  perplexity: { label: "Perplexity", enabled: false, hint: "API key not configured" },
};

// Fixed, known set so every provider shows up even with zero runs (dim,
// "No data yet") -- deriving the list purely from whatever providers
// happen to appear in prompt_runs would make a never-configured
// provider silently absent instead of visibly unused.
export const KNOWN_PROVIDER_IDS = Object.keys(PROVIDER_LABELS);

export type ProviderActivity = { id: string; label: string; score: number | null; runs: number };

export function aggregateProviderActivity(
  promptRunGroups: { provider: string; mentioned: boolean }[][]
): ProviderActivity[] {
  const byProvider = new Map<string, { total: number; mentioned: number }>();
  for (const runs of promptRunGroups) {
    for (const run of runs) {
      const bucket = byProvider.get(run.provider) ?? { total: 0, mentioned: 0 };
      bucket.total += 1;
      if (run.mentioned) bucket.mentioned += 1;
      byProvider.set(run.provider, bucket);
    }
  }

  return KNOWN_PROVIDER_IDS.map((id) => {
    const bucket = byProvider.get(id);
    return {
      id,
      label: PROVIDER_LABELS[id],
      score: bucket && bucket.total > 0 ? bucket.mentioned / bucket.total : null,
      runs: bucket?.total ?? 0,
    };
  });
}

