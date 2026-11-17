from decimal import Decimal

from django.core.management.base import BaseCommand

from core.models import AIProvider, SubscriptionPlan

# AVTR_SPEC §1/§2: these are INITIAL/DEFAULT commercial values only.
# Nothing in the app hard-codes them beyond this one-time seed -- every
# price/limit is read from SubscriptionPlan at runtime, and an RankLens
# platform admin can change any of them afterward (Django admin, or
# PATCH /api/v1/admin/plans/<id>/). Re-running this command is safe:
# it get_or_creates by slug and never overwrites an existing plan, so an
# admin's edits are never clobbered by re-seeding.
DEFAULT_PLANS = [
    {
        "slug": "starter",
        "name": "Starter",
        "monthly_price_usd": Decimal(49),
        "yearly_price_usd": Decimal(470),
        "prompt_runs_included": 300,
        "client_limit": 5,
        "stored_prompt_limit": 500,
        "active_schedule_limit": 10,
        "team_member_limit": 2,
        "providers": [AIProvider.OPENAI],
        "white_label_level": "Basic",
        "support_level": "Email",
    },
    {
        "slug": "growth",
        "name": "Growth",
        "monthly_price_usd": Decimal(149),
        "yearly_price_usd": Decimal(1430),
        "prompt_runs_included": 600,
        "client_limit": 25,
        "stored_prompt_limit": 2000,
        "active_schedule_limit": 50,
        "team_member_limit": 5,
        "providers": [AIProvider.OPENAI, AIProvider.GEMINI],
        "white_label_level": "Full branding",
        "support_level": "Priority email/chat",
    },
    {
        "slug": "agency",
        "name": "Agency",
        "monthly_price_usd": Decimal(349),
        "yearly_price_usd": Decimal(3350),
        "prompt_runs_included": 1000,
        "client_limit": 100,
        "stored_prompt_limit": 10000,
        "active_schedule_limit": 200,
        "team_member_limit": 15,
        "providers": [AIProvider.OPENAI, AIProvider.GEMINI, AIProvider.PERPLEXITY],
        "white_label_level": "Full branding",
        "support_level": "Dedicated support",
    },
]


class Command(BaseCommand):
    help = "Seeds the initial default subscription plans (Starter/Growth/Agency). Safe to re-run."

    def handle(self, *args, **options):
        for plan_data in DEFAULT_PLANS:
            plan, created = SubscriptionPlan.objects.get_or_create(
                slug=plan_data["slug"], defaults=plan_data
            )
            verb = self.style.SUCCESS("created") if created else "exists (unchanged)"
            self.stdout.write(f"  plan: {plan.name} - {verb}")

        self.stdout.write(self.style.SUCCESS("\nDone."))
