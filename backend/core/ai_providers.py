"""Provider-independent interface for sending prompts to external AI
providers (AVTR_SPEC follow-up, Month 2 kickoff).

`execute_prompt_run` (core/tasks.py) talks only to `get_provider_client`
and the `AIProviderClient` interface it returns -- it never needs to
know which real provider is behind a given `AIProvider` value. Adding
Gemini or Perplexity for real later means writing one new client class
here and adding it to `_CLIENTS`; nothing in tasks.py, the serializers,
or the models has to change.

Credentials are read from Django settings (which itself reads them from
the environment -- see config/settings.py's OPENAI_API_KEY), never
hard-coded here.
"""

import logging
import time

import requests
from django.conf import settings

from .models import AIProvider

logger = logging.getLogger(__name__)


class AIProviderError(Exception):
    """A provider call couldn't be completed, and retrying it again
    right away wouldn't help -- bad/missing credentials, an unknown
    provider, a 4xx (other than 429), or a response in a shape the
    client doesn't recognize. execute_prompt_run (core/tasks.py) catches
    this and marks the PromptRun FAILED immediately with the message
    here as `response_text`, rather than letting it raise all the way
    out of the Celery task."""


class TransientAIProviderError(AIProviderError):
    """A provider call failed in a way that's plausibly temporary --
    a timeout, a dropped connection, a 429 (rate limited), or a 5xx
    (the provider's own server trouble). execute_prompt_run retries
    these with exponential backoff (Celery's retry_backoff) up to a
    fixed number of attempts before finally giving up and marking the
    PromptRun FAILED -- see its docstring for the exact policy."""


class AIProviderClient:
    """Interface every provider client implements."""

    def is_configured(self) -> bool:
        """Whether this client has what it needs (an API key, etc.) to
        actually make a call right now."""
        raise NotImplementedError

    def send_prompt(self, prompt_text: str) -> str:
        """Send `prompt_text` to the provider and return its raw text
        response. Raises AIProviderError on any failure."""
        raise NotImplementedError


class OpenAIProviderClient(AIProviderClient):
    """Talks to OpenAI's Chat Completions API directly over HTTPS.
    `requests` is already a project dependency -- no need for the
    `openai` SDK just to POST one JSON body and read one field back."""

    API_URL = "https://api.openai.com/v1/chat/completions"
    DEFAULT_MODEL = "gpt-4o-mini"
    TIMEOUT_SECONDS = 10

    def is_configured(self) -> bool:
        key = getattr(settings, "OPENAI_API_KEY", "") or ""
        return bool(key and key.startswith("sk-"))

    def send_prompt(self, prompt_text: str) -> str:
        if not self.is_configured():
            raise AIProviderError("OPENAI_API_KEY is not configured.")

        try:
            response = requests.post(
                self.API_URL,
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.DEFAULT_MODEL,
                    "messages": [{"role": "user", "content": prompt_text}],
                },
                timeout=self.TIMEOUT_SECONDS,
            )
        except requests.Timeout as exc:
            raise TransientAIProviderError(f"OpenAI request timed out: {exc}") from exc
        except requests.RequestException as exc:
            raise TransientAIProviderError(f"OpenAI request failed: {exc}") from exc

        if response.status_code == 429:
            raise TransientAIProviderError(f"OpenAI rate limit hit (429): {response.text[:200]}")
        if response.status_code >= 500:
            raise TransientAIProviderError(f"OpenAI server error ({response.status_code}): {response.text[:200]}")
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            raise AIProviderError(f"OpenAI request failed: {exc}") from exc

        try:
            return response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AIProviderError(f"Unexpected OpenAI response shape: {exc}") from exc


def _append_citations(text: str, grounding_metadata: dict | None) -> str:
    """Turns Gemini's groundingMetadata (present only when Search
    grounding actually found something to cite) into inline `[1]`/`[2]`
    markdown links right after the sentences they support, plus a
    trailing numbered "Sources" list -- both are then just ordinary
    markdown links once rendered, so they show up clickable in the UI
    for free, no separate citation UI needed.

    `groundingSupports[].segment.endIndex` is a UTF-8 **byte** offset
    into the response text (Gemini's documented behavior), not a
    Python string/character index -- encoding to bytes, inserting, and
    decoding back keeps multi-byte characters (em dashes, accented
    names, curly quotes -- all things real answers have used here) from
    shifting every offset after them. If Google ever changes this shape
    or the encoding assumption is wrong for a given response, any
    failure here falls back to the plain, unmodified text rather than
    losing or corrupting a real answer over a citations nice-to-have.
    """
    if not grounding_metadata:
        return text

    try:
        chunks = grounding_metadata.get("groundingChunks") or []
        sources = [
            {"uri": web["uri"], "title": web.get("title") or web["uri"]}
            for chunk in chunks
            if (web := chunk.get("web")) and web.get("uri")
        ]
        if not sources:
            return text

        supports = grounding_metadata.get("groundingSupports") or []
        # (byte_end_index, marker_text), applied back-to-front so each
        # insertion doesn't shift the byte offsets still to be applied.
        insertions = []
        for support in supports:
            end_index = (support.get("segment") or {}).get("endIndex")
            chunk_indices = support.get("groundingChunkIndices") or []
            if end_index is None or not chunk_indices:
                continue
            marker = "".join(f"[[{i + 1}]]({sources[i]['uri']})" for i in chunk_indices if i < len(sources))
            if marker:
                insertions.append((end_index, marker))
        insertions.sort(key=lambda pair: pair[0], reverse=True)

        text_bytes = text.encode("utf-8")
        for byte_index, marker in insertions:
            text_bytes = text_bytes[:byte_index] + marker.encode("utf-8") + text_bytes[byte_index:]
        text = text_bytes.decode("utf-8")

        sources_list = "\n".join(f"{i + 1}. [{s['title']}]({s['uri']})" for i, s in enumerate(sources))
        return f"{text}\n\n---\n**Sources:**\n{sources_list}"
    except Exception:
        logger.exception("Failed to attach Gemini citations -- returning the plain response instead.")
        return text


class GeminiProviderClient(AIProviderClient):
    """Talks to Google's Generative Language API (Gemini) directly over
    HTTPS with multi-model fallback and extended timeouts."""

    API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    # Tried in order. Google retires model names regularly (the 1.5/2.0/2.5
    # names this used to list now 404 for new keys), so "gemini-flash-latest"
    # -- an alias that tracks the newest Flash -- is kept as a fallback, and
    # GEMINI_MODELS (comma-separated) overrides the list without a deploy.
    DEFAULT_MODELS = [
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash",
        "gemini-flash-lite-latest",
    ]

    @property
    def MODELS(self) -> list[str]:
        configured = getattr(settings, "GEMINI_MODELS", "") or ""
        models = [m.strip() for m in configured.split(",") if m.strip()]
        return models or self.DEFAULT_MODELS

    # The model that answered last, tried first next time (for 10 minutes)
    # -- when Google overloads the first-choice model, every call otherwise
    # waits through the same 503/timeout before falling back again.
    _last_good: tuple[str, float] | None = None
    LAST_GOOD_TTL_SECONDS = 600

    def _ordered_models(self) -> list[str]:
        models = self.MODELS
        last = GeminiProviderClient._last_good
        if last and last[0] in models and time.monotonic() - last[1] < self.LAST_GOOD_TTL_SECONDS:
            return [last[0]] + [m for m in models if m != last[0]]
        return models
    TIMEOUT_SECONDS = 45

    def is_configured(self) -> bool:
        return bool(getattr(settings, "GEMINI_API_KEY", "") or "")

    def send_prompt(self, prompt_text: str) -> str:
        if not self.is_configured():
            raise AIProviderError("GEMINI_API_KEY is not configured.")

        payload = {"contents": [{"parts": [{"text": prompt_text}]}]}
        if settings.GEMINI_SEARCH_GROUNDING_ENABLED:
            payload["tools"] = [{"google_search": {}}]

        last_error = None
        for model in self._ordered_models():
            try:
                response = requests.post(
                    self.API_URL.format(model=model),
                    params={"key": settings.GEMINI_API_KEY},
                    headers={"Content-Type": "application/json"},
                    json=payload,
                    timeout=self.TIMEOUT_SECONDS,
                )
            except requests.Timeout as exc:
                last_error = TransientAIProviderError(f"Gemini request timed out ({model}): {exc}")
                continue
            except requests.RequestException as exc:
                last_error = TransientAIProviderError(f"Gemini request failed ({model}): {exc}")
                continue

            if response.status_code == 429:
                last_error = TransientAIProviderError(f"Gemini rate limit hit (429): {response.text[:200]}")
                continue
            if response.status_code >= 500:
                last_error = TransientAIProviderError(f"Gemini server error ({response.status_code}): {response.text[:200]}")
                continue
            if response.status_code == 404:
                # Model name not found on this API version, try next model in fallback list
                continue

            try:
                response.raise_for_status()
                data = response.json()
                candidate = data["candidates"][0]
                text = candidate["content"]["parts"][0]["text"]
                GeminiProviderClient._last_good = (model, time.monotonic())
                return _append_citations(text, candidate.get("groundingMetadata"))
            except (KeyError, IndexError, TypeError, ValueError, requests.HTTPError) as exc:
                last_error = AIProviderError(f"Unexpected Gemini response ({model}): {exc}")
                continue

        if last_error:
            raise last_error
        raise AIProviderError(
            f"None of the configured Gemini models are available to this API key ({', '.join(self.MODELS)}). "
            "Set GEMINI_MODELS to a model the key can use."
        )



class UnimplementedProviderClient(AIProviderClient):
    """Perplexity already exists as a selectable AIProvider value
    (plans, schedules) ahead of its own integration work -- this keeps
    that selection meaningful (a clear "not wired up yet" error)
    instead of silently doing nothing or crashing oddly."""

    def __init__(self, provider_label):
        self.provider_label = provider_label

    def is_configured(self) -> bool:
        return False

    def send_prompt(self, prompt_text: str) -> str:
        raise AIProviderError(f"{self.provider_label} isn't integrated yet.")


_CLIENTS = {
    AIProvider.OPENAI: OpenAIProviderClient(),
    AIProvider.GEMINI: GeminiProviderClient(),
    AIProvider.PERPLEXITY: UnimplementedProviderClient("Perplexity"),
}


def get_provider_client(provider: str) -> AIProviderClient:
    """`provider` is one of AIProvider's values (e.g. "openai")."""
    try:
        return _CLIENTS[provider]
    except KeyError:
        raise AIProviderError(f"Unknown AI provider: {provider!r}") from None


# Manual "Run now" triggers (PromptViewSet.run/run_bulk) don't have a
# provider picker in the UI yet, so they need one sensible default.
# Preferring whichever of these is actually configured -- checked in
# this order -- means pasting in just one working key (e.g. a free
# Gemini key while OpenAI billing isn't set up yet) is enough to make
# manual runs work for real, with no UI changes needed.
_DEFAULT_MANUAL_PROVIDER_ORDER = (AIProvider.OPENAI, AIProvider.GEMINI)


def default_manual_provider() -> str:
    for provider in _DEFAULT_MANUAL_PROVIDER_ORDER:
        if _CLIENTS[provider].is_configured():
            return provider
    return AIProvider.OPENAI
