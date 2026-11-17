from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.models import (
    Agency,
    Brand,
    Client,
    Competitor,
    Prompt,
    Subscription,
    SubscriptionPlan,
    User,
)
from core.tenancy import use_agency

DEV_PASSWORD = "devpassword123"

# Which plan (and billing interval) each sample agency below gets, so
# there's real, immediately-usable subscription/usage data for local
# testing of scheduling without any extra manual setup.
AGENCY_PLAN_SLUGS = {
    "acme": ("growth", Subscription.BillingInterval.MONTHLY),
    "blueridge": ("starter", Subscription.BillingInterval.MONTHLY),
}

SAMPLE_AGENCIES = [
    {
        "name": "Acme Marketing",
        "subdomain": "acme",
        "owner_email": "owner@acme.dev",
        "clients": [
            {
                "name": "Brightleaf Dental",
                "industry": "Healthcare",
                "target_locations": ["Austin, TX", "Round Rock, TX"],
                "services": ["General Dentistry", "Invisalign", "Teeth Whitening"],
                "brand": {"name": "Brightleaf Dental", "aliases": ["Brightleaf"]},
                "competitors": ["SmileCare Dental", "Riverside Family Dentistry"],
                "prompts": [
                    {
                        "text": "Best dentist near downtown for same-day appointments",
                        "category": "Local search intent",
                        "service_tags": ["General Dentistry"],
                        "location_tags": ["Austin, TX"],
                    },
                    {
                        "text": "Which dental clinics offer Invisalign consultations",
                        "category": "Service comparison",
                        "service_tags": ["Invisalign"],
                        "location_tags": ["Austin, TX", "Round Rock, TX"],
                    },
                ],
            },
        ],
    },
    {
        "name": "Blue Ridge SEO",
        "subdomain": "blueridge",
        "owner_email": "owner@blueridge.dev",
        "clients": [
            {
                "name": "Summit Roofing Co",
                "industry": "Home Services",
                "target_locations": ["Asheville, NC", "Boone, NC"],
                "services": ["Roof Repair", "Roof Replacement", "Storm Damage Inspection"],
                "brand": {"name": "Summit Roofing", "aliases": ["Summit Roofing Co", "Summit"]},
                "competitors": ["Apex Roofing", "Elevation Exteriors"],
                "prompts": [
                    {
                        "text": "Top-rated roofing contractors for storm damage repair",
                        "category": "Local search intent",
                        "service_tags": ["Storm Damage Inspection"],
                        "location_tags": ["Asheville, NC"],
                    },
                    {
                        "text": "Roofing companies with the best warranty options",
                        "category": "Service comparison",
                        "service_tags": ["Roof Replacement"],
                        "location_tags": ["Asheville, NC", "Boone, NC"],
                    },
                ],
            },
        ],
    },
]


class Command(BaseCommand):
    help = "Seeds a couple of sample agencies with clients, brands, competitors, and prompts for local dev."

    @transaction.atomic
    def handle(self, *args, **options):
        # Subscription plans are platform-level (no agency FK), so they
        # don't need the RLS bypass below -- seed them first so each
        # sample agency has a real plan to subscribe to.
        call_command("seed_subscription_plans")

        # Client/Brand/Competitor/Prompt enforce row-level security even
        # against this app's own DB connection; this command intentionally
        # writes across multiple agencies in one run, so it needs the
        # trusted bypass -- same as a platform superuser would get.
        with use_agency(bypass=True):
            self._seed()

        self.stdout.write(self.style.SUCCESS(f"\nDone. Dev login password for all seeded users: {DEV_PASSWORD}"))

    def _seed(self):
        for agency_data in SAMPLE_AGENCIES:
            agency, created = Agency.objects.get_or_create(
                subdomain=agency_data["subdomain"],
                defaults={"name": agency_data["name"]},
            )
            self._report("agency", agency, created)
            self._seed_subscription(agency, agency_data["subdomain"])

            owner, owner_created = User.objects.get_or_create(
                email=agency_data["owner_email"],
                defaults={"agency": agency, "role": User.Role.ADMIN},
            )
            if owner_created:
                owner.set_password(DEV_PASSWORD)
                owner.save(update_fields=["password"])
            self._report("owner", owner, owner_created)

            for client_data in agency_data["clients"]:
                client, client_created = Client.objects.get_or_create(
                    agency=agency,
                    name=client_data["name"],
                    defaults={
                        "industry": client_data["industry"],
                        "target_locations": client_data["target_locations"],
                        "services": client_data["services"],
                    },
                )
                self._report("client", client, client_created)

                brand_data = client_data["brand"]
                brand, brand_created = Brand.objects.get_or_create(
                    client=client,
                    defaults={
                        "agency": agency,
                        "name": brand_data["name"],
                        "aliases": brand_data["aliases"],
                    },
                )
                self._report("brand", brand, brand_created)

                for competitor_name in client_data["competitors"]:
                    competitor, competitor_created = Competitor.objects.get_or_create(
                        client=client,
                        name=competitor_name,
                        defaults={"agency": agency},
                    )
                    self._report("competitor", competitor, competitor_created)

                for prompt_data in client_data["prompts"]:
                    prompt, prompt_created = Prompt.objects.get_or_create(
                        client=client,
                        text=prompt_data["text"],
                        defaults={
                            "agency": agency,
                            "category": prompt_data["category"],
                            "service_tags": prompt_data["service_tags"],
                            "location_tags": prompt_data["location_tags"],
                        },
                    )
                    self._report("prompt", prompt, prompt_created)

    def _seed_subscription(self, agency, subdomain):
        plan_slug, billing_interval = AGENCY_PLAN_SLUGS[subdomain]
        plan = SubscriptionPlan.objects.get(slug=plan_slug)
        today = timezone.now().date()
        subscription, created = Subscription.objects.get_or_create(
            agency=agency,
            defaults={
                "plan": plan,
                "billing_interval": billing_interval,
                "status": Subscription.Status.ACTIVE,
                "current_period_start": today,
                "current_period_end": today + timedelta(days=30),
            },
        )
        self._report("subscription", subscription, created)

    def _report(self, label, obj, created):
        verb = self.style.SUCCESS("created") if created else "exists"
        self.stdout.write(f"  {label}: {obj} - {verb}")
