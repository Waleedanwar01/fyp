"use client";

import { useEffect, useState } from "react";

import { api, extractErrorMessage } from "@/lib/api";
import type { FullVisibilityEvidence, PromptRunEvidence } from "@/components/clients/use-brand-detail";
import type { DateRangeFilter } from "@/components/dashboard/use-client-visibility";

export type ClientRecord = { id: string; name: string; created_at?: string };
export type BrandRecord = { id: string; client: string; name: string; created_at?: string };
export type CompetitorRecord = { id: string; client: string; name: string; created_at?: string };

export type CompetitorScoreItem = {
  competitor: CompetitorRecord;
  score: FullVisibilityEvidence | null;
};

export type GapPrompt = {
  promptId?: string;
  promptText: string;
  provider: string;
  executedAt: string | null;
  competitorsPresent: {
    name: string;
    term: string;
    listRank: number | null;
    mentionOrder: number;
    sentiment: string;
    confidence: number;
  }[];
  responseText: string;
};

export type ClientCompetitorComparison = {
  client: ClientRecord;
  brand: BrandRecord | null;
  brandScore: FullVisibilityEvidence | null;
  competitors: CompetitorScoreItem[];
  gapPrompts: GapPrompt[];
  shareOfVisibility: {
    brandShare: number;
    competitorShares: { competitorId: string; name: string; share: number; score: number }[];
    totalScorePool: number;
  };
};

const periodKey = (since: string | null, until: string | null) => `${since ?? "all"}_${until ?? "all"}`;

// Per-period cache: a period seen before renders instantly and refreshes
// in the background once it's older than CACHE_TTL_MS.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: ClientCompetitorComparison[] }>();
const inflight = new Map<string, Promise<ClientCompetitorComparison[]>>();

function loadComparisons(since: string | null, until: string | null) {
  const key = periodKey(since, until);
  const running = inflight.get(key);
  if (running) return running;
  const promise = Promise.all([
    api.get<ClientRecord[]>("/clients/"),
    api.get<BrandRecord[]>("/brands/"),
    api.get<CompetitorRecord[]>("/competitors/"),
  ])
    .then(async ([clientsRes, brandsRes, compsRes]) => {
      const clients = clientsRes.data;
      const brands = brandsRes.data;
      const competitors = compsRes.data;

      const queryParams = new URLSearchParams();
      if (since) queryParams.set("since", since);
      if (until) queryParams.set("until", until);
      const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

      const clientComparisons = await Promise.all(
        clients.map(async (client) => {
          const brand = brands.find((b) => b.client === client.id) ?? null;
          const clientComps = competitors.filter((c) => c.client === client.id);

          const [brandScore, ...compScores] = await Promise.all([
            brand
              ? api
                  .get<FullVisibilityEvidence>(`/brands/${brand.id}/visibility-score/${queryStr}`)
                  .then(({ data }) => data)
                  .catch(() => null)
              : Promise.resolve(null),
            ...clientComps.map((comp) =>
              api
                .get<FullVisibilityEvidence>(`/competitors/${comp.id}/visibility-score/${queryStr}`)
                .then(({ data }) => data)
                .catch(() => null)
            ),
          ]);

          const competitorItems: CompetitorScoreItem[] = clientComps.map((comp, idx) => ({
            competitor: comp,
            score: compScores[idx],
          }));

          // Compute Share of Visibility
          const bScore = brandScore?.visibility_score ?? 0;
          const compScoreSum = competitorItems.reduce(
            (acc, curr) => acc + (curr.score?.visibility_score ?? 0),
            0
          );
          const totalScorePool = bScore + compScoreSum;

          const brandShare = totalScorePool > 0 ? (bScore / totalScorePool) * 100 : 0;
          const competitorShares = competitorItems.map((c) => ({
            competitorId: c.competitor.id,
            name: c.competitor.name,
            score: c.score?.visibility_score ?? 0,
            share:
              totalScorePool > 0
                ? ((c.score?.visibility_score ?? 0) / totalScorePool) * 100
                : 0,
          }));

          // Compute Gap Prompts (Client Absent, Competitor Visible)
          const brandRunMap = new Map<string, PromptRunEvidence>();
          (brandScore?.prompt_runs ?? []).forEach((run) => {
            brandRunMap.set(run.prompt_text, run);
          });

          const gapMap = new Map<string, GapPrompt>();

          competitorItems.forEach(({ competitor, score: compScore }) => {
            (compScore?.prompt_runs ?? []).forEach((cRun) => {
              if (!cRun.mentioned || (cRun.mentions ?? []).length === 0) return;

              const matchingBrandRun = brandRunMap.get(cRun.prompt_text);
              const brandWasMentioned = matchingBrandRun?.mentioned === true;

              if (!brandWasMentioned) {
                const key = `${cRun.prompt_text}__${cRun.provider}`;
                let gap = gapMap.get(key);
                if (!gap) {
                  gap = {
                    promptText: cRun.prompt_text,
                    provider: cRun.provider,
                    executedAt: cRun.executed_at,
                    responseText: cRun.response_text,
                    competitorsPresent: [],
                  };
                  gapMap.set(key, gap);
                }

                cRun.mentions.forEach((m) => {
                  gap.competitorsPresent.push({
                    name: competitor.name,
                    term: m.term,
                    listRank: m.list_rank,
                    mentionOrder: m.mention_order,
                    sentiment: m.sentiment,
                    confidence: m.confidence_score,
                  });
                });
              }
            });
          });

          return {
            client,
            brand,
            brandScore,
            competitors: competitorItems,
            gapPrompts: Array.from(gapMap.values()),
            shareOfVisibility: {
              brandShare,
              competitorShares,
              totalScorePool,
            },
          };
        })
      );

      cache.set(key, { at: Date.now(), data: clientComparisons });
      return clientComparisons;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Brand-vs-competitor comparison for every client, for a reporting
 * period. While a newly picked period loads, the previous one stays on
 * screen and `isRefreshing` is true. */
export function useCompetitorVisibility(filter?: DateRangeFilter) {
  const since = filter?.since ?? null;
  const until = filter?.until ?? null;
  const key = periodKey(since, until);

  const [shown, setShown] = useState<{ key: string; data: ClientCompetitorComparison[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;
    loadComparisons(since, until)
      .then((data) => {
        if (cancelled) return;
        setShown({ key, data });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, since, until]);

  const current = shown?.key === key ? shown.data : (cache.get(key)?.data ?? null);
  const data = current ?? shown?.data ?? null;
  return { data, isLoading: !data && !error, isRefreshing: !current && !!shown, error };
}
