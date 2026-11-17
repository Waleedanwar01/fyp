import { useCallback, useEffect, useState } from "react";

import { api, extractErrorMessage } from "@/lib/api";

export type CitationEvidence = { id: string; url: string; domain: string; title: string };

export type MentionEvidence = {
  id: string;
  term: string;
  is_primary: boolean;
  start_index?: number;
  end_index?: number;
  mention_order: number;
  list_rank: number | null;
  position_score: number | null;
  sentiment: "positive" | "neutral" | "negative";
  sentiment_source?: string;
  sentiment_score: number;
  confidence_score: number;
  needs_review: boolean;
  citations: CitationEvidence[];
};


export type PromptRunEvidence = {
  id: string;
  prompt_text: string;
  provider: string;
  executed_at: string | null;
  response_text: string;
  mentioned: boolean;
  mentions: MentionEvidence[];
};

// Full shape of GET /brands/{id}/visibility-score/ and
// /competitors/{id}/visibility-score/ (core.visibility_score.
// visibility_score_evidence, Month 2) -- the complete evidence trail,
// not the trimmed prompt_runs the dashboard's lighter per-client cards
// use (see components/dashboard/use-client-visibility.ts).
export type FullVisibilityEvidence = {
  entity_id: string;
  entity_name: string;
  visibility_score: number | null;
  components: {
    mention_rate: number;
    position_score: number;
    sentiment_score: number;
    citation_score: number;
  } | null;
  total_runs: number;
  runs_with_mention: number;
  prompt_runs: PromptRunEvidence[];
};

type ClientDetail = {
  id: string;
  name: string;
  industry: string;
  target_locations: string[];
  services: string[];
  created_at?: string;
};
type CompetitorRecord = { id: string; client: string; name: string };

export type CompetitorEntry = { competitor: CompetitorRecord; score: FullVisibilityEvidence | null };
export type BrandDetailCacheEntry = {
  client: ClientDetail;
  brandScore: FullVisibilityEvidence | null;
  competitors: CompetitorEntry[];
};

const globalBrandDetailCache = new Map<string, BrandDetailCacheEntry>();

/** Everything a client's detail page needs: the client itself, its own
 * brand's full traceable-score evidence, and the same evidence for
 * every competitor tracked against it -- real data for the comparison
 * table/chart, never invented numbers. */
export function useBrandDetail(clientId: string) {
  const cached = globalBrandDetailCache.get(clientId) ?? null;
  const [client, setClient] = useState<ClientDetail | null>(cached?.client ?? null);
  const [brandScore, setBrandScore] = useState<FullVisibilityEvidence | null>(cached?.brandScore ?? null);
  const [competitors, setCompetitors] = useState<CompetitorEntry[] | null>(cached?.competitors ?? null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    if (!clientId) return;
    Promise.all([
      api.get<ClientDetail>(`/clients/${clientId}/`),
      api.get<{ id: string; client: string }[]>("/brands/"),
      api.get<CompetitorRecord[]>("/competitors/"),
    ])
      .then(async ([clientRes, brandsRes, competitorsRes]) => {
        const clientData = clientRes.data;
        const brand = brandsRes.data.find((b) => b.client === clientId) ?? null;
        const ownScorePromise = brand
          ? api.get<FullVisibilityEvidence>(`/brands/${brand.id}/visibility-score/`).then(({ data }) => data)
          : Promise.resolve(null);

        const clientCompetitors = competitorsRes.data.filter((c) => c.client === clientId);
        const competitorScoresPromise = Promise.all(
          clientCompetitors.map((competitor) =>
            api
              .get<FullVisibilityEvidence>(`/competitors/${competitor.id}/visibility-score/`)
              .then(({ data }) => ({ competitor, score: data }))
              .catch(() => ({ competitor, score: null }))
          )
        );

        const [ownScore, competitorScores] = await Promise.all([ownScorePromise, competitorScoresPromise]);
        
        globalBrandDetailCache.set(clientId, {
          client: clientData,
          brandScore: ownScore,
          competitors: competitorScores,
        });

        setClient(clientData);
        setBrandScore(ownScore);
        setCompetitors(competitorScores);
      })
      .catch((err) => setError(extractErrorMessage(err)));
  }, [clientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { client, brandScore, competitors, error, refetch: loadData };
}


