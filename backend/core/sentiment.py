"""Sentiment/context classification for a Mention (AVTR_SPEC follow-up):
not the response as a whole, just the tone of the text immediately
around one specific detected occurrence of a brand or competitor name.

Two stages, cheapest first:
1. A rule-based keyword scan over a window of text around the mention
   -- free, instant, and confidently right for the clear-cut majority
   of real cases: "one of the best options", "would avoid this store",
   and so on.
2. Only when the rule-based scan comes back genuinely inconclusive (no
   keywords either way, or a real mix of positive and negative signals
   in the same window) does an actual AI call get made, asking the same
   provider that answered the original prompt to read the window and
   classify it.

Reuses core.ai_providers (Month 2) for the AI-assisted stage -- no new
provider integration, just one more kind of call through the same
AIProviderClient interface every provider already implements.
"""

import logging
import re

from .ai_providers import AIProviderClient, AIProviderError
from .models import Mention

logger = logging.getLogger(__name__)

# How much text on each side of a mention counts as its "surrounding
# context" -- enough for a human or an AI to judge tone from, without
# handing over the whole (often much longer) response.
CONTEXT_WINDOW_CHARS = 160

_POSITIVE_KEYWORDS = [
    "best", "top pick", "top choice", "top-rated", "highly recommend", "highly recommended",
    "recommended", "excellent", "great option", "great choice", "trusted", "reliable",
    "popular", "well-known", "renowned", "prominent", "favorite", "outstanding", "superior",
    "praised", "loved by", "high-quality", "high quality", "leading", "go-to", "well-regarded",
    "solid choice", "good option", "popular choice", "customer favorite", "stands out",
]

_NEGATIVE_KEYWORDS = [
    "avoid", "worst", "scam", "poor quality", "unreliable", "disappointing", "complaints",
    "warning", "risky", "fraud", "bad reviews", "low quality", "inferior", "problematic",
    "beware", "not recommended", "issues with", "concerns about", "steer clear", "red flag",
    "poor service", "overpriced", "unresponsive", "counterfeit warning", "buyer beware",
]


def _keyword_pattern(phrases: list[str]) -> re.Pattern:
    # Lookaround word boundaries (see core.matching._term_pattern) --
    # safe for a phrase ending in punctuation, where \b's alphanumeric
    # notion of "boundary" behaves inconsistently.
    alternation = "|".join(re.escape(phrase) for phrase in phrases)
    return re.compile(rf"(?<!\w)(?:{alternation})(?!\w)", re.IGNORECASE)


_POSITIVE_PATTERN = _keyword_pattern(_POSITIVE_KEYWORDS)
_NEGATIVE_PATTERN = _keyword_pattern(_NEGATIVE_KEYWORDS)

_VALID_SENTIMENTS = {choice.value for choice in Mention.Sentiment}


def extract_context_window(text: str, start: int, end: int, radius: int = CONTEXT_WINDOW_CHARS) -> str:
    """The text immediately surrounding one mention (`start`/`end` are
    a Mention's own character offsets into `text`) -- what a human or
    an AI actually judges tone from, not the whole response."""
    return text[max(0, start - radius) : min(len(text), end + radius)]


def classify_sentiment_rule_based(context: str) -> str | None:
    """Fast, free, and only confident for the clear-cut cases: returns
    POSITIVE/NEGATIVE if the window has signal words for exactly one
    side, NEUTRAL if it has neither -- or None if it's genuinely
    ambiguous (both positive and negative signals present), which
    callers should read as "ask the AI stage instead of guessing"."""
    has_positive = bool(_POSITIVE_PATTERN.search(context))
    has_negative = bool(_NEGATIVE_PATTERN.search(context))
    if has_positive and has_negative:
        return None
    if has_positive:
        return Mention.Sentiment.POSITIVE
    if has_negative:
        return Mention.Sentiment.NEGATIVE
    return Mention.Sentiment.NEUTRAL


def _classify_sentiment_with_ai(context: str, entity_name: str, provider_client: AIProviderClient) -> str:
    prompt = (
        f'Read this excerpt from a longer answer. Focusing only on how "{entity_name}" '
        "specifically is portrayed in it -- not the rest of the excerpt -- classify the "
        "tone toward it as exactly one word: positive, neutral, or negative.\n\n"
        f'Excerpt:\n"""\n{context}\n"""\n\n'
        "Answer with exactly one word: positive, neutral, or negative."
    )
    raw = provider_client.send_prompt(prompt).strip().lower()
    # Picks whichever valid sentiment word appears *earliest* in the
    # response, not just any one of them -- iterating _VALID_SENTIMENTS
    # directly (a set) would pick non-deterministically between them
    # for a response like "negative, though some reviews are positive",
    # where both words are technically present despite the one-word
    # instruction.
    matches = [(raw.index(candidate), candidate) for candidate in _VALID_SENTIMENTS if candidate in raw]
    if matches:
        return min(matches)[1]
    # An AI that ignores the one-word instruction entirely is itself a
    # signal this excerpt wasn't a clean call -- neutral is the safe
    # default, same as the rule-based stage's own "no signal" case.
    return Mention.Sentiment.NEUTRAL


def classify_sentiment(
    text: str, start: int, end: int, entity_name: str, provider_client: AIProviderClient
) -> tuple[str, str]:
    """Returns (sentiment, source) for one mention at `text[start:end]`.
    Tries the free rule-based scan first; only calls out to
    `provider_client` (the same AI provider that answered the original
    prompt) when the rules come back genuinely ambiguous. A failed AI
    call (rate limit, timeout, anything) falls back to NEUTRAL rather
    than losing the mention or failing the whole run over a
    sentiment-classification nice-to-have."""
    context = extract_context_window(text, start, end)
    rule_result = classify_sentiment_rule_based(context)
    if rule_result is not None:
        return rule_result, Mention.SentimentSource.RULE

    try:
        return _classify_sentiment_with_ai(context, entity_name, provider_client), Mention.SentimentSource.AI
    except AIProviderError:
        logger.exception("classify_sentiment: AI-assisted classification failed -- defaulting to neutral.")
        return Mention.Sentiment.NEUTRAL, Mention.SentimentSource.AI
