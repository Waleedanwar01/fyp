"""Citation/source-reference extraction from a raw AI response
(AVTR_SPEC follow-up): whatever URLs the response actually contains.

Gemini's real Search-grounding citations (Month 2 --
core.ai_providers._append_citations) render as ordinary markdown links
right in the response text once grounding is on; a plain markdown link
or bare URL the model just happened to type counts exactly the same
way here. One extractor covers both -- there's no separate "real
citation" vs. "URL in the text" code path, because by the time this
runs, a real citation *is* a URL in the text.

Domain normalization (strip protocol/www, lowercase) lets citations
from the same source group together regardless of the exact URL or
www-prefix used.
"""

import re
from urllib.parse import urlparse

from .models import Citation

_MARKDOWN_LINK_PATTERN = re.compile(r"\[([^\]]*)\]\((https?://[^\s)]+)\)")
_URL_PATTERN = re.compile(r"https?://[^\s)\]]+")
_TRAILING_PUNCTUATION = ").,;:!?\"'"


def normalize_domain(url: str) -> str:
    """"https://www.Example.com:8080/page" -> "example.com" -- strips
    protocol, a leading "www.", any userinfo/port, and the path/query,
    then lowercases, so the same site groups together regardless of how
    a citation happened to write it. Not a full public-suffix-aware
    "root domain" reduction (a subdomain like blog.example.com stays as
    blog.example.com) -- just what "strip protocol/www" actually asks
    for."""
    host = urlparse(url).netloc or url.split("/", 1)[0]
    host = host.rsplit("@", 1)[-1]  # drop a "user:pass@" prefix, if any
    host = host.split(":", 1)[0]  # drop a port, if any
    host = host.lower()
    host = host.removeprefix("www.")
    return host


def extract_citations(text: str) -> list[dict]:
    """One entry per unique URL found in `text` -- markdown links
    `[title](url)` and any bare `https://...` URL not already part of
    one -- in first-occurrence order, each as
    `{"url": ..., "title": ..., "domain": ..., "positions": [...]}`
    (title is "" for a bare URL). A URL repeated later in the same text
    keeps its first-seen title rather than being counted again as a
    separate source, but every occurrence's character offset is kept in
    `positions` (core.mention_citations uses these to work out which
    mention(s) a citation actually sits next to -- a source cited twice
    can support two different mentions)."""
    if not text:
        return []

    covered_spans = []
    citations: dict[str, dict] = {}

    for match in _MARKDOWN_LINK_PATTERN.finditer(text):
        title, url = match.group(1).strip(), match.group(2)
        start, end = match.start(2), match.end(2)
        covered_spans.append((start, end))
        entry = citations.setdefault(
            url, {"url": url, "title": title, "domain": normalize_domain(url), "positions": []}
        )
        entry["positions"].append(start)

    for match in _URL_PATTERN.finditer(text):
        if any(start <= match.start() < end for start, end in covered_spans):
            continue  # already captured as part of a markdown link above
        url = match.group(0).rstrip(_TRAILING_PUNCTUATION)
        entry = citations.setdefault(url, {"url": url, "title": "", "domain": normalize_domain(url), "positions": []})
        entry["positions"].append(match.start())

    return list(citations.values())


def store_citations(run) -> list[Citation]:
    """Extracts every citation/source reference from `run.response_text`
    (extract_citations, above) and stores one Citation row per unique
    URL, linked to `run`. Idempotent: re-running for a PromptRun that
    already has Citations (e.g. a retried delivery landing on the same
    id) replaces them rather than duplicating.

    Truncates to each field's own column length before saving: an
    unusually long URL (a tracking/redirect link with a large query
    string, say) would otherwise fail at the database level -- and
    since each row is created independently here, a single oversized
    citation partway through would leave this run with only *some* of
    its citations stored, not none and not all. A truncated URL might
    not be perfectly clickable, but it's still a far better record of
    "this run cited a source" than silently losing the rest of the
    list to one bad row."""
    Citation.objects.filter(prompt_run=run).delete()
    return [
        Citation.objects.create(
            agency=run.agency,
            prompt_run=run,
            url=citation["url"][:2000],
            title=citation["title"][:500],
            domain=citation["domain"][:255],
        )
        for citation in extract_citations(run.response_text)
    ]
