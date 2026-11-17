"""Links a PromptRun's Mentions to whichever of its Citations actually
support them (AVTR_SPEC follow-up: "the relationship between an
individual mention and its supporting citation(s)").

A Citation row (core.citations) is deduplicated per unique URL for the
whole run -- it doesn't know where in the text it was found, or how
many times. A Mention row (core.mention_detection) knows exactly where
it sits (start_index). To connect the two, this module re-scans
response_text for every citation *occurrence* (core.citations.
extract_citations already tracks each one's character offset) and
groups both mentions and citation occurrences into the same text
"segment" -- split at sentence-ending punctuation or a newline, the
same granularity Gemini's own grounding inserts citation markers at
(core.ai_providers._append_citations: "right after the sentences they
support"), and fine enough that separate numbered-list items (each
their own line, rarely separated by a full blank line) don't bleed
into each other.

A mention ends up linked to zero citations (nothing was cited in its
segment), one, or several -- all three are normal, expected outcomes,
not edge cases to special-case away.
"""

import re

from .citations import extract_citations
from .models import Citation, Mention

# A sentence-ending punctuation mark followed by whitespace, or any run
# of newlines -- either one starts a new segment.
_SEGMENT_BREAK_PATTERN = re.compile(r"[.!?]\s+|\n+")


def _segment_spans(text: str) -> list[tuple[int, int]]:
    """Splits `text` into contiguous, gapless (start, end) spans at each
    _SEGMENT_BREAK_PATTERN match, the break itself ending the segment it
    closes. Always returns at least one span, even for text with no
    breaks at all."""
    spans = []
    start = 0
    for match in _SEGMENT_BREAK_PATTERN.finditer(text):
        spans.append((start, match.end()))
        start = match.end()
    spans.append((start, len(text)))
    return spans


def _segment_index_at(spans: list[tuple[int, int]], position: int) -> int:
    """Which span `position` falls within. Positions at/past the very
    end of the text (nothing left to break on) land in the last span."""
    for index, (start, end) in enumerate(spans):
        if start <= position < end:
            return index
    return len(spans) - 1


def link_mention_citations(run) -> None:
    """Sets `mention.citations` for every Mention on `run`, based on
    which of the run's Citations occur in the same text segment as the
    mention. Re-derives citation occurrence positions by re-running
    core.citations.extract_citations against response_text rather than
    storing them on Citation itself -- Citation stays a simple "this run
    cited this URL" record; occurrence positions are only ever needed
    transiently, right here.

    Idempotent: safe to call again for the same run (e.g. a retried
    delivery landing on the same id) -- each call fully replaces every
    mention's citation set via `.set()` rather than adding to it, so
    re-running never accumulates duplicate or stale links."""
    text = run.response_text
    mentions = list(Mention.objects.filter(prompt_run=run))
    if not mentions:
        return

    citations_by_url = {citation.url: citation for citation in Citation.objects.filter(prompt_run=run)}
    if not citations_by_url:
        for mention in mentions:
            mention.citations.set([])
        return

    spans = _segment_spans(text)

    citations_by_segment: dict[int, list[Citation]] = {}
    for entry in extract_citations(text):
        citation = citations_by_url.get(entry["url"])
        if citation is None:
            continue
        for position in entry["positions"]:
            segment_index = _segment_index_at(spans, position)
            citations_by_segment.setdefault(segment_index, []).append(citation)

    for mention in mentions:
        segment_index = _segment_index_at(spans, mention.start_index)
        found = citations_by_segment.get(segment_index, [])
        seen: set = set()
        unique = []
        for citation in found:
            if citation.id not in seen:
                seen.add(citation.id)
                unique.append(citation)
        mention.citations.set(unique)
