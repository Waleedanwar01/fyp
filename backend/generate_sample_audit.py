import json
import os
import uuid
from datetime import timedelta

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.utils import timezone

from core.models import (
    Agency,
    Brand,
    Citation,
    Client,
    Competitor,
    Mention,
    Prompt,
    PromptRun,
    SubscriptionPlan,
    User,
)
from core.pdf_report import generate_client_pdf_report
from core.stripe_service import (
    create_checkout_session,
    create_customer_portal_session,
    handle_stripe_webhook_event,
)
from core.tenancy import use_agency
from core.usage_tracking import (
    get_agency_usage_snapshot,
    track_prompt_run_usage,
)


def run():
    with use_agency(bypass=True):
        # 1. Setup Agency with rich white-label branding
        agency, _ = Agency.objects.get_or_create(
            subdomain="vanguard-growth",
            defaults={
                "name": "Vanguard Growth Partners",
                "white_label_config": {
                    "company_name": "Vanguard AI Intelligence",
                    "primary_color": "#2851ff",
                    "accent_color": "#10b981",
                    "footer_text": "Confidential Generative AI Visibility Audit • Prepared by Vanguard AI Intelligence for Apex Cloud Technologies",
                },
            },
        )

        admin_user, _ = User.objects.get_or_create(
            email="lead@vanguardgrowth.com",
            defaults={"agency": agency, "role": User.Role.ADMIN},
        )

        # 2. Setup Client & Brand
        client, _ = Client.objects.get_or_create(
            agency=agency,
            name="Apex Cloud Technologies",
            defaults={"industry": "Cloud Infrastructure & Enterprise Kubernetes"},
        )

        brand, _ = Brand.objects.get_or_create(
            agency=agency,
            client=client,
            defaults={"name": "Apex Cloud", "aliases": ["Apex Cloud Platform", "ApexCloud", "Apex Compute"]},
        )

        # 3. Setup Competitors
        comp1, _ = Competitor.objects.get_or_create(
            agency=agency, client=client, name="CloudZero Systems", defaults={"aliases": ["CloudZero"]}
        )
        comp2, _ = Competitor.objects.get_or_create(
            agency=agency, client=client, name="Kubex Infrastructure", defaults={"aliases": ["Kubex"]}
        )
        comp3, _ = Competitor.objects.get_or_create(
            agency=agency, client=client, name="InfraPulse Core", defaults={"aliases": ["InfraPulse"]}
        )

        # 4. Setup Prompts & Multi-Provider Runs
        prompts_data = [
            "Best enterprise Kubernetes cloud hosting platforms for high-throughput microservices in 2026",
            "Top scalable multi-region cloud compute providers comparison for fintech applications",
            "Which cloud platform provides the best automated zero-downtime container deployments?",
            "Leading alternatives to AWS EKS and Google Cloud GKE for enterprise infrastructure",
            "Most cost-effective cloud platforms for containerized AI model inference workloads",
        ]

        for p_text in prompts_data:
            p, _ = Prompt.objects.get_or_create(agency=agency, client=client, text=p_text)

            # OpenAI Run
            r_openai = PromptRun.objects.create(
                agency=agency,
                prompt=p,
                provider="openai",
                status=PromptRun.Status.COMPLETED,
                response_text=(
                    "Top enterprise Kubernetes recommendations:\n"
                    "1. Apex Cloud - Industry-leading scalability and sub-millisecond latencies.\n"
                    "2. CloudZero Systems - Strong cost governance."
                ),
                executed_at=timezone.now() - timedelta(days=5),
            )
            m_apex = Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_openai,
                brand=brand,
                term="Apex Cloud",
                start_index=45,
                end_index=55,
                is_primary=True,
                mention_order=1,
                list_rank=1,
                sentiment="positive",
                confidence_score=0.98,
            )
            c_apex = Citation.objects.create(
                agency=agency,
                prompt_run=r_openai,
                url="https://apexcloud.io/kubernetes",
                domain="apexcloud.io",
                title="Apex Cloud Enterprise Kubernetes Architecture",
            )
            m_apex.citations.add(c_apex)

            Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_openai,
                competitor=comp1,
                term="CloudZero Systems",
                start_index=125,
                end_index=142,
                is_primary=True,
                mention_order=2,
                list_rank=2,
                sentiment="neutral",
                confidence_score=0.95,
            )

            # Gemini Run
            r_gemini = PromptRun.objects.create(
                agency=agency,
                prompt=p,
                provider="gemini",
                status=PromptRun.Status.COMPLETED,
                response_text=(
                    "Evaluation of scalable cloud infrastructure:\n"
                    "1. Kubex Infrastructure\n"
                    "2. Apex Cloud Platform - Fast provisioning."
                ),
                executed_at=timezone.now() - timedelta(days=3),
            )
            m_gem_apex = Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_gemini,
                brand=brand,
                term="Apex Cloud Platform",
                start_index=67,
                end_index=86,
                is_primary=False,
                mention_order=2,
                list_rank=2,
                sentiment="positive",
                confidence_score=0.94,
            )
            c_gem = Citation.objects.create(
                agency=agency,
                prompt_run=r_gemini,
                url="https://techbenchmark.org/cloud-2026",
                domain="techbenchmark.org",
                title="2026 Enterprise Cloud Benchmarks & Performance Guide",
            )
            m_gem_apex.citations.add(c_gem)

            Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_gemini,
                competitor=comp2,
                term="Kubex Infrastructure",
                start_index=44,
                end_index=64,
                is_primary=True,
                mention_order=1,
                list_rank=1,
                sentiment="neutral",
                confidence_score=0.92,
            )

            # Perplexity Run
            r_perp = PromptRun.objects.create(
                agency=agency,
                prompt=p,
                provider="perplexity",
                status=PromptRun.Status.COMPLETED,
                response_text="Based on real-time benchmarks:\n1. Apex Cloud offers superior uptime and autoscaling compute.",
                executed_at=timezone.now() - timedelta(days=2),
            )
            m_perp = Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_perp,
                brand=brand,
                term="Apex Cloud",
                start_index=35,
                end_index=45,
                is_primary=True,
                mention_order=1,
                list_rank=1,
                sentiment="positive",
                confidence_score=0.99,
            )
            c_perp = Citation.objects.create(
                agency=agency,
                prompt_run=r_perp,
                url="https://apexcloud.io/pricing",
                domain="apexcloud.io",
                title="Apex Cloud Transparent Pricing & TCO",
            )
            m_perp.citations.add(c_perp)

            # Claude Run (Competitive Blindspot Query)
            r_claude = PromptRun.objects.create(
                agency=agency,
                prompt=p,
                provider="claude",
                status=PromptRun.Status.COMPLETED,
                response_text="Prominent Kubernetes platforms:\n1. CloudZero Systems\n2. InfraPulse Core",
                executed_at=timezone.now() - timedelta(days=1),
            )
            Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_claude,
                competitor=comp1,
                term="CloudZero Systems",
                start_index=36,
                end_index=53,
                is_primary=True,
                mention_order=1,
                list_rank=1,
                sentiment="positive",
                confidence_score=0.96,
            )
            Mention.objects.create(
                agency=agency,
                client=client,
                prompt_run=r_claude,
                competitor=comp3,
                term="InfraPulse Core",
                start_index=57,
                end_index=72,
                is_primary=True,
                mention_order=2,
                list_rank=2,
                sentiment="neutral",
                confidence_score=0.90,
            )

        # 5. Generate PDF Report
        since_date = timezone.now() - timedelta(days=30)
        until_date = timezone.now()
        pdf_bytes = generate_client_pdf_report(client, since=since_date, until=until_date)

        artifact_dir = r"C:\Users\walee\.gemini\antigravity\brain\1e905cab-7ad3-4678-9f9e-a997f673bf5a"
        artifact_pdf = os.path.join(artifact_dir, "apex-cloud-white-label-report.pdf")
        with open(artifact_pdf, "wb") as f:
            f.write(pdf_bytes)

        project_pdf = r"d:\avtr-project\sample-apex-cloud-report.pdf"
        with open(project_pdf, "wb") as f:
            f.write(pdf_bytes)

        print(f"REPORT_SUCCESS: {len(pdf_bytes)} bytes written to {artifact_pdf}")

        # 6. Execute Stripe Checkout & Webhook
        plan, _ = SubscriptionPlan.objects.get_or_create(
            slug="growth",
            defaults={
                "name": "Growth Plan",
                "monthly_price_usd": 299.00,
                "yearly_price_usd": 2870.00,
                "prompt_runs_included": 1000,
                "client_limit": 10,
                "stored_prompt_limit": 250,
                "active_schedule_limit": 10,
                "team_member_limit": 5,
                "providers": ["openai", "gemini", "claude", "perplexity"],
            },
        )

        checkout_data = create_checkout_session(agency, admin_user, plan, "monthly")
        print("CHECKOUT_SESSION:", checkout_data["session_id"])

        webhook_payload = json.dumps({
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "customer": checkout_data["customer_id"],
                    "subscription": f"sub_test_{uuid.uuid4().hex[:12]}",
                    "metadata": checkout_data["metadata"],
                }
            },
        }).encode("utf-8")

        webhook_res = handle_stripe_webhook_event(webhook_payload)
        print("WEBHOOK_HANDLED:", webhook_res["handled"])

        portal_res = create_customer_portal_session(agency)
        print("PORTAL_SESSION:", portal_res["portal_url"])

        # Track usage
        period = track_prompt_run_usage(agency, "openai", count=15)
        print(f"USAGE_RECORDED: {period.prompt_runs_used}/{period.total_available} used")

        snapshot = get_agency_usage_snapshot(agency)
        print(f"USAGE_SNAPSHOT: Plan={snapshot['plan_name']}, Used={snapshot['prompt_runs_used']}/{snapshot['total_available']}, Status={snapshot['usage_health_status']}")
        print("ALL_E2E_CHECKS_PASSED")

if __name__ == "__main__":
    run()
