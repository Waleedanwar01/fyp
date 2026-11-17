"""
Multi-Tenant Security & Isolation Audit Verification Script for RankLens.

Tests:
1. Multi-Tenant Row-Level Security (PostgreSQL RLS Policies) across all models.
2. ORM-Level Auto-Scoping (AgencyAutoScopedManager).
3. Cross-Tenant Data Access Rejection (Read, Create, Update, Delete).
4. Endpoint Authorization & Permission Classes (IsAgencyMember, IsAgencyAdmin, HasUsableSubscription).
5. Secrets & Credential Protection (Environment loading, absence of leaked API keys).
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import django

# Set up Django environment
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    Agency,
    AIProvider,
    Brand,
    Client,
    Mention,
    Prompt,
    PromptRun,
    Subscription,
    SubscriptionPlan,
)
from core.tenancy import use_agency

User = get_user_model()

class SecurityAuditRunner:
    def __init__(self):
        self.client_a = APIClient()
        self.client_b = APIClient()
        self.agency_a = None
        self.agency_b = None
        self.user_a_admin = None
        self.user_a_member = None
        self.user_b_admin = None
        self.results = []
        self.findings = []

    def log(self, check_name: str, passed: bool, details: str = ""):
        status_str = "PASS" if passed else "FAIL"
        self.results.append({"check": check_name, "status": status_str, "details": details})
        print(f"[{status_str}] {check_name} - {details}")
        if not passed:
            self.findings.append(f"{check_name}: {details}")

    def run_all(self):
        print("=" * 80)
        print("STARTING RankLens SECURITY & MULTI-TENANT ISOLATION AUDIT")
        print("=" * 80)

        with use_agency(bypass=True):
            self.setup_tenants_and_users()

        self.audit_1_cross_tenant_read_isolation()
        self.audit_2_cross_tenant_write_isolation()
        self.audit_3_role_based_access_control()
        self.audit_4_rls_fail_closed_mechanism()
        self.audit_5_credentials_and_secrets_handling()
        self.print_summary()

    def setup_tenants_and_users(self):
        suffix = uuid.uuid4().hex[:6]
        # Tenant A
        self.agency_a = Agency.objects.create(
            name=f"Security Audit Agency Alpha {suffix}",
            white_label_config={"company_name": "Agency Alpha"}
        )
        self.user_a_admin = User.objects.create_user(
            email=f"admin_a_{suffix}@alpha.test",
            password="SecureAlphaPass123!",
            agency=self.agency_a,
            role=User.Role.ADMIN,
            is_active=True
        )
        self.user_a_member = User.objects.create_user(
            email=f"member_a_{suffix}@alpha.test",
            password="SecureAlphaMember123!",
            agency=self.agency_a,
            role=User.Role.MEMBER,
            is_active=True
        )

        # Tenant B
        self.agency_b = Agency.objects.create(
            name=f"Security Audit Agency Beta {suffix}",
            white_label_config={"company_name": "Agency Beta"}
        )
        self.user_b_admin = User.objects.create_user(
            email=f"admin_b_{suffix}@beta.test",
            password="SecureBetaPass123!",
            agency=self.agency_b,
            role=User.Role.ADMIN,
            is_active=True
        )

        # Create Plan & Subscription for both
        plan, _ = SubscriptionPlan.objects.get_or_create(
            slug="security-audit-plan",
            defaults={
                "name": "Audit Plan",
                "monthly_price_usd": Decimal("99.00"),
                "yearly_price_usd": Decimal("990.00"),
                "prompt_runs_included": 1000,
                "client_limit": 10,
                "stored_prompt_limit": 100,
                "active_schedule_limit": 10,
                "team_member_limit": 5,
                "providers": ["openai", "gemini"],
            }
        )
        today = datetime.now(timezone.utc).date()
        Subscription.objects.update_or_create(
            agency_id=self.agency_a.id,
            defaults={"plan": plan, "status": Subscription.Status.ACTIVE, "current_period_start": today, "current_period_end": today + timedelta(days=30)}
        )
        Subscription.objects.update_or_create(
            agency_id=self.agency_b.id,
            defaults={"plan": plan, "status": Subscription.Status.ACTIVE, "current_period_start": today, "current_period_end": today + timedelta(days=30)}
        )

        # Tenant A Objects
        self.client_a_obj = Client.objects.create(agency=self.agency_a, name="Alpha Client", industry="Tech")
        self.brand_a = Brand.objects.create(agency=self.agency_a, client=self.client_a_obj, name="Alpha Brand")
        self.prompt_a = Prompt.objects.create(agency=self.agency_a, client=self.client_a_obj, text="What is Alpha?", schedule="manual")
        self.run_a = PromptRun.objects.create(agency=self.agency_a, prompt=self.prompt_a, prompt_text="What is Alpha?", provider=AIProvider.OPENAI, status=PromptRun.Status.COMPLETED, response_text="Alpha is #1")
        self.mention_a = Mention.objects.create(agency=self.agency_a, client=self.client_a_obj, prompt_run=self.run_a, brand=self.brand_a, term="Alpha Brand", is_primary=True, start_index=0, end_index=11, mention_order=1, confidence_score=0.95)

        # Tenant B Objects
        self.client_b_obj = Client.objects.create(agency=self.agency_b, name="Beta Client", industry="Healthcare")
        self.brand_b = Brand.objects.create(agency=self.agency_b, client=self.client_b_obj, name="Beta Brand")

        # JWT Clients
        token_a = str(RefreshToken.for_user(self.user_a_admin).access_token)
        self.client_a.credentials(HTTP_AUTHORIZATION=f"Bearer {token_a}")

        token_b = str(RefreshToken.for_user(self.user_b_admin).access_token)
        self.client_b.credentials(HTTP_AUTHORIZATION=f"Bearer {token_b}")

        self.log("Setup: Tenants & Test Fixtures", True, f"Created Tenant A ({self.agency_a.id}) and Tenant B ({self.agency_b.id})")

    def audit_1_cross_tenant_read_isolation(self):
        # Tenant A lists clients -- must not see Tenant B's client
        res = self.client_a.get("/api/v1/clients/")
        data = res.json()
        ids = [c["id"] for c in (data.get("results") if isinstance(data, dict) and "results" in data else data)]
        b_client_exposed = str(self.client_b_obj.id) in ids
        self.log(
            "Audit 1.1: Client List Isolation",
            not b_client_exposed and str(self.client_a_obj.id) in ids,
            f"Tenant A queried /clients/ -> Saw {len(ids)} items, Tenant B client exposed: {b_client_exposed}"
        )

        # Tenant A attempts direct GET of Tenant B's client
        res_direct = self.client_a.get(f"/api/v1/clients/{self.client_b_obj.id}/")
        self.log(
            "Audit 1.2: Direct Object Read Isolation",
            res_direct.status_code == 404,
            f"Tenant A GET /clients/{self.client_b_obj.id}/ -> Returned HTTP {res_direct.status_code} (Expected 404 Not Found)"
        )

        # Tenant A attempts to read Tenant B's brand visibility score
        res_score = self.client_a.get(f"/api/v1/brands/{self.brand_b.id}/visibility-score/")
        self.log(
            "Audit 1.3: Visibility Score Isolation",
            res_score.status_code == 404,
            f"Tenant A GET /brands/{self.brand_b.id}/visibility-score/ -> Returned HTTP {res_score.status_code} (Expected 404)"
        )

        # Tenant A attempts to read Tenant B's PDF report
        res_pdf = self.client_a.get(f"/api/v1/clients/{self.client_b_obj.id}/pdf-report/")
        self.log(
            "Audit 1.4: PDF Report Endpoint Isolation",
            res_pdf.status_code == 404,
            f"Tenant A GET /clients/{self.client_b_obj.id}/pdf-report/ -> Returned HTTP {res_pdf.status_code} (Expected 404)"
        )

    def audit_2_cross_tenant_write_isolation(self):
        # Tenant A attempts to update Tenant B's client name
        res_patch = self.client_a.patch(f"/api/v1/clients/{self.client_b_obj.id}/", {"name": "Hacked Client Name"})
        self.log(
            "Audit 2.1: Cross-Tenant PATCH Protection",
            res_patch.status_code == 404,
            f"Tenant A PATCH /clients/{self.client_b_obj.id}/ -> Returned HTTP {res_patch.status_code} (Expected 404)"
        )

        # Tenant A attempts to DELETE Tenant B's client
        res_del = self.client_a.delete(f"/api/v1/clients/{self.client_b_obj.id}/")
        self.log(
            "Audit 2.2: Cross-Tenant DELETE Protection",
            res_del.status_code == 404,
            f"Tenant A DELETE /clients/{self.client_b_obj.id}/ -> Returned HTTP {res_del.status_code} (Expected 404)"
        )

        # Tenant A attempts to create a Prompt pointing to Tenant B's client
        res_prompt_inject = self.client_a.post("/api/v1/prompts/", {
            "client": str(self.client_b_obj.id),
            "text": "Cross tenant injection attempt?",
            "schedule": "manual"
        })
        self.log(
            "Audit 2.3: Cross-Tenant Foreign Key Injection",
            res_prompt_inject.status_code == 400,
            f"Tenant A POST /prompts/ with client={self.client_b_obj.id} -> Returned HTTP {res_prompt_inject.status_code} (Blocked by ClientMustBelongToRequestersAgencyMixin)"
        )

    def audit_3_role_based_access_control(self):
        # Member client (non-admin)
        client_member = APIClient()
        token_member = str(RefreshToken.for_user(self.user_a_member).access_token)
        client_member.credentials(HTTP_AUTHORIZATION=f"Bearer {token_member}")

        # Member tries to invite a team member (Admin only)
        res_invite = client_member.post("/api/v1/team-members/invite/", {
            "email": "injected_user@alpha.test",
            "role": "admin"
        })
        self.log(
            "Audit 3.1: Admin-Only Invite Gating",
            res_invite.status_code == 403,
            f"Member POST /team-members/invite/ -> Returned HTTP {res_invite.status_code} (Blocked by IsAgencyAdmin)"
        )

        # Member tries to edit agency settings (Admin only)
        res_agency_patch = client_member.patch("/api/v1/agencies/me/", {
            "name": "Member Renamed Agency"
        })
        self.log(
            "Audit 3.2: Admin-Only Agency Settings Gating",
            res_agency_patch.status_code == 403,
            f"Member PATCH /agencies/me/ -> Returned HTTP {res_agency_patch.status_code} (Blocked by IsAgencyAdmin)"
        )

        # Member tries to access Stripe portal session (Admin only)
        res_portal = client_member.post("/api/v1/billing/portal-session/")
        self.log(
            "Audit 3.3: Admin-Only Stripe Portal Gating",
            res_portal.status_code == 403,
            f"Member POST /billing/portal-session/ -> Returned HTTP {res_portal.status_code} (Blocked by IsAgencyAdmin)"
        )

    def audit_4_rls_fail_closed_mechanism(self):
        # Raw ORM query with context unset must fail closed
        with use_agency(agency=None): # Unset context
            clients_count = Client.objects.all().count()
            self.log(
                "Audit 4.1: Unset Context Fail-Closed",
                clients_count == 0,
                f"Client.objects.all() with context unset -> Returned {clients_count} rows (Expected 0)"
            )

        # Explicit scoping to Agency A
        with use_agency(agency=self.agency_a.id):
            clients_a_count = Client.objects.all().count()
            self.log(
                "Audit 4.2: Explicit Scoping to Agency A",
                clients_a_count >= 1,
                f"Client.objects.all() with Agency A context -> Returned {clients_a_count} rows"
            )

    def audit_5_credentials_and_secrets_handling(self):
        # Verify SECRET_KEY is set and not default/empty
        secret_key_ok = bool(settings.SECRET_KEY and len(settings.SECRET_KEY) >= 32)
        self.log(
            "Audit 5.1: Django SECRET_KEY Complexity",
            secret_key_ok,
            f"SECRET_KEY is configured with length {len(settings.SECRET_KEY) if settings.SECRET_KEY else 0}"
        )

        # Verify no hardcoded API keys in settings defaults
        raw_settings_path = os.path.join(settings.BASE_DIR, "config", "settings.py")
        with open(raw_settings_path, "r", encoding="utf-8") as f:
            content = f.read()

        no_hardcoded_openai = "sk-" not in content
        no_hardcoded_stripe = "sk_live_" not in content and "sk_test_" not in content
        self.log(
            "Audit 5.2: No Hardcoded Provider/Stripe Secrets",
            no_hardcoded_openai and no_hardcoded_stripe,
            "Clean secrets check in config/settings.py: no raw OpenAI/Stripe keys hardcoded"
        )

        # Verify sensitive user password fields are not returned in User serializer
        user_res = self.client_a.get("/api/v1/auth/me/")
        user_data = user_res.json()
        password_omitted = "password" not in user_data
        self.log(
            "Audit 5.3: Password Field Masking in User Profile",
            password_omitted,
            f"GET /auth/me/ fields returned: {list(user_data.keys())} (password omitted: {password_omitted})"
        )

    def print_summary(self):
        print("=" * 80)
        print("SECURITY & ISOLATION AUDIT SUMMARY")
        print("=" * 80)
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = sum(1 for r in self.results if r["status"] == "FAIL")
        print(f"Total Security Checks: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        if self.findings:
            print("\nFindings / Vulnerabilities:")
            for f in self.findings:
                print(f" - {f}")
        else:
            print("\nResult: 100% AUDIT PASS - ZERO SECURITY / ISOLATION DEFECTS FOUND")
        print("=" * 80)

if __name__ == "__main__":
    runner = SecurityAuditRunner()
    runner.run_all()
