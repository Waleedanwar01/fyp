"""Turns a completed PromptRun's raw AI response into Mention rows --
AVTR_SPEC's actual "AI visibility" signal: not just that a run
completed, but whether/how the client's own Brand (or one of its
tracked Competitors) actually showed up in the answer, where it
ranked, and in what tone.

Reuses core.matching.find_name_mentions and list_rank_at (Week 3) for
the actual text-scanning, and core.sentiment.classify_sentiment for
the tone of each occurrence; this module wires those up to the
Brand/Competitor/Mention models and a PromptRun's response.
"""

from django.conf import settings

from .ai_providers import AIProviderClient
from .matching import compute_match_confidence, find_name_mentions, list_rank_at
from .models import Brand, Mention
from .sentiment import classify_sentiment


def detect_mentions(run, provider_client: AIProviderClient) -> list[Mention]:
    """Scans `run.response_text` for the run's client's own Brand and
    every Competitor tracked against that client, storing one Mention
    row per occurrence found -- each individually queryable, not just a
    yes/no flag. `provider_client` is the same AI provider that just
    answered the original prompt (execute_prompt_run already has it in
    hand) -- reused here for the AI-assisted half of sentiment
    classification, so this doesn't need its own provider lookup.

    Every match across every entity is collected first and sorted by
    raw text position *before* any rows are created, so `mention_order`
    (this mention's 1-indexed rank among every mention in the response,
    brand and competitors together) is consistent across entities
    rather than restarting per entity. `list_rank` (which numbered
    recommendation item, if any, the mention falls under) is looked up
    per match via core.matching.list_rank_at -- see Mention's docstring
    for why these two are different notions of "position".

    Idempotent: re-running detection for a PromptRun that already has
    Mentions (e.g. a retried delivery landing on the same id) replaces
    them rather than duplicating."""
    client = run.prompt.client
    text = run.response_text
    Mention.objects.filter(prompt_run=run).delete()

    try:
        brand = client.brand
    except Brand.DoesNotExist:
        brand = None

    # (NameMatch, brand-or-None, competitor-or-None) -- exactly one of
    # the last two is set per entry, mirroring Mention's own constraint.
    entries = []
    if brand is not None:
        entries.extend((match, brand, None) for match in find_name_mentions(text, brand.name, brand.aliases))
    for competitor in client.competitors.all():
        entries.extend(
            (match, None, competitor) for match in find_name_mentions(text, competitor.name, competitor.aliases)
        )
    entries.sort(key=lambda entry: entry[0].start)

    created = []
    for order, (match, brand_hit, competitor_hit) in enumerate(entries, start=1):
        entity_name = brand_hit.name if brand_hit is not None else competitor_hit.name
        sentiment, sentiment_source = classify_sentiment(text, match.start, match.end, entity_name, provider_client)
        confidence = compute_match_confidence(
            match.term,
            match.is_primary,
            text[match.start : match.end],
            trailing_context=text[match.end : match.end + 20],
        )
        created.append(
            Mention.objects.create(
                agency=run.agency,
                prompt_run=run,
                client=client,
                brand=brand_hit,
                competitor=competitor_hit,
                term=match.term,
                is_primary=match.is_primary,
                start_index=match.start,
                end_index=match.end,
                mention_order=order,
                list_rank=list_rank_at(text, match.start),
                sentiment=sentiment,
                sentiment_source=sentiment_source,
                confidence_score=confidence,
                needs_review=confidence < settings.MENTION_CONFIDENCE_REVIEW_THRESHOLD,
            )
        )
    return created
