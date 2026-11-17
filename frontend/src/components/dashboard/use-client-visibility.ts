"use client";

import { useEffect, useState } from "react";

import { api, extractErrorMessage } from "@/lib/api";

export type ClientRecord = {
  id: string;
  name: string;
  industry?: string;
  created_at?: string;
};
export type BrandRecord = {
  id: string;
  client: string;
  name: string;
  created_at?: string;
};

// Shape of GET /brands/{id}/visibility-score/ (core.visibility_score.
// visibility_score_evidence on the backend, Month 2) -- visibility_score
// and components are null when there's no scoreable data yet rather than
// a differently-shaped response, so that's the one case every caller has
// to render explicitly instead of assuming a number. `prompt_runs` is the
// full evidence trail (every run considered, each with its own provider
// and whether it was mentioned) -- kept here, not just the summary
// numbers, so a provider-level breakdown can be derived from real data
// without a second round of API calls.
export type MentionCitation = {
  id: string;
  url: string;
  domain: string;
  title: string;
};

export type MentionEvidence = {
  id: string;
  term: string;
  is_primary: boolean;
  start_index: number;
  end_index: number;
  mention_order: number;
  list_rank: number | null;
  position_score: number;
  sentiment: "positive" | "neutral" | "negative" | "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  sentiment_source: string;
  sentiment_score: number;
  confidence_score: number;
  needs_review: boolean;
  citations: MentionCitation[];
};

export type PromptRunEvidence = {
  id: string;
  prompt_text: string;
  provider: string;
  executed_at: string;
  response_text: string;
  mentioned: boolean;
  mentions: MentionEvidence[];
};

export type VisibilityScoreEvidence = {
  entity_type?: "brand" | "competitor";
  entity_id?: string;
  entity_name: string;
  period?: { since: string | null; until: string | null };
  visibility_score: number | null;
  components: {
    mention_rate: number;
    position_score: number;
    sentiment_score: number;
    citation_score: number;
  } | null;
  total_runs: number;
  runs_with_mention: number;
  mention_count: number;
  duplicate_runs_excluded?: number;
  prompt_runs: PromptRunEvidence[];
};

export type ClientScore = {
  client: ClientRecord;
  brandId: string | null;
  score: VisibilityScoreEvidence | null;
};

export type DateRangeFilter = {
  since: string | null;
  until: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The reporting-period presets (7D / 30D / 90D): `days` back from today. */
export const PERIOD_PRESET_DAYS = [7, 30, 90] as const;

export function presetRange(days: number): DateRangeFilter {
  const now = new Date();
  return {
    since: isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)),
    until: isoDay(now),
  };
}

const periodKey = (since: string | null, until: string | null) => `${since ?? "all"}_${until ?? "all"}`;

// Client and brand lists don't depend on the period, so a period switch
// reuses them and only fetches the scores (one parallel round of requests
// instead of two). Kept briefly so newly added clients still show up.
const LISTS_TTL_MS = 15_000;
let lists: { at: number; promise: Promise<{ clients: ClientRecord[]; brands: BrandRecord[] }> } | null = null;

function loadLists() {
  if (lists && Date.now() - lists.at < LISTS_TTL_MS) return lists.promise;
  const promise = Promise.all([api.get<ClientRecord[]>("/clients/"), api.get<BrandRecord[]>("/brands/")]).then(
    ([c, b]) => ({ clients: c.data, brands: b.data })
  );
  lists = { at: Date.now(), promise };
  promise.catch(() => {
    lists = null;
  });
  return promise;
}

// Scores per period. A cached period renders instantly and refreshes in
// the background once it's older than SCORES_TTL_MS.
const SCORES_TTL_MS = 60_000;
const scoreCache = new Map<string, { at: number; entries: ClientScore[] }>();
const inflight = new Map<string, Promise<ClientScore[]>>();

function loadScores(since: string | null, until: string | null): Promise<ClientScore[]> {
  const key = periodKey(since, until);
  const running = inflight.get(key);
  if (running) return running;

  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const qs = params.toString() ? `?${params}` : "";

  const promise = loadLists()
    .then(async ({ clients, brands }) => {
      const withBrand = clients.map((client) => ({
        client,
        brand: brands.find((b) => b.client === client.id) ?? null,
      }));
      const scores = await Promise.all(
        withBrand.map(({ brand }) =>
          brand
            ? api
                .get<VisibilityScoreEvidence>(`/brands/${brand.id}/visibility-score/${qs}`)
                .then(({ data }) => data)
                .catch(() => null)
            : Promise.resolve(null)
        )
      );
      const entries: ClientScore[] = withBrand.map(({ client, brand }, i) => ({
        client,
        brandId: brand?.id ?? null,
        score: scores[i],
      }));
      scoreCache.set(key, { at: Date.now(), entries });
      return entries;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Warm the cache for All time and every preset, so switching between
 * them is instant. Skipped for large workspaces to keep request volume sane. */
export function prefetchReportingPeriods() {
  loadLists()
    .then(({ brands }) => {
      if (brands.length > 12) return;
      const ranges = [{ since: null, until: null }, ...PERIOD_PRESET_DAYS.map(presetRange)];
      for (const r of ranges) {
        if (!scoreCache.has(periodKey(r.since, r.until))) loadScores(r.since, r.until).catch(() => {});
      }
    })
    .catch(() => {});
}

/** Every client's own brand score from the traceable-score API
 * (GET /brands/{id}/visibility-score/), for a reporting period.
 *
 * While a newly picked period loads, the previous period's numbers stay
 * on screen and `isRefreshing` is true, so the UI can show progress
 * instead of blanking out. */
export function useClientVisibility(filter?: DateRangeFilter) {
  const since = filter?.since ?? null;
  const until = filter?.until ?? null;
  const key = periodKey(since, until);

  const [shown, setShown] = useState<{ key: string; entries: ClientScore[] } | null>(() => {
    const cached = scoreCache.get(key);
    return cached ? { key, entries: cached.entries } : null;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = scoreCache.get(key);
    if (cached && Date.now() - cached.at < SCORES_TTL_MS) return;
    loadScores(since, until)
      .then((entries) => {
        if (cancelled) return;
        setShown({ key, entries });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, since, until]);

  // A period already in the cache renders straight away, even before the
  // effect above has run.
  const current = shown?.key === key ? shown.entries : (scoreCache.get(key)?.entries ?? null);
  const entries = current ?? shown?.entries ?? null;
  return {
    entries,
    error,
    isLoading: !entries && !error,
    isRefreshing: !current && !!shown,
  };
}
