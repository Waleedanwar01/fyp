from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import (
    AIProvider,
    Brand,
    Client,
    Competitor,
    Prompt,
    PromptRun,
    PromptSchedule,
)
from core.tasks import execute_prompt_run
from core.tenancy import use_agency

User = get_user_model()

PROMPTS_DATA = [
    {
        "text": "Which is the best university in Faisalabad for BS Computer Science and Software Engineering?",
        "category": "Admissions 2026",
        "service_tags": ["Computer Science (BSCS / BSSE)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Top universities in Faisalabad for DPT (Doctor of Physical Therapy) and medical sciences admission",
        "category": "Medical & Health",
        "service_tags": ["Doctor of Physical Therapy (DPT)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Compare Riphah International University Faisalabad with UAF and GCUF for undergraduate computing degrees",
        "category": "University Comparison",
        "service_tags": ["Computer Science (BSCS / BSSE)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Best private universities in Faisalabad offering merit scholarships and modern campus facilities",
        "category": "Scholarships & Facilities",
        "service_tags": ["Business Administration (BBA / MBA)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Which university in Faisalabad has the highest graduate job placement rate for IT and Software Engineering?",
        "category": "Career & Placements",
        "service_tags": ["Electrical & Software Engineering"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Is Riphah International University Faisalabad good for Allied Health Sciences and Physical Therapy?",
        "category": "Medical & Health",
        "service_tags": ["MBBS & Allied Health Sciences", "Doctor of Physical Therapy (DPT)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Top ranked business schools and BBA programs in Faisalabad for 2026 admissions",
        "category": "Business & Management",
        "service_tags": ["Business Administration (BBA / MBA)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Best engineering and computer science universities in Faisalabad near Satyana Road and Jaranwala Road",
        "category": "Campus Location",
        "service_tags": ["Computer Science (BSCS / BSSE)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "Where should I take admission for BS Artificial Intelligence and Data Science in Faisalabad: Riphah, FAST, or GCUF?",
        "category": "Admissions 2026",
        "service_tags": ["Computer Science (BSCS / BSSE)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
    {
        "text": "What are the top 5 universities in Faisalabad for faculty quality, campus life, and recognized degree programs?",
        "category": "Rankings & Reputation",
        "service_tags": ["Computer Science (BSCS / BSSE)", "Business Administration (BBA / MBA)"],
        "location_tags": ["Faisalabad, Pakistan"],
    },
]

COMPETITORS_DATA = [
    {
        "name": "University of Agriculture Faisalabad",
        "aliases": ["UAF", "UAF Faisalabad", "Agriculture University Faisalabad"],
    },
    {
        "name": "Government College University Faisalabad",
        "aliases": ["GCUF", "GCU Faisalabad", "GC University Faisalabad"],
    },
    {
        "name": "National Textile University",
        "aliases": ["NTU", "NTU Faisalabad", "National Textile University Faisalabad"],
    },
    {
        "name": "FAST NUCES Faisalabad",
        "aliases": ["FAST Faisalabad", "FAST-NUCES Chiniot-Faisalabad", "FAST CFD"],
    },
    {
        "name": "The University of Faisalabad",
        "aliases": ["TUF", "TUF Faisalabad", "University of Faisalabad"],
    },
]

class Command(BaseCommand):
    help = "Seeds Riphah International University Faisalabad client, brand, competitors, 10 prompts, and daily schedules for Acme Marketing agency."

    def handle(self, *args, **options):
        # 1. Locate Acme agency user
        user = User.objects.filter(email="owner@acme.dev").first()
        if not user or not user.agency:
            self.stdout.write(self.style.ERROR("User owner@acme.dev with an agency not found."))
            return

        agency = user.agency
        self.stdout.write(f"Seeding for Agency: {agency.name} (ID: {agency.id})")

        with use_agency(bypass=True):
            # 2. Create or Update Client
            client, created = Client.objects.get_or_create(
                agency=agency,
                name="Riphah International University Faisalabad",
                defaults={
                    "industry": "Higher Education & Universities",
                    "target_locations": ["Faisalabad, Pakistan", "Punjab, Pakistan", "Pakistan"],
                    "services": [
                        "Computer Science (BSCS / BSSE)",
                        "Doctor of Physical Therapy (DPT)",
                        "MBBS & Allied Health Sciences",
                        "Business Administration (BBA / MBA)",
                        "Electrical & Software Engineering",
                    ],
                },
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created Client: {client.name}"))
            else:
                self.stdout.write(f"Client already exists: {client.name}")

            # 3. Create or Update Brand
            brand, b_created = Brand.objects.get_or_create(
                agency=agency,
                client=client,
                name="Riphah International University Faisalabad",
                defaults={
                    "aliases": [
                        "Riphah Faisalabad",
                        "Riphah University Faisalabad",
                        "Riphah IU Faisalabad",
                        "Riphah International University",
                        "Riphah",
                    ],
                },
            )
            if b_created:
                self.stdout.write(self.style.SUCCESS(f"Created Brand: {brand.name}"))
            else:
                self.stdout.write(f"Brand already exists: {brand.name}")

            # 4. Create Competitors
            for comp_info in COMPETITORS_DATA:
                comp, c_created = Competitor.objects.get_or_create(
                    agency=agency,
                    client=client,
                    name=comp_info["name"],
                    defaults={
                        "aliases": comp_info["aliases"],
                    },
                )
                if c_created:
                    self.stdout.write(self.style.SUCCESS(f"Created Competitor: {comp.name}"))

            # 5. Create 10 Prompts and Daily Schedule (Oct 6 -> Oct 20)
            start_d = date(2026, 10, 6)
            end_d = date(2026, 10, 20)

            created_prompts = []
            for p_data in PROMPTS_DATA:
                prompt, p_created = Prompt.objects.get_or_create(
                    agency=agency,
                    client=client,
                    text=p_data["text"],
                    defaults={
                        "category": p_data["category"],
                        "service_tags": p_data["service_tags"],
                        "location_tags": p_data["location_tags"],
                        "schedule": Prompt.Schedule.DAILY,
                        "is_active": True,
                    },
                )
                if p_created:
                    self.stdout.write(self.style.SUCCESS(f"Created Prompt: {prompt.text[:60]}..."))

                created_prompts.append(prompt)

            # Create or update single unified campaign schedule for Riphah
            sched, _s_created = PromptSchedule.objects.get_or_create(
                agency=agency,
                client=client,
                brand=brand,
                frequency=PromptSchedule.Frequency.DAILY,
                start_date=start_d,
                end_date=end_d,
                defaults={
                    "providers": [AIProvider.GEMINI],
                    "status": PromptSchedule.Status.ACTIVE,
                    "timezone": "Asia/Karachi",
                },
            )
            sched.prompts.set(created_prompts)
            self.stdout.write(self.style.SUCCESS(f"Assigned all 10 prompts to Daily Schedule ({start_d} to {end_d})"))

            # 6. Execute an initial PromptRun for each of the 10 prompts
            self.stdout.write("Executing initial AI PromptRuns for all 10 prompts...")
            for prompt in created_prompts:
                # Check if a completed run already exists
                existing_run = PromptRun.objects.filter(
                    agency=agency,
                    prompt=prompt,
                    status=PromptRun.Status.COMPLETED
                ).first()

                if not existing_run:
                    run = PromptRun.objects.create(
                        agency=agency,
                        prompt=prompt,
                        prompt_text=prompt.text,
                        provider=AIProvider.GEMINI,
                        status=PromptRun.Status.QUEUED,
                    )
                    execute_prompt_run.apply(args=[str(run.id)])
                    self.stdout.write(self.style.SUCCESS(f"  -> Evaluated: {prompt.text[:50]}..."))

            self.stdout.write(self.style.SUCCESS("All Riphah Faisalabad data successfully seeded and evaluated!"))
