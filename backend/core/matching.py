"""Name mention detection: given a block of text (eventually an AI
provider's response), find exact, whole-word matches of a tracked name
(a client's brand, or one of its competitors) or any of its aliases.
Case-insensitive; not fuzzy -- "RankLens" won't match "AVTRX" or "XAVTR", and
typos/synonyms aren't detected. Reused by the AI response analysis
pipeline to decide whether/how a brand or competitor showed up in a
given answer.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class NameMatch:
    term: str  # the exact name/alias text that matched, as configured (not as found in the text)
    is_primary: bool  # True if this matched the primary name, False for an alias
    start: int
    end: int


def _term_pattern(term: str) -> re.Pattern:
    # Lookaround word boundaries rather than \b: safe for terms that start
    # or end with a non-word character (e.g. punctuation in a stylized
    # name), where \b's alphanumeric-only notion of "boundary" would
    # behave inconsistently.
    return re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)


def _unique_terms(name: str, aliases: list[str] | None) -> list[tuple[str, bool]]:
    """De-duplicates case-insensitively (an alias identical to the primary
    name, or repeated in the alias list, shouldn't produce double matches),
    while keeping the first-seen casing and its primary/alias flag."""
    seen: set[str] = set()
    terms: list[tuple[str, bool]] = []
    for term, is_primary in [(name, True), *[(alias, False) for alias in (aliases or [])]]:
        term = (term or "").strip()
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        terms.append((term, is_primary))
    return terms


def find_name_mentions(text: str, name: str, aliases: list[str] | None = None) -> list[NameMatch]:
    """Scans `text` for every exact, case-insensitive, whole-word occurrence
    of `name` or any entry in `aliases`. Returns matches in the order they
    appear in the text. Works the same whether `name` is a brand or a
    competitor -- the matching logic doesn't care which."""
    if not text:
        return []

    matches = [
        NameMatch(term=term, is_primary=is_primary, start=m.start(), end=m.end())
        for term, is_primary in _unique_terms(name, aliases)
        for m in _term_pattern(term).finditer(text)
    ]
    matches.sort(key=lambda match: match.start)
    return matches


def name_is_mentioned(text: str, name: str, aliases: list[str] | None = None) -> bool:
    """Cheap boolean check for callers that don't need match positions."""
    return bool(find_name_mentions(text, name, aliases))


_COMPOUND_PHRASE_PATTERN = re.compile(r"^\s+[A-Z][a-z]")


def compute_match_confidence(term: str, is_primary: bool, matched_text: str, trailing_context: str = "") -> float:
    """How much a single NameMatch actually looks like the tracked brand
    or competitor, rather than an unrelated word that happened to satisfy
    find_name_mentions' exact/whole-word test -- RankLens treats AI visibility
    as sampled monitoring, not a guaranteed ranking, so a shaky detection
    should say so rather than presenting itself as fact. Starts at a full
    1.0 and is reduced by concrete, explainable signals (never raised
    above it), so the result is always traceable back to *why* it's
    uncertain:

    - Alias match, not the primary name (-0.15): an alias is a secondary
      spelling the agency configured, generally a weaker signal than the
      entity's actual name showing up.
    - Short term (-0.4 at <=3 characters, -0.2 at 4-5, -0.05 at 6-8): the
      shorter a name is, the more likely it is to be satisfied by
      unrelated text by coincidence.
    - Case mismatch (-0.15): `matched_text` is what the response actually
      contains at that position; find_name_mentions matches case-
      insensitively, so a name configured as "Acme" turning up as "acme"
      or "ACME" didn't reproduce the brand's own styling, which is
      slightly weaker evidence than an exact reproduction.
    - Looks like a prefix of a longer compound name (-0.25): `trailing_context`
      is whatever comes right after the match; if it starts with whitespace
      then another capitalized word (e.g. "Master Replica" immediately
      followed by " Dresses Pakistan"), the match may just be the first
      part of a longer proper noun the response is actually naming --
      not necessarily a standalone mention of the tracked name. Added
      after a real Week 7 review of live client responses (AVTR_SPEC
      follow-up) turned up exactly this pattern -- a Facebook page
      called "Master Replica Dresses Pakistan" isn't the same thing as
      the tracked competitor "Master Replica", but the plain exact/
      whole-word match couldn't tell the difference on its own.

    Clamped to [0.0, 1.0]. Only ever compares `term` (as configured),
    `matched_text` (the literal substring found), and `trailing_context`
    (the few characters right after it) -- no AI call, no external data,
    so this is cheap enough to compute for every match."""
    score = 1.0
    if not is_primary:
        score -= 0.15
    length = len(term.strip())
    if length <= 3:
        score -= 0.4
    elif length <= 5:
        score -= 0.2
    elif length <= 8:
        score -= 0.05
    if matched_text != term:
        score -= 0.15
    if _COMPOUND_PHRASE_PATTERN.match(trailing_context):
        score -= 0.25
    return max(0.0, min(1.0, score))


# Matches a numbered list item at the start of its line -- three shapes
# AI responses have actually used for "here are the top picks" answers
# in practice: a plain ordered-list marker ("1. "), a numbered markdown
# heading ("### 2. ", "## 3) " with either punctuation), or a markdown
# comparison-table row with a numeric rank in its first cell ("| 1 |
# Some Business | ..."). Exactly one of the two groups matches per hit;
# list_rank_at reads whichever one fired.
_LIST_MARKER_PATTERN = re.compile(
    r"^[ \t]*(?:#{0,6}[ \t]*(\d+)[.)]\s|\|[ \t]*(\d+)[ \t]*\|)", re.MULTILINE
)

# A blank line is the conventional markdown paragraph break -- prose
# that follows a list after one no longer belongs to that list's last
# item, even though nothing else marks where the list "ended".
_BLANK_LINE_PATTERN = re.compile(r"\n[ \t]*\n")


def list_rank_at(text: str, position: int) -> int | None:
    """Which numbered list item `position` falls within, per AVTR_SPEC's
    "position" (a recommendation/list rank, not just text order): the
    number of the nearest numbered-list marker that starts at or before
    `position`, reading top to bottom -- unless a blank line (a
    paragraph break) falls between that marker and `position`, in which
    case `position` has moved on to ordinary prose and isn't part of
    that list item anymore. None if `position` comes before any marker,
    the text has no numbered list/table at all, or it falls past a
    list's last item into the following prose -- an ordinary mention
    outside of any ranked recommendation. A comparison table's rows only
    count when the table itself has a numeric rank column ("| 1 | ... |")
    -- a table with no such column isn't necessarily presenting its rows
    in any particular order, so inventing a rank from row position alone
    would be a guess, not a read of what the AI actually said.

    Heuristic, not a full markdown/outline parser -- but correctly
    handles more than one separate, independently-numbered list/table
    in the same response (each mention gets whichever list it's
    actually nearest to, so a second list restarting at "1." doesn't
    bleed into the first): "nearest preceding marker" is recomputed per
    call, not assumed to be one continuous global sequence."""
    rank = None
    rank_end = None
    for marker in _LIST_MARKER_PATTERN.finditer(text):
        if marker.start() > position:
            break
        rank = int(marker.group(1) or marker.group(2))
        rank_end = marker.end()
    if rank is None:
        return None
    if _BLANK_LINE_PATTERN.search(text, rank_end, position):
        return None
    return rank
