"""RankLens Visibility Score: a single 0.0-1.0 number combining four
weighted signals that are already computed and stored elsewhere in the
pipeline (core.mention_detection, core.sentiment, core.mention_citations)
-- purely a weighted average over stored data, no new inference and no
AI call of its own.

    Visibility Score = 0.40 x Mention Rate
                      + 0.25 x Position Score
                      + 0.20 x Sentiment Score
                      + 0.15 x Citation Score

Computed for a single tracked name -- a client's own Brand, or one of
its Competitors -- across every one of that client's completed
PromptRuns on file (optionally narrowed to a period -- see `since`/
`until` below):

- Mention Rate: the fraction of those runs that mentioned the name at
  least once (core.mention_detection). Mentioned in 3 of 10 runs is a
  0.3 Mention Rate, regardless of how many times it came up within any
  one of those 3.
- Position Score: the average, across every one of the name's Mentions
  (not just one per run -- several mentions in the same run each count),
  of that mention's reciprocal rank -- 1/list_rank, per
  core.matching.list_rank_at, so "named #1" scores a full 1.0 and
  "named #4" scores 0.25. A mention outside of any numbered list
  (list_rank is None) scores a neutral 0.5: there's no ranking signal
  either way, so it's neither rewarded nor penalized for it.
- Sentiment Score: the average, across the same Mentions, of
  positive=1.0 / neutral=0.5 / negative=0.0.
- Citation Score: the fraction of those same Mentions that have at
  least one supporting Citation (core.mention_citations).

Every component, and the final weighted sum, is a 0.0-1.0 fraction --
multiply by 100 for a percentage in a UI. Returns None (never a
fabricated 0.0) when the name has no completed PromptRuns at all yet:
"not enough data" and "we checked and found nothing" are different
findings, and RankLens doesn't blur them together. Once there's at least
one completed run, a genuine zero (never mentioned, so nothing to
average for position/sentiment/citation either) is reported as exactly
that -- 0.0 in every component.

Two edge cases that would otherwise skew this:

- A duplicate AI response for the same prompt (e.g. a manual re-run
  that happened to come back byte-for-byte identical) is one real
  sample of AI behavior, not several independent ones -- counting it
  more than once would inflate Mention Rate and pull the position/
  sentiment/citation averages toward whatever that one repeated
  answer happened to look like. Runs are deduplicated by (prompt,
  response_text) before anything is counted, keeping the earliest
  occurrence; `duplicate_runs_excluded` on the result says how many
  were folded in this way, so this is visible, not silent.
- FAILED and NEEDS_REVIEW runs never had anything worth scoring in
  the first place (the former has no real answer at all, the latter's
  response was empty) and are excluded by the `status=COMPLETED`
  filter itself, upstream of everything else here.

`compute_visibility_score` keeps the exact PromptRun and Mention rows
it computed from attached to its result (`.runs`/`.mentions`) rather
than just the aggregate numbers, and `visibility_score_evidence` turns
that into a plain JSON-ready dict -- the score is never a black-box
number: every run considered, its full response, and every mention
found in it (with the position/sentiment/citation detail that fed the
score) is right there alongside the total. core.views' visibility-score
API action is a thin wrapper around this.
"""

from dataclasses import dataclass, field
from datetime import datetime, time

from django.db.models import Count
from django.utils import timezone

from .models import Brand, Competitor, Mention, PromptRun

MENTION_RATE_WEIGHT = 0.40
POSITION_SCORE_WEIGHT = 0.25
SENTIMENT_SCORE_WEIGHT = 0.20
CITATION_SCORE_WEIGHT = 0.15

_SENTIMENT_SCORES = {
    Mention.Sentiment.POSITIVE: 1.0,
    Mention.Sentiment.NEUTRAL: 0.5,
    Mention.Sentiment.NEGATIVE: 0.0,
}


@dataclass(frozen=True)
class VisibilityScoreResult:
    visibility_score: float
    mention_rate: float
    position_score: float
    sentiment_score: float
    citation_score: float
    total_runs: int
    runs_with_mention: int
    mention_count: int
    duplicate_runs_excluded: int = 0
    runs: list = field(default_factory=list)
    mentions: list = field(default_factory=list)


def _mention_filter_for(entity) -> dict:
    if isinstance(entity, Brand):
        return {"brand": entity}
    if isinstance(entity, Competitor):
        return {"competitor": entity}
    raise TypeError(f"expected a Brand or Competitor, got {type(entity)!r}")


def _deduplicate_runs(runs_qs) -> tuple[list, int]:
    """Collapses runs that share the same prompt and byte-for-byte
    identical response_text down to their earliest occurrence --
    `runs_qs` must already be ordered so "earliest" is "first
    encountered" here. Returns (deduplicated runs, how many were
    dropped as duplicates)."""
    seen_signatures: set = set()
    deduplicated = []
    duplicates_excluded = 0
    for run in runs_qs:
        signature = (run.prompt_id, run.response_text)
        if signature in seen_signatures:
            duplicates_excluded += 1
            continue
        seen_signatures.add(signature)
        deduplicated.append(run)
    return deduplicated, duplicates_excluded


def _position_score_for(mention: Mention) -> float:
    # list_rank < 1 shouldn't happen (core.matching.list_rank_at reads
    # a 1-indexed rank out of the response) but Django's
    # PositiveIntegerField itself permits 0, and nothing stops an AI
    # response from containing a literal "0." list marker -- 1.0/0
    # would otherwise crash the whole score over one malformed rank,
    # so it's treated the same as "no rank" rather than trusted blindly.
    if mention.list_rank is None or mention.list_rank < 1:
        return 0.5
    return 1.0 / mention.list_rank


def compute_visibility_score(
    entity: Brand | Competitor, since: datetime | None = None, until: datetime | None = None
) -> VisibilityScoreResult | None:
    """Computes the RankLens Visibility Score for `entity` (a Brand or
    Competitor) across every completed PromptRun on file for its
    client, optionally narrowed to `executed_at` falling between
    `since` and `until` (either or both may be omitted for an
    all-time score). None if there are no completed runs in scope."""
    mention_filter = _mention_filter_for(entity)  # raises TypeError immediately for anything else

    runs_qs = PromptRun.objects.filter(prompt__client=entity.client, status=PromptRun.Status.COMPLETED)
    if since is not None:
        runs_qs = runs_qs.filter(executed_at__gte=since)
    if until is not None:
        runs_qs = runs_qs.filter(executed_at__lte=until)

    runs = list(runs_qs.order_by("executed_at"))
    duplicate_runs_excluded = 0
    total_runs = len(runs)
    if total_runs == 0:
        return None

    mentions = list(
        Mention.objects.filter(prompt_run__in=runs, **mention_filter)
        .annotate(citation_count=Count("citations"))
        .prefetch_related("citations")
        .order_by("mention_order")
    )
    mention_count = len(mentions)
    runs_with_mention = len({mention.prompt_run_id for mention in mentions})
    mention_rate = runs_with_mention / total_runs

    if mention_count == 0:
        position_score = 0.0
        sentiment_score = 0.0
        citation_score = 0.0
    else:
        position_score = sum(_position_score_for(m) for m in mentions) / mention_count
        sentiment_score = sum(_SENTIMENT_SCORES.get(m.sentiment, 0.5) for m in mentions) / mention_count
        citation_score = sum(1 for m in mentions if m.citation_count > 0) / mention_count

    visibility_score = (
        MENTION_RATE_WEIGHT * mention_rate
        + POSITION_SCORE_WEIGHT * position_score
        + SENTIMENT_SCORE_WEIGHT * sentiment_score
        + CITATION_SCORE_WEIGHT * citation_score
    )

    return VisibilityScoreResult(
        visibility_score=visibility_score,
        mention_rate=mention_rate,
        position_score=position_score,
        sentiment_score=sentiment_score,
        citation_score=citation_score,
        total_runs=total_runs,
        runs_with_mention=runs_with_mention,
        mention_count=mention_count,
        duplicate_runs_excluded=duplicate_runs_excluded,
        runs=runs,
        mentions=mentions,
    )


def _mention_evidence(mention: Mention) -> dict:
    return {
        "id": str(mention.id),
        "term": mention.term,
        "is_primary": mention.is_primary,
        "start_index": mention.start_index,
        "end_index": mention.end_index,
        "mention_order": mention.mention_order,
        "list_rank": mention.list_rank,
        "position_score": _position_score_for(mention),
        "sentiment": mention.sentiment,
        "sentiment_source": mention.sentiment_source,
        "sentiment_score": _SENTIMENT_SCORES.get(mention.sentiment, 0.5),
        "confidence_score": mention.confidence_score,
        "needs_review": mention.needs_review,
        "citations": [
            {"id": str(citation.id), "url": citation.url, "domain": citation.domain, "title": citation.title}
            for citation in mention.citations.all()
        ],
    }


def visibility_score_evidence(
    entity: Brand | Competitor, since: datetime | None = None, until: datetime | None = None
) -> dict:
    """The RankLens Visibility Score for `entity` plus its complete
    supporting evidence trail, as a plain JSON-ready dict: every
    completed PromptRun considered (its prompt text, provider, when it
    ran, and its full response), and every Mention found in each one,
    with the exact position/sentiment/citation detail that fed the
    score. Always the same top-level shape -- `visibility_score` and
    `components` are None and `prompt_runs` is empty when there's no
    data yet, rather than a differently-shaped response, so a caller
    doesn't need two code paths."""
    result = compute_visibility_score(entity, since=since, until=until)

    base = {
        "entity_type": "brand" if isinstance(entity, Brand) else "competitor",
        "entity_id": str(entity.id),
        "entity_name": entity.name,
        "period": {"since": since, "until": until},
        # The component weights are deliberately not part of any API
        # response -- the score formula is proprietary and stays server-side.
    }

    if result is None:
        return {
            **base,
            "visibility_score": None,
            "components": None,
            "total_runs": 0,
            "runs_with_mention": 0,
            "mention_count": 0,
            "duplicate_runs_excluded": 0,
            "prompt_runs": [],
        }

    mentions_by_run: dict = {}
    for mention in result.mentions:
        mentions_by_run.setdefault(mention.prompt_run_id, []).append(mention)

    prompt_runs = [
        {
            "id": str(run.id),
            "prompt_text": run.prompt_text,
            "provider": run.provider,
            "executed_at": run.executed_at,
            "response_text": run.response_text,
            "mentioned": run.id in mentions_by_run,
            "mentions": [_mention_evidence(mention) for mention in mentions_by_run.get(run.id, [])],
        }
        for run in result.runs
    ]

    return {
        **base,
        "visibility_score": result.visibility_score,
        "components": {
            "mention_rate": result.mention_rate,
            "position_score": result.position_score,
            "sentiment_score": result.sentiment_score,
            "citation_score": result.citation_score,
        },
        "total_runs": result.total_runs,
        "runs_with_mention": result.runs_with_mention,
        "mention_count": result.mention_count,
        "duplicate_runs_excluded": result.duplicate_runs_excluded,
        "prompt_runs": prompt_runs,
    }


MAX_HISTORY_POINTS = 30


def visibility_score_history(
    entity: Brand | Competitor, since: datetime | None = None, until: datetime | None = None
) -> list[dict]:
    """The entity's real score over time: one point per day that has
    completed runs, each the cumulative score from `since` to the end of
    that day. Computed entirely server-side (so the formula never ships
    to the browser) and capped at MAX_HISTORY_POINTS evenly spaced days,
    always keeping the most recent one. Empty when there are no runs."""
    runs_qs = PromptRun.objects.filter(
        prompt__client=entity.client, status=PromptRun.Status.COMPLETED, executed_at__isnull=False
    )
    if since is not None:
        runs_qs = runs_qs.filter(executed_at__gte=since)
    if until is not None:
        runs_qs = runs_qs.filter(executed_at__lte=until)

    days = sorted({timezone.localtime(at).date() for at in runs_qs.values_list("executed_at", flat=True)})
    if len(days) > MAX_HISTORY_POINTS:
        step = (len(days) - 1) / (MAX_HISTORY_POINTS - 1)
        days = [days[round(i * step)] for i in range(MAX_HISTORY_POINTS)]

    points = []
    for day in days:
        day_end = timezone.make_aware(datetime.combine(day, time.max))
        if until is not None and day_end > until:
            day_end = until
        result = compute_visibility_score(entity, since=since, until=day_end)
        if result is None:
            continue
        points.append(
            {
                "date": day.isoformat(),
                "visibility_score": result.visibility_score,
                "mention_rate": result.mention_rate,
                "position_score": result.position_score,
                "sentiment_score": result.sentiment_score,
                "citation_score": result.citation_score,
                "total_runs": result.total_runs,
            }
        )
    return points

