"""Turns a bare buyer-intent question into the actual text sent to an AI
provider (core/ai_providers.py), grounded in the location/service
context that makes it a real, answerable question in the first place --
"Best dentist near downtown" only means something once an AI knows
*which* downtown.

Deliberately never includes the client's own brand name or Brand.aliases
here: the entire point of a PromptRun (AVTR_SPEC §4) is checking whether
the client's brand comes up *organically* in an AI's answer, so naming
it in the question sent would defeat that test. Brand/alias matching
belongs in reading the response back (core/matching.py), never in
writing the question.
"""

from .models import Prompt


def build_effective_prompt(prompt_text: str, prompt: Prompt) -> str:
    """`prompt_text` is the run's own snapshot (PromptRun.prompt_text,
    exactly as asked at trigger time -- never rewritten here); `prompt`
    is the live Prompt row, whose location_tags/service_tags/category
    contribute *context*, not the question itself. A prompt with no
    tags of its own inherits its client's general target_locations/
    services, since it's implicitly about that client's whole service
    area unless scoped more narrowly."""
    client = prompt.client
    locations = prompt.location_tags or client.target_locations
    services = prompt.service_tags or client.services

    context_bits = []
    if locations:
        context_bits.append(f"Location(s) of interest: {', '.join(locations)}.")
    if services:
        context_bits.append(f"Relevant service(s): {', '.join(services)}.")
    if prompt.category:
        context_bits.append(f"Category: {prompt.category}.")

    if not context_bits:
        return prompt_text

    return f"{prompt_text}\n\n({' '.join(context_bits)})"
