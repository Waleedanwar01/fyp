import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import serializers, status
from rest_framework.test import APIClient, APIRequestFactory, APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from . import tasks
from .ai_providers import (
    AIProviderError,
    GeminiProviderClient,
    OpenAIProviderClient,
    TransientAIProviderError,
    UnimplementedProviderClient,
    default_manual_provider,
    get_provider_client,
)
from .billing import (
    close_billing_period,
    estimate_usage,
    get_or_create_current_billing_period,
    schedule_due_today_pending,
    today_reserved_prompt_runs,
    usage_status,
)
from .citations import extract_citations, normalize_domain, store_citations
from .matching import (
    compute_match_confidence,
    find_name_mentions,
    list_rank_at,
    name_is_mentioned,
)
from .mention_citations import link_mention_citations
from .mention_detection import detect_mentions
from .models import (
    Agency,
    AIProvider,
    BillingPeriodUsage,
    Brand,
    Citation,
    Client,
    Competitor,
    Mention,
    Notification,
    PlanConfigAuditLog,
    Prompt,
    PromptRun,
    PromptSchedule,
    Subscription,
    SubscriptionPlan,
    Testimonial,
    User,
)
from .permissions import IsAgencyMember
from .prompt_building import build_effective_prompt
from .scheduling import calculate_schedule_dates
from .sentiment import (
    classify_sentiment,
    classify_sentiment_rule_based,
    extract_context_window,
)
from .serializers import BrandSerializer, CompetitorSerializer, PromptSerializer
from .tenancy import use_agency
from .views import CustomTokenObtainPairView
from .visibility_score import (
    CITATION_SCORE_WEIGHT,
    MENTION_RATE_WEIGHT,
    POSITION_SCORE_WEIGHT,
    SENTIMENT_SCORE_WEIGHT,
    compute_visibility_score,
    visibility_score_evidence,
)

# ---------------------------------------------------------------------
# Shared fixture helpers for the subscription/scheduling test classes
# below -- every class that needs "an agency with a real subscription"
# builds it the same way, so isolation-mode agencies (already set up
# in ApiCrossAgencyIsolationTests etc.) aren't affected.
# ---------------------------------------------------------------------


def _make_plan(slug="growth", **overrides):
    defaults = {
        "name": slug.title(),
        "monthly_price_usd": Decimal(149),
        "yearly_price_usd": Decimal(1430),
        "prompt_runs_included": 600,
        "client_limit": 10,
        "stored_prompt_limit": 2000,
        "active_schedule_limit": 50,
        "team_member_limit": 5,
        "providers": [AIProvider.OPENAI, AIProvider.GEMINI],
    }
    defaults.update(overrides)
    return SubscriptionPlan.objects.create(slug=slug, **defaults)


def _make_subscription(agency, plan, **overrides):
    defaults = {
        "billing_interval": Subscription.BillingInterval.MONTHLY,
        "status": Subscription.Status.ACTIVE,
        "current_period_start": date(2026, 8, 13),
        "current_period_end": date(2026, 9, 12),
    }
    defaults.update(overrides)
    with use_agency(agency):
        return Subscription.objects.create(agency=agency, plan=plan, **defaults)


def _fake_billing_period(base=200, rollover=0, used=0, period_end=date(2026, 9, 12)):
    """A duck-typed stand-in for BillingPeriodUsage -- estimate_usage()
    only ever reads plain attributes off it, never queries the DB, so
    tests of the pure estimation math don't need a real fixture."""
    return SimpleNamespace(
        base_prompt_run_allowance=base,
        rollover_received=rollover,
        total_available=base + rollover,
        prompt_runs_used=used,
        period_end=period_end,
    )

request_factory = APIRequestFactory()


class UserManagerTests(TestCase):
    def test_create_user_requires_email(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(email="", password="pw12345")

    def test_create_user_normalizes_email_domain_and_sets_password(self):
        user = User.objects.create_user(email="Member@Example.COM", password="pw12345")
        self.assertEqual(user.email, "Member@example.com")
        self.assertTrue(user.check_password("pw12345"))

    def test_create_superuser_defaults_to_admin_role_and_staff_flags(self):
        user = User.objects.create_superuser(email="root@platform.test", password="pw12345")
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.role, User.Role.ADMIN)

    def test_create_superuser_rejects_is_staff_false(self):
        with self.assertRaises(ValueError):
            User.objects.create_superuser(email="root2@platform.test", password="pw12345", is_staff=False)


class AgencyScopedQuerySetTests(TestCase):
    def setUp(self):
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.user_a1 = User.objects.create_user(email="a1@a.test", password="pw12345", agency=self.agency_a)
        self.user_a2 = User.objects.create_user(email="a2@a.test", password="pw12345", agency=self.agency_a)
        self.user_b1 = User.objects.create_user(email="b1@b.test", password="pw12345", agency=self.agency_b)
        self.superuser = User.objects.create_superuser(email="root@platform.test", password="pw12345")

    def test_for_user_scopes_results_to_own_agency(self):
        emails = set(User.objects.for_user(self.user_a1).values_list("email", flat=True))
        self.assertEqual(emails, {"a1@a.test", "a2@a.test"})

    def test_for_user_never_leaks_other_agency_rows(self):
        emails = set(User.objects.for_user(self.user_b1).values_list("email", flat=True))
        self.assertNotIn("a1@a.test", emails)
        self.assertNotIn("a2@a.test", emails)

    def test_for_user_superuser_bypasses_scope(self):
        scoped_ids = set(User.objects.for_user(self.superuser).values_list("id", flat=True))
        all_ids = set(User.objects.values_list("id", flat=True))
        self.assertEqual(scoped_ids, all_ids)


class IsAgencyMemberTests(TestCase):
    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        self.other_agency = Agency.objects.create(name="Other")
        self.member = User.objects.create_user(email="member@acme.test", password="pw12345", agency=self.agency)
        self.platform_superuser = User.objects.create_superuser(email="root@platform.test", password="pw12345")
        self.permission = IsAgencyMember()

    def _request_as(self, user):
        request = request_factory.get("/")
        request.user = user
        return request

    def test_agency_member_has_permission(self):
        self.assertTrue(self.permission.has_permission(self._request_as(self.member), None))

    def test_superuser_without_agency_denied(self):
        self.assertFalse(self.permission.has_permission(self._request_as(self.platform_superuser), None))

    def test_anonymous_user_denied(self):
        self.assertFalse(self.permission.has_permission(self._request_as(AnonymousUser()), None))

    def test_object_permission_allows_matching_agency(self):
        obj = SimpleNamespace(agency_id=self.agency.id)
        self.assertTrue(self.permission.has_object_permission(self._request_as(self.member), None, obj))

    def test_object_permission_rejects_other_agency(self):
        obj = SimpleNamespace(agency_id=self.other_agency.id)
        self.assertFalse(self.permission.has_object_permission(self._request_as(self.member), None, obj))


class TenantScopedModelsTests(TestCase):
    """Every Client/Brand/Competitor/Prompt row carries its own `agency` FK
    (not just a transitive link via client) — confirms the isolation
    guarantee holds for the new schema, not just for User."""

    def setUp(self):
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.owner_a = User.objects.create_user(email="owner-a@a.test", password="pw12345", agency=self.agency_a)
        self.owner_b = User.objects.create_user(email="owner-b@b.test", password="pw12345", agency=self.agency_b)

        # Direct ORM writes to these four tables are outside any request,
        # so nothing has established an RLS session context yet -- bypass
        # is the trusted-script equivalent of a platform superuser here.
        with use_agency(bypass=True):
            self.client_a = Client.objects.create(agency=self.agency_a, name="Client A", industry="Retail")
            self.brand_a = Brand.objects.create(agency=self.agency_a, client=self.client_a, name="Client A Brand")
            self.competitor_a = Competitor.objects.create(agency=self.agency_a, client=self.client_a, name="Rival A")
            self.prompt_a = Prompt.objects.create(
                agency=self.agency_a, client=self.client_a, text="Best retailer nearby"
            )

            self.client_b = Client.objects.create(agency=self.agency_b, name="Client B", industry="Legal")
            Brand.objects.create(agency=self.agency_b, client=self.client_b, name="Client B Brand")
            Competitor.objects.create(agency=self.agency_b, client=self.client_b, name="Rival B")
            Prompt.objects.create(agency=self.agency_b, client=self.client_b, text="Best law firm nearby")

    def test_clients_scoped_to_owning_agency(self):
        # bypass here so RLS lets both agencies' rows through at the DB
        # level -- what's under test is `.for_user()`'s own filtering,
        # in isolation from RLS (which has its own dedicated tests below).
        with use_agency(bypass=True):
            self.assertEqual(list(Client.objects.for_user(self.owner_a)), [self.client_a])
            self.assertEqual(list(Client.objects.for_user(self.owner_b)), [self.client_b])

    def test_brands_competitors_prompts_scoped_to_owning_agency(self):
        with use_agency(bypass=True):
            self.assertEqual(list(Brand.objects.for_user(self.owner_a)), [self.brand_a])
            self.assertEqual(list(Competitor.objects.for_user(self.owner_a)), [self.competitor_a])
            self.assertEqual(list(Prompt.objects.for_user(self.owner_a)), [self.prompt_a])

    def test_client_brand_is_one_to_one(self):
        # transaction.atomic() here creates a savepoint, so the expected
        # IntegrityError only rolls back this one insert rather than
        # poisoning the whole test's transaction (Postgres aborts the
        # entire transaction on error unless it's savepoint-scoped).
        with use_agency(self.agency_a), self.assertRaises(IntegrityError), transaction.atomic():
            Brand.objects.create(agency=self.agency_a, client=self.client_a, name="Duplicate brand")


class LoginThrottleConfigTests(TestCase):
    def test_login_view_uses_login_throttle_scope(self):
        self.assertEqual(CustomTokenObtainPairView.throttle_scope, "login")


class AuthFlowTests(APITestCase):
    def setUp(self):
        # The login endpoint's ScopedRateThrottle tracks request counts in
        # Django's cache, which isn't reset by the per-test DB rollback --
        # without this, enough tests logging in eventually trip "5/min"
        # and every test after that gets a spurious 429.
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.client = APIClient()

    def _login(self):
        response = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        return response.data

    def test_login_returns_tokens_with_custom_claims(self):
        response = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_login_rejects_wrong_password(self):
        response = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": "wrong"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_requires_authentication(self):
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_current_user_and_agency(self):
        tokens = self._login()
        response = self.client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "member@acme.test")
        self.assertEqual(response.data["agency"]["id"], str(self.agency.id))

    def test_refresh_rotates_token_and_blacklists_old_one(self):
        tokens = self._login()
        old_refresh = tokens["refresh"]

        refresh_response = self.client.post("/api/v1/auth/token/refresh/", {"refresh": old_refresh}, format="json")
        self.assertEqual(refresh_response.status_code, status.HTTP_200_OK)
        self.assertNotEqual(refresh_response.data["refresh"], old_refresh)

        reuse_response = self.client.post("/api/v1/auth/token/refresh/", {"refresh": old_refresh}, format="json")
        self.assertEqual(reuse_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_blacklist_invalidates_refresh_token(self):
        tokens = self._login()

        blacklist_response = self.client.post(
            "/api/v1/auth/token/blacklist/", {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(blacklist_response.status_code, status.HTTP_200_OK)

        reuse_response = self.client.post(
            "/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(reuse_response.status_code, status.HTTP_401_UNAUTHORIZED)


class RegisterFlowTests(APITestCase):
    def setUp(self):
        cache.clear()  # see AuthFlowTests.setUp -- avoids spurious 429s from the register throttle
        self.plan = _make_plan(slug="register-flow-plan")

    def test_register_creates_inactive_agency_admin_and_sends_verification_email(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        user = User.objects.get(email="owner@new-agency.test")
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertEqual(user.agency.name, "New Agency")
        self.assertTrue(user.check_password("correct-horse-battery-staple"))
        self.assertFalse(user.is_active)

        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("owner@new-agency.test", mail.outbox[0].to)

        # AVTR_SPEC follow-up: signup records the chosen plan as a
        # PENDING subscription (no Stripe yet) -- not usable until an
        # admin manually activates it (see HasUsableSubscription).
        with use_agency(bypass=True):
            subscription = Subscription.objects.get(agency=user.agency)
        self.assertEqual(subscription.plan_id, self.plan.id)
        self.assertEqual(subscription.status, Subscription.Status.PENDING)
        self.assertFalse(subscription.is_usable())

    def test_unverified_account_cannot_log_in(self):
        self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        response = self.client.post(
            "/api/v1/auth/token/",
            {"email": "owner@new-agency.test", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_register_hashes_password_rather_than_storing_plaintext(self):
        self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        user = User.objects.get(email="owner@new-agency.test")
        self.assertNotEqual(user.password, "correct-horse-battery-staple")
        self.assertTrue(user.password.startswith("pbkdf2_"))

    def test_register_rejects_duplicate_email(self):
        agency = Agency.objects.create(name="Existing Agency")
        User.objects.create_user(email="taken@example.test", password="pw1234567", agency=agency)

        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "Another Agency",
                "email": "taken@example.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data)

    def test_register_rejects_weak_password(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "12345678",
                "plan": self.plan.slug,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(email="owner@new-agency.test").exists())

    def test_register_rejects_missing_fields(self):
        response = self.client.post("/api/v1/auth/register/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("agency_name", response.data)
        self.assertIn("email", response.data)
        self.assertIn("password", response.data)
        self.assertIn("plan", response.data)

    def test_register_rejects_unknown_plan_slug(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": "not-a-real-plan",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("plan", response.data)

    def test_register_rejects_inactive_plan(self):
        inactive_plan = _make_plan(slug="inactive-register-plan", is_active=False)
        response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": inactive_plan.slug,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("plan", response.data)

    def test_register_defaults_to_monthly_billing_interval(self):
        self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        with use_agency(bypass=True):
            subscription = Subscription.objects.get(agency__name="New Agency")
        self.assertEqual(subscription.billing_interval, Subscription.BillingInterval.MONTHLY)

    def test_register_honors_yearly_billing_interval(self):
        self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "New Agency",
                "email": "owner@new-agency.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
                "billing_interval": "yearly",
            },
            format="json",
        )
        with use_agency(bypass=True):
            subscription = Subscription.objects.get(agency__name="New Agency")
        self.assertEqual(subscription.billing_interval, Subscription.BillingInterval.YEARLY)


class EmailVerificationFlowTests(APITestCase):
    def setUp(self):
        cache.clear()  # see AuthFlowTests.setUp -- avoids spurious 429s from the email_verification throttle
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, is_active=False
        )

    def _valid_uid_and_token(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = default_token_generator.make_token(self.user)
        return uid, token

    def test_verify_with_valid_token_activates_account_and_returns_tokens(self):
        uid, token = self._valid_uid_and_token()
        response = self.client.post("/api/v1/auth/verify-email/", {"uid": uid, "token": token}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_verified_account_can_then_log_in(self):
        uid, token = self._valid_uid_and_token()
        self.client.post("/api/v1/auth/verify-email/", {"uid": uid, "token": token}, format="json")

        response = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_verify_rejects_invalid_token(self):
        uid, _ = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/verify-email/", {"uid": uid, "token": "not-a-real-token"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

    def test_verify_rejects_invalid_uid(self):
        _, token = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/verify-email/", {"uid": "not-a-real-uid", "token": token}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resend_for_unverified_account_sends_new_email(self):
        response = self.client.post(
            "/api/v1/auth/resend-verification/", {"email": "member@acme.test"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("member@acme.test", mail.outbox[0].to)

    def test_resend_for_already_verified_account_returns_200_without_sending(self):
        self.user.is_active = True
        self.user.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/v1/auth/resend-verification/", {"email": "member@acme.test"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_resend_for_unknown_email_returns_200_without_sending(self):
        response = self.client.post(
            "/api/v1/auth/resend-verification/", {"email": "nobody@example.test"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)


class PasswordResetFlowTests(APITestCase):
    def setUp(self):
        cache.clear()  # see AuthFlowTests.setUp -- avoids spurious 429s from the password_reset throttle
        self.agency = Agency.objects.create(name="Acme")
        self.old_password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(email="member@acme.test", password=self.old_password, agency=self.agency)

    def _valid_uid_and_token(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = default_token_generator.make_token(self.user)
        return uid, token

    def test_request_for_existing_email_sends_reset_email(self):
        response = self.client.post("/api/v1/auth/password-reset/", {"email": "member@acme.test"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("member@acme.test", mail.outbox[0].to)

    def test_request_for_unknown_email_returns_200_without_sending_email(self):
        response = self.client.post(
            "/api/v1/auth/password-reset/", {"email": "nobody@example.test"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_confirm_with_valid_token_changes_password(self):
        uid, token = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("a-brand-new-passphrase"))
        self.assertFalse(self.user.check_password(self.old_password))

    def test_confirm_allows_login_with_new_password_afterwards(self):
        uid, token = self._valid_uid_and_token()
        self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        response = self.client.post(
            "/api/v1/auth/token/",
            {"email": "member@acme.test", "password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_confirm_rejects_invalid_token(self):
        uid, _ = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": "not-a-real-token", "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.old_password))

    def test_confirm_rejects_invalid_uid(self):
        _, token = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": "not-a-real-uid", "token": token, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_rejects_token_after_password_already_changed(self):
        uid, token = self._valid_uid_and_token()
        self.user.set_password("something-else-entirely")
        self.user.save(update_fields=["password"])

        response = self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_rejects_weak_new_password(self):
        uid, token = self._valid_uid_and_token()
        response = self.client.post(
            "/api/v1/auth/password-reset/confirm/",
            {"uid": uid, "token": token, "new_password": "12345678"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.old_password))


class AuthRateLimitTests(APITestCase):
    """DEFAULT_THROTTLE_RATES (settings.py): login=5/min, register=5/min,
    password_reset=3/min. ScopedRateThrottle keys anonymous requests by
    client IP, so repeated requests from the same test client share one
    counter -- exactly the credential-stuffing/spam scenario throttling
    defends against."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(email="member@acme.test", password=self.password, agency=self.agency)

    def test_login_is_throttled_after_five_attempts_per_minute(self):
        # A distinct, nonexistent email per attempt so this only exercises
        # the per-IP throttle -- not the per-account lockout below, which
        # would otherwise kick in first at the 3rd attempt for a single
        # account and mask what this test is checking.
        for i in range(5):
            response = self.client.post(
                "/api/v1/auth/token/", {"email": f"nouser{i}@acme.test", "password": "wrong"}, format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        sixth = self.client.post(
            "/api/v1/auth/token/", {"email": "nouser5@acme.test", "password": "wrong"}, format="json"
        )
        self.assertEqual(sixth.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_register_is_throttled_after_five_attempts_per_minute(self):
        for _ in range(5):
            response = self.client.post("/api/v1/auth/register/", {}, format="json")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        sixth = self.client.post("/api/v1/auth/register/", {}, format="json")
        self.assertEqual(sixth.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_password_reset_is_throttled_after_three_attempts_per_minute(self):
        for _ in range(3):
            response = self.client.post(
                "/api/v1/auth/password-reset/", {"email": "member@acme.test"}, format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        fourth = self.client.post("/api/v1/auth/password-reset/", {"email": "member@acme.test"}, format="json")
        self.assertEqual(fourth.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_resend_verification_is_throttled_after_three_attempts_per_minute(self):
        for _ in range(3):
            response = self.client.post(
                "/api/v1/auth/resend-verification/", {"email": "member@acme.test"}, format="json"
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        fourth = self.client.post(
            "/api/v1/auth/resend-verification/", {"email": "member@acme.test"}, format="json"
        )
        self.assertEqual(fourth.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class AccountLockoutTests(APITestCase):
    """Per-account failed-attempt lockout, independent of the per-IP
    throttle above: MAX_LOGIN_ATTEMPTS (3) wrong passwords in a row locks
    that account out for LOGIN_LOCKOUT_SECONDS (10 min), regardless of the
    per-IP 5/min budget still having room left."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(email="member@acme.test", password=self.password, agency=self.agency)

    def _wrong_login(self):
        return self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": "wrong"}, format="json"
        )

    def test_wrong_password_returns_generic_message_with_remaining_attempts_warning(self):
        response = self._wrong_login()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["detail"], "Invalid email or password.")
        self.assertIn("2 attempts remaining", response.data["warning"])

    def test_third_wrong_attempt_locks_the_account(self):
        self._wrong_login()
        self._wrong_login()
        third = self._wrong_login()
        self.assertEqual(third.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("locked", third.data["detail"])

    def test_locked_account_rejects_even_the_correct_password(self):
        self._wrong_login()
        self._wrong_login()
        self._wrong_login()

        response = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_successful_login_resets_the_failed_attempt_counter(self):
        self._wrong_login()
        self._wrong_login()

        success = self.client.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(success.status_code, status.HTTP_200_OK)

        # Back to a clean slate: two more wrong attempts shouldn't trip the lockout.
        first = self._wrong_login()
        second = self._wrong_login()
        self.assertEqual(first.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(second.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_wrong_password_and_unverified_account_return_the_same_message(self):
        """Neither failure path should let a caller distinguish 'account
        doesn't exist / wrong password' from 'account exists but isn't
        verified yet' -- both are credential-stuffing-relevant signals."""
        plan = _make_plan(slug="lockout-flow-plan")
        self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "Other Agency",
                "email": "unverified@acme.test",
                "password": "correct-horse-battery-staple",
                "plan": plan.slug,
            },
            format="json",
        )
        unverified_response = self.client.post(
            "/api/v1/auth/token/",
            {"email": "unverified@acme.test", "password": "correct-horse-battery-staple"},
            format="json",
        )
        wrong_password_response = self._wrong_login()

        self.assertEqual(unverified_response.data["detail"], wrong_password_response.data["detail"])


class SessionAbsoluteTimeoutTests(APITestCase):
    """A session must end 24 hours after login no matter how active it is --
    ROTATE_REFRESH_TOKENS alone can't do this (each rotation just pushes
    REFRESH_TOKEN_LIFETIME further out), so this is enforced by stamping a
    `session_start` claim at login and checking it on every refresh (see
    CustomTokenRefreshSerializer). Tokens are tampered with directly here
    (rather than mocking global time) to simulate 24+ hours having passed
    since login without needing a time-freezing dependency."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.api = APIClient()

    def _login(self):
        return self.api.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )

    def test_login_stamps_a_recent_session_start(self):
        response = self._login()
        refresh = RefreshToken(response.data["refresh"])
        self.assertIn("session_start", refresh.payload)
        started_at = timezone.datetime.fromtimestamp(refresh.payload["session_start"], tz=UTC)
        self.assertLess(timezone.now() - started_at, timedelta(seconds=10))

    def test_refresh_succeeds_within_24_hours_of_login(self):
        login_response = self._login()
        refresh_response = self.api.post(
            "/api/v1/auth/token/refresh/", {"refresh": login_response.data["refresh"]}, format="json"
        )
        self.assertEqual(refresh_response.status_code, status.HTTP_200_OK)

    def test_refresh_rejected_once_24_hours_have_passed_since_login(self):
        login_response = self._login()
        token = RefreshToken(login_response.data["refresh"])
        token["session_start"] = int((timezone.now() - timedelta(hours=25)).timestamp())

        refresh_response = self.api.post("/api/v1/auth/token/refresh/", {"refresh": str(token)}, format="json")
        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_rotation_preserves_session_start_across_multiple_refreshes(self):
        login_response = self._login()
        original_start = RefreshToken(login_response.data["refresh"]).payload["session_start"]

        refresh_token = login_response.data["refresh"]
        for _ in range(3):
            response = self.api.post("/api/v1/auth/token/refresh/", {"refresh": refresh_token}, format="json")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            refresh_token = response.data["refresh"]

        rotated_start = RefreshToken(refresh_token).payload["session_start"]
        self.assertEqual(rotated_start, original_start)


class AgencyManagementTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.member = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_authenticated_agency_less_user_can_create_agency_and_becomes_admin(self):
        agency_less = User.objects.create_user(email="solo@example.test", password=self.password)
        self.api.credentials()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "solo@example.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

        create_response = self.api.post("/api/v1/agencies/", {"name": "New Co"}, format="json")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        agency_less.refresh_from_db()
        self.assertEqual(agency_less.agency.name, "New Co")
        self.assertEqual(agency_less.role, User.Role.ADMIN)

    def test_user_who_already_has_agency_cannot_create_another(self):
        self._login_as("admin@acme.test")
        response = self.api.post("/api/v1/agencies/", {"name": "Second Co"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_member_can_view_own_agency(self):
        self._login_as("member@acme.test")
        response = self.api.get("/api/v1/agencies/me/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Acme")

    def test_admin_can_update_agency_settings(self):
        self._login_as("admin@acme.test")
        response = self.api.patch("/api/v1/agencies/me/", {"name": "Acme Renamed"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.agency.refresh_from_db()
        self.assertEqual(self.agency.name, "Acme Renamed")

    def test_plain_member_cannot_update_agency_settings(self):
        self._login_as("member@acme.test")
        response = self.api.patch("/api/v1/agencies/me/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.agency.refresh_from_db()
        self.assertEqual(self.agency.name, "Acme")

    def test_subdomain_uniqueness_is_validated(self):
        Agency.objects.create(name="Other Co", subdomain="taken")
        self._login_as("admin@acme.test")
        response = self.api.patch("/api/v1/agencies/me/", {"subdomain": "taken"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("subdomain", response.data)


class ClientManagementTests(APITestCase):
    """Basic CRUD lifecycle for Client, including the industry, target
    locations, and services fields -- cross-agency isolation for this same
    endpoint is covered separately in ApiCrossAgencyIsolationTests."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.member = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_create_client_with_all_fields(self):
        self._login_as("admin@acme.test")
        response = self.api.post(
            "/api/v1/clients/",
            {
                "name": "Brightleaf Dental",
                "industry": "Healthcare",
                "target_locations": ["Austin, TX", "Round Rock, TX"],
                "services": ["General Dentistry", "Invisalign"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["target_locations"], ["Austin, TX", "Round Rock, TX"])
        self.assertEqual(response.data["services"], ["General Dentistry", "Invisalign"])

    def test_target_locations_and_services_default_to_empty_list(self):
        self._login_as("admin@acme.test")
        response = self.api.post("/api/v1/clients/", {"name": "Bare Client"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["target_locations"], [])
        self.assertEqual(response.data["services"], [])

    def test_name_is_required(self):
        self._login_as("admin@acme.test")
        response = self.api.post("/api/v1/clients/", {"industry": "Healthcare"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)

    def test_member_can_create_and_list_clients(self):
        # No admin-only gate on this endpoint -- any agency member manages
        # the agency's own clients, unlike agency settings/team management.
        self._login_as("member@acme.test")
        create_response = self.api.post("/api/v1/clients/", {"name": "Member-Created Client"}, format="json")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        list_response = self.api.get("/api/v1/clients/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([c["name"] for c in list_response.data], ["Member-Created Client"])

    def test_full_crud_lifecycle(self):
        self._login_as("admin@acme.test")

        create_response = self.api.post(
            "/api/v1/clients/",
            {"name": "Summit Roofing", "industry": "Home Services", "services": ["Roof Repair"]},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        client_id = create_response.data["id"]

        retrieve_response = self.api.get(f"/api/v1/clients/{client_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["name"], "Summit Roofing")

        update_response = self.api.patch(
            f"/api/v1/clients/{client_id}/",
            {"services": ["Roof Repair", "Roof Replacement"]},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["services"], ["Roof Repair", "Roof Replacement"])

        delete_response = self.api.delete(f"/api/v1/clients/{client_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        final_get = self.api.get(f"/api/v1/clients/{client_id}/")
        self.assertEqual(final_get.status_code, status.HTTP_404_NOT_FOUND)


class MatchingTests(TestCase):
    """Pure unit tests for core.matching -- no DB/API involved. This is the
    utility the AI response analysis pipeline will call later, so its
    correctness matters independent of anything HTTP-related."""

    def test_matches_primary_name_case_insensitively(self):
        matches = find_name_mentions("We recommend RankLens for this.", "avtr")
        self.assertEqual(len(matches), 1)
        self.assertTrue(matches[0].is_primary)
        self.assertEqual(matches[0].term, "avtr")

    def test_matches_an_alias(self):
        matches = find_name_mentions("Avatar Inc is a great choice.", "RankLens", aliases=["Avatar Inc"])
        self.assertEqual(len(matches), 1)
        self.assertFalse(matches[0].is_primary)
        self.assertEqual(matches[0].term, "Avatar Inc")

    def test_does_not_match_as_a_substring_of_another_word(self):
        matches = find_name_mentions("AVTRX is unrelated, so is XAVTR.", "RankLens")
        self.assertEqual(matches, [])

    def test_matches_multiple_occurrences_in_order(self):
        matches = find_name_mentions("RankLens is great. Really, RankLens delivers.", "RankLens")
        self.assertEqual(len(matches), 2)
        self.assertLess(matches[0].start, matches[1].start)

    def test_name_and_identical_alias_are_deduplicated(self):
        # An alias equal to the primary name (any casing) shouldn't double-count
        # the same span as two separate matches.
        matches = find_name_mentions("RankLens is great.", "RankLens", aliases=["avtr"])
        self.assertEqual(len(matches), 1)
        self.assertTrue(matches[0].is_primary)

    def test_no_match_returns_empty_list(self):
        self.assertEqual(find_name_mentions("Nothing relevant here.", "RankLens"), [])

    def test_empty_text_returns_empty_list(self):
        self.assertEqual(find_name_mentions("", "RankLens"), [])

    def test_blank_and_none_aliases_are_ignored(self):
        matches = find_name_mentions("RankLens mentioned once.", "RankLens", aliases=["", "   ", None])
        self.assertEqual(len(matches), 1)

    def test_multi_word_alias_matches_as_a_phrase(self):
        matches = find_name_mentions("Try Avatar Incorporated today.", "RankLens", aliases=["Avatar Inc"])
        self.assertEqual(matches, [])  # "Avatar Inc" isn't a whole-word match inside "Avatar Incorporated"

        matches = find_name_mentions("Try Avatar Inc today.", "RankLens", aliases=["Avatar Inc"])
        self.assertEqual(len(matches), 1)

    def test_name_is_mentioned_boolean_helper(self):
        self.assertTrue(name_is_mentioned("RankLens is here.", "RankLens"))
        self.assertFalse(name_is_mentioned("Nothing here.", "RankLens"))

    def test_list_rank_at_finds_a_plain_numbered_list_item(self):
        text = "Intro text.\n1. First Pick\n2. Second Pick\n3. Third Pick"
        position = text.index("Second Pick")
        self.assertEqual(list_rank_at(text, position), 2)

    def test_list_rank_at_finds_a_numbered_markdown_heading(self):
        text = "Here are the options:\n### 1. **Alpha Co**\nDetails.\n### 2. **Beta Co**\nMore details."
        position = text.index("Beta Co")
        self.assertEqual(list_rank_at(text, position), 2)

    def test_list_rank_at_is_none_before_any_list_marker(self):
        text = "Alpha Co is well known.\n1. Beta Co\n2. Gamma Co"
        position = text.index("Alpha Co")
        self.assertIsNone(list_rank_at(text, position))

    def test_list_rank_at_is_none_when_there_is_no_list_at_all(self):
        text = "Alpha Co and Beta Co are both solid choices, no particular order."
        self.assertIsNone(list_rank_at(text, text.index("Beta Co")))

    def test_list_rank_at_holds_the_rank_for_text_anywhere_under_that_item(self):
        # A mention doesn't have to sit right next to the marker itself
        # -- it just needs to fall before the *next* one.
        text = "1. Alpha Co\n   Known for quality and Beta Co is a common alternative some mention here.\n2. Gamma Co"
        position = text.index("Beta Co")
        self.assertEqual(list_rank_at(text, position), 1)

    def test_list_rank_at_reads_a_comparison_tables_rank_column(self):
        text = (
            "| Rank | Business | Notes |\n"
            "|------|----------|-------|\n"
            "| 1 | Master Replica | Great quality |\n"
            "| 2 | Grace Replica | Good prices |\n"
        )
        self.assertEqual(list_rank_at(text, text.index("Master Replica")), 1)
        self.assertEqual(list_rank_at(text, text.index("Grace Replica")), 2)

    def test_list_rank_at_is_none_for_a_comparison_table_without_a_rank_column(self):
        # No numeric first cell -- nothing here actually claims an
        # order, so inventing a rank from row position would be a
        # guess, not a read of what the AI said.
        text = "| Business | Notes |\n|----------|-------|\n| Master Replica | Great quality |\n"
        self.assertIsNone(list_rank_at(text, text.index("Master Replica")))

    def test_list_rank_at_is_none_for_an_unordered_bullet_list(self):
        text = "- Master Replica is solid.\n- Grace Replica is also an option.\n"
        self.assertIsNone(list_rank_at(text, text.index("Master Replica")))
        self.assertIsNone(list_rank_at(text, text.index("Grace Replica")))

    def test_list_rank_at_distinguishes_two_separate_restarting_lists(self):
        # Each mention gets whichever list it's actually nearest to --
        # the second list restarting at "1." doesn't bleed into or
        # inherit from the first.
        text = "Top picks:\n1. Alpha\n2. Beta\n\nRunners-up:\n1. Gamma\n2. Delta\n"
        self.assertEqual(list_rank_at(text, text.index("Alpha")), 1)
        self.assertEqual(list_rank_at(text, text.index("Beta")), 2)
        self.assertEqual(list_rank_at(text, text.index("Gamma")), 1)
        self.assertEqual(list_rank_at(text, text.index("Delta")), 2)

    def test_list_rank_at_does_not_match_a_decimal_sub_item_as_a_new_rank(self):
        # "1.1 Something" isn't a top-level "1. " marker -- no
        # whitespace directly after the first "." -- so it doesn't
        # reset/override the rank in progress.
        text = "1. Alpha Co\n   1.1 A sub-detail mentioning Beta Co here.\n2. Gamma Co"
        self.assertEqual(list_rank_at(text, text.index("Beta Co")), 1)


class ConfidenceScoringTests(TestCase):
    """Pure unit tests for core.matching.compute_match_confidence -- no
    DB/API involved. Each factor is tested in isolation (long primary
    exact-case match as the 1.0 baseline, then one change at a time) so
    a regression here points straight at which signal broke."""

    def test_long_primary_exact_case_match_is_full_confidence(self):
        self.assertEqual(compute_match_confidence("Grace Replica", True, "Grace Replica"), 1.0)

    def test_alias_match_scores_lower_than_primary(self):
        primary = compute_match_confidence("Grace Replica", True, "Grace Replica")
        alias = compute_match_confidence("Grace Replica", False, "Grace Replica")
        self.assertLess(alias, primary)
        self.assertAlmostEqual(alias, 0.85)

    def test_very_short_term_scores_much_lower(self):
        score = compute_match_confidence("GM", True, "GM")
        self.assertAlmostEqual(score, 0.6)

    def test_medium_short_term_scores_moderately_lower(self):
        score = compute_match_confidence("Acme", True, "Acme")
        self.assertAlmostEqual(score, 0.8)

    def test_case_mismatch_scores_lower_than_exact_case(self):
        exact = compute_match_confidence("Grace Replica", True, "Grace Replica")
        mismatched = compute_match_confidence("Grace Replica", True, "grace replica")
        self.assertLess(mismatched, exact)
        self.assertAlmostEqual(mismatched, 0.85)

    def test_penalties_stack_for_a_short_alias_matched_with_wrong_case(self):
        # Alias (-0.15) + <=3 chars (-0.4) + case mismatch (-0.15) = 0.3
        score = compute_match_confidence("GM", False, "gm")
        self.assertAlmostEqual(score, 0.3)

    def test_score_stays_non_negative_for_the_worst_realistic_combination(self):
        # Alias (-0.15) + <=3 chars (-0.4) + case mismatch (-0.15) is the
        # worst combination these three factors can produce -- still
        # comfortably above zero, but this pins down that floor so a
        # future change to the weights can't silently push it negative
        # without a test noticing.
        score = compute_match_confidence("X", False, "x")
        self.assertAlmostEqual(score, 0.3)
        self.assertGreaterEqual(score, 0.0)

    def test_score_is_clamped_to_at_most_one(self):
        # A long primary exact-case match already hits the 1.0 ceiling --
        # there's no combination of factors that scores higher.
        self.assertEqual(compute_match_confidence("A Very Long Business Name Indeed", True, "A Very Long Business Name Indeed"), 1.0)

    def test_trailing_compound_phrase_scores_lower(self):
        # Real Week 7 finding: "Master Replica" immediately followed by
        # " Dresses Pakistan" (a Facebook page name, not the tracked
        # competitor itself) shouldn't score as confidently as a clean,
        # standalone mention.
        clean = compute_match_confidence("Master Replica", True, "Master Replica", trailing_context=" is a great choice")
        compound = compute_match_confidence(
            "Master Replica", True, "Master Replica", trailing_context=" Dresses Pakistan"
        )
        self.assertLess(compound, clean)
        self.assertAlmostEqual(compound, 0.75)

    def test_trailing_lowercase_word_does_not_trigger_the_compound_penalty(self):
        score = compute_match_confidence("Master Replica", True, "Master Replica", trailing_context=" offers COD")
        self.assertEqual(score, 1.0)

    def test_no_trailing_context_does_not_trigger_the_compound_penalty(self):
        score = compute_match_confidence("Master Replica", True, "Master Replica")
        self.assertEqual(score, 1.0)

    def test_trailing_context_punctuation_before_a_capital_does_not_trigger_it(self):
        # A new sentence right after the mention ("Master Replica. It's
        # great.") isn't the same shape as a compound name running on --
        # the break is punctuation, not whitespace straight into a
        # capitalized word.
        score = compute_match_confidence("Master Replica", True, "Master Replica", trailing_context=". It's great.")
        self.assertEqual(score, 1.0)


class BrandManagementTests(APITestCase):
    """Basic CRUD lifecycle for Brand, plus the test-match action. Cross-agency
    isolation for the brands endpoint itself is covered separately in
    ApiCrossAgencyIsolationTests."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_create_brand_with_name_and_aliases(self):
        response = self.api.post(
            "/api/v1/brands/",
            {"client": str(self.acme_client.id), "name": "RankLens", "aliases": ["Avatar Inc", "Avatar"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["aliases"], ["Avatar Inc", "Avatar"])

    def test_client_is_required(self):
        response = self.api.post("/api/v1/brands/", {"name": "RankLens"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    def test_a_client_cannot_have_a_second_brand(self):
        self.api.post("/api/v1/brands/", {"client": str(self.acme_client.id), "name": "RankLens"}, format="json")
        second_response = self.api.post(
            "/api/v1/brands/", {"client": str(self.acme_client.id), "name": "Different Name"}, format="json"
        )
        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", second_response.data)

    def test_full_crud_lifecycle(self):
        create_response = self.api.post(
            "/api/v1/brands/", {"client": str(self.acme_client.id), "name": "RankLens", "aliases": ["Avatar"]}, format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        brand_id = create_response.data["id"]

        retrieve_response = self.api.get(f"/api/v1/brands/{brand_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["name"], "RankLens")

        update_response = self.api.patch(
            f"/api/v1/brands/{brand_id}/", {"aliases": ["Avatar", "Avatar Inc"]}, format="json"
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["aliases"], ["Avatar", "Avatar Inc"])

        delete_response = self.api.delete(f"/api/v1/brands/{brand_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        final_get = self.api.get(f"/api/v1/brands/{brand_id}/")
        self.assertEqual(final_get.status_code, status.HTTP_404_NOT_FOUND)

    def _create_brand(self):
        response = self.api.post(
            "/api/v1/brands/",
            {"client": str(self.acme_client.id), "name": "RankLens", "aliases": ["Avatar Inc"]},
            format="json",
        )
        return response.data["id"]

    def test_test_match_endpoint_finds_name_and_alias_matches(self):
        brand_id = self._create_brand()
        response = self.api.post(
            f"/api/v1/brands/{brand_id}/test-match/",
            {"text": "Have you tried RankLens? Avatar Inc is well reviewed too."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["matched"])
        self.assertEqual(len(response.data["matches"]), 2)

    def test_test_match_endpoint_with_no_matches(self):
        brand_id = self._create_brand()
        response = self.api.post(
            f"/api/v1/brands/{brand_id}/test-match/", {"text": "Totally unrelated text."}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["matched"])
        self.assertEqual(response.data["matches"], [])

    def test_test_match_endpoint_requires_text(self):
        brand_id = self._create_brand()
        response = self.api.post(f"/api/v1/brands/{brand_id}/test-match/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_test_match_endpoint_rejects_oversized_text(self):
        brand_id = self._create_brand()
        response = self.api.post(
            f"/api/v1/brands/{brand_id}/test-match/", {"text": "a" * 10_001}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class CompetitorManagementTests(APITestCase):
    """Basic CRUD lifecycle for Competitor, plus the test-match action
    (shared with Brand via NameMatchTestMixin). Cross-agency isolation for
    the competitors endpoint itself is covered separately in
    ApiCrossAgencyIsolationTests."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_create_competitor_with_name_and_aliases(self):
        response = self.api.post(
            "/api/v1/competitors/",
            {"client": str(self.acme_client.id), "name": "Rivalco", "aliases": ["Rival Co", "RivalCo Inc"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["aliases"], ["Rival Co", "RivalCo Inc"])

    def test_client_is_required(self):
        response = self.api.post("/api/v1/competitors/", {"name": "Rivalco"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    def test_a_client_can_have_multiple_competitors(self):
        # Unlike Brand, Competitor isn't one-to-one with Client -- an agency
        # tracks several rivals per client.
        first = self.api.post(
            "/api/v1/competitors/", {"client": str(self.acme_client.id), "name": "Rivalco"}, format="json"
        )
        second = self.api.post(
            "/api/v1/competitors/", {"client": str(self.acme_client.id), "name": "Other Rival"}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)

        list_response = self.api.get("/api/v1/competitors/")
        self.assertEqual(sorted(c["name"] for c in list_response.data), ["Other Rival", "Rivalco"])

    def test_full_crud_lifecycle(self):
        create_response = self.api.post(
            "/api/v1/competitors/",
            {"client": str(self.acme_client.id), "name": "Rivalco", "aliases": ["Rival Co"]},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        competitor_id = create_response.data["id"]

        retrieve_response = self.api.get(f"/api/v1/competitors/{competitor_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["name"], "Rivalco")

        update_response = self.api.patch(
            f"/api/v1/competitors/{competitor_id}/", {"aliases": ["Rival Co", "RC"]}, format="json"
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["aliases"], ["Rival Co", "RC"])

        delete_response = self.api.delete(f"/api/v1/competitors/{competitor_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        final_get = self.api.get(f"/api/v1/competitors/{competitor_id}/")
        self.assertEqual(final_get.status_code, status.HTTP_404_NOT_FOUND)

    def _create_competitor(self):
        response = self.api.post(
            "/api/v1/competitors/",
            {"client": str(self.acme_client.id), "name": "Rivalco", "aliases": ["Rival Co"]},
            format="json",
        )
        return response.data["id"]

    def test_test_match_endpoint_finds_name_and_alias_matches(self):
        competitor_id = self._create_competitor()
        response = self.api.post(
            f"/api/v1/competitors/{competitor_id}/test-match/",
            {"text": "Have you tried Rivalco? Rival Co is well reviewed too."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["matched"])
        self.assertEqual(len(response.data["matches"]), 2)

    def test_test_match_endpoint_with_no_matches(self):
        competitor_id = self._create_competitor()
        response = self.api.post(
            f"/api/v1/competitors/{competitor_id}/test-match/", {"text": "Totally unrelated text."}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["matched"])
        self.assertEqual(response.data["matches"], [])

    def test_test_match_endpoint_requires_text(self):
        competitor_id = self._create_competitor()
        response = self.api.post(f"/api/v1/competitors/{competitor_id}/test-match/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PromptManagementTests(APITestCase):
    """Basic CRUD lifecycle for Prompt, including category/service/location
    tagging. Cross-agency isolation for the prompts endpoint itself is
    covered separately in ApiCrossAgencyIsolationTests."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_create_prompt_with_all_fields(self):
        response = self.api.post(
            "/api/v1/prompts/",
            {
                "client": str(self.acme_client.id),
                "text": "Best dentist near downtown for same-day appointments",
                "category": "Local search intent",
                "service_tags": ["General Dentistry"],
                "location_tags": ["Austin, TX"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["service_tags"], ["General Dentistry"])
        self.assertEqual(response.data["location_tags"], ["Austin, TX"])
        self.assertEqual(response.data["category"], "Local search intent")
        self.assertEqual(response.data["schedule"], "manual")
        self.assertTrue(response.data["is_active"])

    def test_client_is_required(self):
        response = self.api.post("/api/v1/prompts/", {"text": "Some prompt"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    def test_text_is_required(self):
        response = self.api.post("/api/v1/prompts/", {"client": str(self.acme_client.id)}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("text", response.data)

    def test_category_and_tags_default_to_blank_and_empty_list(self):
        response = self.api.post(
            "/api/v1/prompts/",
            {"client": str(self.acme_client.id), "text": "Bare prompt"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["category"], "")
        self.assertEqual(response.data["service_tags"], [])
        self.assertEqual(response.data["location_tags"], [])

    def test_a_client_can_have_multiple_prompts(self):
        first = self.api.post(
            "/api/v1/prompts/", {"client": str(self.acme_client.id), "text": "First prompt"}, format="json"
        )
        second = self.api.post(
            "/api/v1/prompts/", {"client": str(self.acme_client.id), "text": "Second prompt"}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)

        list_response = self.api.get("/api/v1/prompts/")
        self.assertEqual(sorted(p["text"] for p in list_response.data), ["First prompt", "Second prompt"])

    def test_full_crud_lifecycle(self):
        create_response = self.api.post(
            "/api/v1/prompts/",
            {"client": str(self.acme_client.id), "text": "Original prompt text", "category": "Local search intent"},
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        prompt_id = create_response.data["id"]

        retrieve_response = self.api.get(f"/api/v1/prompts/{prompt_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["text"], "Original prompt text")

        update_response = self.api.patch(
            f"/api/v1/prompts/{prompt_id}/",
            {"text": "Edited prompt text", "is_active": False, "service_tags": ["Invisalign"]},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["text"], "Edited prompt text")
        self.assertFalse(update_response.data["is_active"])
        self.assertEqual(update_response.data["service_tags"], ["Invisalign"])

        delete_response = self.api.delete(f"/api/v1/prompts/{prompt_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)

        final_get = self.api.get(f"/api/v1/prompts/{prompt_id}/")
        self.assertEqual(final_get.status_code, status.HTTP_404_NOT_FOUND)

    def test_stores_the_exact_prompt_text_unmodified(self):
        # Only surrounding whitespace is trimmed (DRF's standard behavior for
        # any text field, and harmless -- it has no effect on what's sent to
        # an AI provider). Everything that actually matters for "the exact
        # text later sent to an AI provider" -- internal spacing, casing,
        # quotes, punctuation -- must survive completely unchanged.
        submitted_text = '  Best   dentist   near "downtown" -- same-day?  '
        expected_stored_text = 'Best   dentist   near "downtown" -- same-day?'
        response = self.api.post(
            "/api/v1/prompts/", {"client": str(self.acme_client.id), "text": submitted_text}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["text"], expected_stored_text)


class PromptScheduleLockTests(APITestCase):
    """A prompt that's part of an ACTIVE PromptSchedule can't be edited
    or deleted until that schedule finishes (PromptViewSet._locking_schedule/
    perform_update/perform_destroy) -- editing or deleting a prompt out
    from under a running schedule is confusing at best, so it's blocked
    outright rather than silently allowed. Manual "Run" stays available
    regardless -- it's a non-destructive, immediate one-off test, not a
    change to the prompt or its schedule."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.plan = _make_plan(slug="lock-plan")
        self.subscription = _make_subscription(self.agency, self.plan)
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.brand = Brand.objects.create(agency=self.agency, client=self.acme_client, name="Acme Brand")
            self.prompt = Prompt.objects.create(agency=self.agency, client=self.acme_client, text="Locked prompt")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _make_schedule(self, status_value=PromptSchedule.Status.ACTIVE, end_date=None):
        today = timezone.now().date()
        with use_agency(self.agency):
            schedule = PromptSchedule.objects.create(
                agency=self.agency,
                client=self.acme_client,
                brand=self.brand,
                frequency=PromptSchedule.Frequency.DAILY,
                start_date=today,
                end_date=end_date or today + timedelta(days=6),
                timezone="UTC",
                run_time=time(0, 0),
                status=status_value,
                providers=[AIProvider.OPENAI],
            )
            schedule.prompts.set([self.prompt])
        return schedule

    def test_locked_until_is_null_when_not_in_any_schedule(self):
        response = self.api.get(f"/api/v1/prompts/{self.prompt.id}/")
        self.assertIsNone(response.data["locked_until"])

    def test_locked_until_reflects_the_active_schedules_end_date(self):
        schedule = self._make_schedule()
        response = self.api.get(f"/api/v1/prompts/{self.prompt.id}/")
        self.assertEqual(response.data["locked_until"], schedule.end_date)

    def test_edit_blocked_while_schedule_is_active(self):
        self._make_schedule()
        response = self.api.patch(f"/api/v1/prompts/{self.prompt.id}/", {"text": "Changed"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("active schedule", response.data["detail"].lower())
        with use_agency(self.agency):
            self.prompt.refresh_from_db()
        self.assertEqual(self.prompt.text, "Locked prompt")

    def test_delete_blocked_while_schedule_is_active(self):
        self._make_schedule()
        response = self.api.delete(f"/api/v1/prompts/{self.prompt.id}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        with use_agency(self.agency):
            self.assertTrue(Prompt.objects.filter(id=self.prompt.id).exists())

    def test_edit_allowed_once_schedule_is_paused(self):
        self._make_schedule(status_value=PromptSchedule.Status.PAUSED)
        response = self.api.patch(f"/api/v1/prompts/{self.prompt.id}/", {"text": "Changed"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_edit_allowed_once_schedule_is_completed(self):
        self._make_schedule(status_value=PromptSchedule.Status.COMPLETED)
        response = self.api.patch(f"/api/v1/prompts/{self.prompt.id}/", {"text": "Changed"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_delete_allowed_once_schedule_is_cancelled(self):
        self._make_schedule(status_value=PromptSchedule.Status.CANCELLED)
        response = self.api.delete(f"/api/v1/prompts/{self.prompt.id}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_run_is_still_allowed_while_locked(self):
        self._make_schedule()
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class PromptBulkImportTests(APITestCase):
    """CSV bulk-import: POST /api/v1/prompts/bulk-import/ with a `client`
    id and a `file` upload. Validates each row through the same
    PromptSerializer normal create() uses, so behaviour (required text,
    schedule choices, client-agency safeguard) stays in sync with it."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.other_agency = Agency.objects.create(name="Other Co")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
        with use_agency(self.other_agency):
            self.other_client = Client.objects.create(agency=self.other_agency, name="Other's Client")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _upload(self, content, client_id=None, filename="prompts.csv", **extra):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile(filename, content.encode("utf-8"), content_type="text/csv")
        return self.api.post(
            "/api/v1/prompts/bulk-import/",
            {"client": str(client_id if client_id is not None else self.acme_client.id), "file": upload, **extra},
            format="multipart",
        )

    def test_imports_all_valid_rows(self):
        csv_content = (
            "text,category,service_tags,location_tags,schedule,is_active\n"
            "Best dentist downtown,Local search,General Dentistry;Whitening,Austin;Dallas,weekly,true\n"
            "Emergency dental care,,,,,\n"
        )
        response = self._upload(csv_content)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])

        first, second = response.data["prompts"]
        self.assertEqual(first["text"], "Best dentist downtown")
        self.assertEqual(first["category"], "Local search")
        self.assertEqual(first["service_tags"], ["General Dentistry", "Whitening"])
        self.assertEqual(first["location_tags"], ["Austin", "Dallas"])
        self.assertEqual(first["schedule"], "weekly")
        self.assertTrue(first["is_active"])

        # blank cells fall back to the same defaults the create endpoint uses
        self.assertEqual(second["schedule"], "manual")
        self.assertTrue(second["is_active"])

        with use_agency(self.agency):
            self.assertEqual(Prompt.objects.filter(client=self.acme_client).count(), 2)

    def test_default_category_and_location_fill_in_blank_rows(self):
        # Most prompts for one client share a category/location -- rows
        # can leave those cells blank and get the defaults instead of
        # repeating the same value on every line.
        csv_content = "text,category,location_tags\nBlank cells here,,\nHas its own values,Custom cat,Dallas\n"
        response = self._upload(
            csv_content, default_category="Local search intent", default_location_tags="Austin, TX"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        blank_row, own_values_row = response.data["prompts"]
        self.assertEqual(blank_row["category"], "Local search intent")
        self.assertEqual(blank_row["location_tags"], ["Austin", "TX"])
        # A row that specifies its own value keeps it -- the default only
        # fills in what was left blank.
        self.assertEqual(own_values_row["category"], "Custom cat")
        self.assertEqual(own_values_row["location_tags"], ["Dallas"])

    def test_without_defaults_blank_rows_stay_blank(self):
        response = self._upload("text,category,location_tags\nNo defaults given,,\n")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["prompts"][0]["category"], "")
        self.assertEqual(response.data["prompts"][0]["location_tags"], [])

    def test_is_active_parses_falsey_strings(self):
        csv_content = "text,is_active\nPaused prompt,false\nAlso paused,0\n"
        response = self._upload(csv_content)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(all(p["is_active"] is False for p in response.data["prompts"]))

    def test_partial_success_reports_row_errors_for_missing_text(self):
        csv_content = "text,category\nGood prompt,A\n,Missing text\n"
        response = self._upload(csv_content)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertEqual(response.data["errors"][0]["row"], 3)  # header is row 1
        self.assertIn("text", response.data["errors"][0]["errors"])

    def test_all_rows_invalid_returns_400(self):
        # Each row needs a comma to survive DictReader (a truly blank line
        # is skipped entirely rather than parsed as an empty `text` cell).
        csv_content = "text,category\n,A\n,B\n"
        response = self._upload(csv_content)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["created"], 0)
        self.assertEqual(len(response.data["errors"]), 2)

    def test_requires_text_column(self):
        response = self._upload("category\nLocal search\n")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("file", response.data)

    def test_requires_client(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile("prompts.csv", b"text\nSome prompt\n", content_type="text/csv")
        response = self.api.post("/api/v1/prompts/bulk-import/", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    def test_requires_file(self):
        response = self.api.post(
            "/api/v1/prompts/bulk-import/", {"client": str(self.acme_client.id)}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("file", response.data)

    def test_rejects_a_client_from_another_agency(self):
        response = self._upload("text\nSneaky prompt\n", client_id=self.other_client.id)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)
        with use_agency(bypass=True):
            self.assertFalse(Prompt.objects.filter(text="Sneaky prompt").exists())

    def test_rejects_file_with_no_data_rows(self):
        response = self._upload("text,category\n")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("file", response.data)

    def test_rejects_too_many_rows(self):
        rows = "\n".join(f"Prompt number {i}" for i in range(501))
        response = self._upload(f"text\n{rows}\n")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("file", response.data)
        with use_agency(self.agency):
            self.assertEqual(Prompt.objects.filter(client=self.acme_client).count(), 0)


class PromptRunTests(APITestCase):
    """Manual "run now" trigger (POST /prompts/<id>/run/) and the
    read-only run-history endpoint (GET /prompt-runs/). No real AI
    provider is called yet -- execute_prompt_run writes a mock response
    synchronously instead -- but it's billed exactly like a real run
    will be (AVTR_SPEC follow-up): blocked without a usable subscription
    or remaining Prompt Run usage, and counted against that usage the
    moment it succeeds. See PromptRun/PromptViewSet.run docstrings."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.plan = _make_plan(slug="promptrun-plan", prompt_runs_included=5)
        self.subscription = _make_subscription(self.agency, self.plan)
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.acme_client, text="Best dentist near downtown"
            )
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_run_creates_a_queued_promptrun_targeting_openai(self):
        # CELERY_TASK_ALWAYS_EAGER (settings.py, test-only) runs the
        # dispatched task inline before this response is built, so by
        # the time we get it back the run has already reached its
        # terminal state -- same real code path a live worker would run.
        # No OPENAI_API_KEY in the test environment, so it lands on
        # FAILED here; test_run_creates_a_completed_promptrun_when_openai_is_configured
        # covers the success path with a mocked key.
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["provider"], AIProvider.OPENAI)
        self.assertEqual(response.data["status"], "failed")
        self.assertEqual(response.data["prompt"], self.prompt.id)
        self.assertEqual(response.data["prompt_text"], "Best dentist near downtown")
        self.assertIn("isn't configured", response.data["response_text"])
        self.assertIsNotNone(response.data["executed_at"])

        with use_agency(self.agency):
            run = PromptRun.objects.get(id=response.data["id"])
        self.assertEqual(run.agency_id, self.agency.id)
        self.assertEqual(run.prompt_id, self.prompt.id)
        self.assertEqual(run.status, PromptRun.Status.FAILED)
        self.assertTrue(run.response_text)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_run_creates_a_completed_promptrun_when_openai_is_configured(self, mock_send_prompt):
        mock_send_prompt.return_value = "Acme Dental is a great option."
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], "completed")
        self.assertEqual(response.data["response_text"], "Acme Dental is a great option.")
        self.assertIsNotNone(response.data["executed_at"])

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="Acme Dental is a great option.")
    def test_run_deducts_one_prompt_run_from_current_billing_period(self, _send):
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
        self.assertEqual(period.prompt_runs_used, 0)

        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")

        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 1)

        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 2)

    def test_failed_run_is_refunded_and_costs_nothing(self):
        # No provider key in tests -> the run fails; its single charge must be
        # refunded (regression: runs used to be charged twice, refunded once).
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.data["status"], PromptRun.Status.FAILED)
        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 0)

    def test_run_blocked_without_a_usable_subscription(self):
        with use_agency(self.agency):
            self.subscription.status = Subscription.Status.PENDING
            self.subscription.save(update_fields=["status"])

        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.status_code, 402)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_run_blocked_without_a_subscription_at_all(self):
        agency = Agency.objects.create(name="No Sub Co")
        User.objects.create_user(email="admin@nosub.test", password=self.password, agency=agency, role=User.Role.ADMIN)
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="No sub prompt")
        api = APIClient()
        token_response = api.post(
            "/api/v1/auth/token/", {"email": "admin@nosub.test", "password": self.password}, format="json"
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        response = api.post(f"/api/v1/prompts/{prompt.id}/run/")
        self.assertEqual(response.status_code, 402)

    def test_run_blocked_when_no_prompt_runs_remain_and_creates_nothing(self):
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
            period.prompt_runs_used = 5  # equal to the plan's included allowance
            period.save(update_fields=["prompt_runs_used"])

        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(response.status_code, 402)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 5)  # unchanged -- no partial billing

    def test_run_snapshots_text_as_of_trigger_time_not_current_text(self):
        first = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(first.data["prompt_text"], "Best dentist near downtown")

        self.api.patch(f"/api/v1/prompts/{self.prompt.id}/", {"text": "Edited prompt text"}, format="json")

        second = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.assertEqual(second.data["prompt_text"], "Edited prompt text")

        # the first run's snapshot is untouched by the later edit
        first_run_after_edit = self.api.get(f"/api/v1/prompt-runs/{first.data['id']}/")
        self.assertEqual(first_run_after_edit.data["prompt_text"], "Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="A great option.")
    def test_each_trigger_creates_a_separate_history_row(self, mock_send_prompt):
        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")

        response = self.api.get(f"/api/v1/prompt-runs/?prompt={self.prompt.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 3)
        self.assertTrue(all(r["status"] == "completed" for r in response.data))

    def test_history_filter_excludes_other_prompts_runs(self):
        with use_agency(self.agency):
            other_prompt = Prompt.objects.create(
                agency=self.agency, client=self.acme_client, text="Emergency dentist"
            )
        self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/")
        self.api.post(f"/api/v1/prompts/{other_prompt.id}/run/")

        response = self.api.get(f"/api/v1/prompt-runs/?prompt={self.prompt.id}")
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["prompt"], self.prompt.id)

    def test_run_on_nonexistent_prompt_404s(self):
        missing_id = uuid.uuid4()
        response = self.api.post(f"/api/v1/prompts/{missing_id}/run/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_run_rejects_an_unknown_explicit_provider(self):
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/", {"provider": "not-a-real-provider"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_run_rejects_an_explicit_provider_outside_the_plan(self):
        with use_agency(self.agency):
            self.plan.providers = [AIProvider.OPENAI]
            self.plan.save(update_fields=["providers"])

        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/", {"provider": AIProvider.GEMINI})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("gemini", response.data["provider"][0])
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_run_rejects_an_explicit_provider_with_no_api_key_before_queuing(self):
        # No GEMINI_API_KEY in the test environment -- this should fail
        # immediately with a 400, not queue a PromptRun that only turns out
        # to be dead on arrival once Celery picks it up.
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/", {"provider": AIProvider.GEMINI})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("isn't configured", response.data["provider"][0])
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.GeminiProviderClient.send_prompt", return_value="Acme Dental, per Gemini.")
    def test_run_honors_an_explicit_provider_choice(self, mock_send_prompt):
        response = self.api.post(f"/api/v1/prompts/{self.prompt.id}/run/", {"provider": AIProvider.GEMINI})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["provider"], AIProvider.GEMINI)
        self.assertEqual(response.data["status"], "completed")
        self.assertEqual(response.data["response_text"], "Acme Dental, per Gemini.")


class PromptBulkRunTests(APITestCase):
    """POST /api/v1/prompts/run-bulk/ -- "run all of this client's
    prompts" in one request instead of one call per prompt. Same
    per-prompt billing as the single run() action, but all-or-nothing
    on the usage check (_check_run_budget): a batch that doesn't fully
    fit the remaining allowance runs none of it."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.plan = _make_plan(slug="bulkrun-plan", prompt_runs_included=5)
        self.subscription = _make_subscription(self.agency, self.plan)
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.prompts = [
                Prompt.objects.create(agency=self.agency, client=self.acme_client, text=f"Prompt {i}")
                for i in range(3)
            ]
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _ids(self, prompts=None):
        return [str(p.id) for p in (prompts if prompts is not None else self.prompts)]

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_bulk_run_creates_one_completed_promptrun_per_prompt(self, mock_send_prompt):
        mock_send_prompt.return_value = "A great option."
        response = self.api.post("/api/v1/prompts/run-bulk/", {"prompts": self._ids()}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["created"], 3)
        self.assertEqual(len(response.data["prompt_runs"]), 3)
        self.assertTrue(all(r["status"] == "completed" for r in response.data["prompt_runs"]))
        self.assertTrue(all(r["response_text"] for r in response.data["prompt_runs"]))
        self.assertTrue(all(r["executed_at"] for r in response.data["prompt_runs"]))

        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 3)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="A great option.")
    def test_bulk_run_deducts_exactly_one_credit_per_prompt(self, _send):
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
        self.assertEqual(period.prompt_runs_used, 0)

        self.api.post("/api/v1/prompts/run-bulk/", {"prompts": self._ids()}, format="json")

        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 3)

    def test_bulk_failed_runs_are_refunded(self):
        # No provider key -> every run fails inline; the batch is charged up
        # front and each failure refunded, so nothing is billed.
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
        self.api.post("/api/v1/prompts/run-bulk/", {"prompts": self._ids()}, format="json")
        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 0)

    def test_bulk_run_is_all_or_nothing_when_budget_is_insufficient(self):
        # Plan includes 5; 3 already used elsewhere leaves only 2 -- not
        # enough for this batch of 3, so NONE of them should run.
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(self.subscription)
            period.prompt_runs_used = 3
            period.save(update_fields=["prompt_runs_used"])

        response = self.api.post("/api/v1/prompts/run-bulk/", {"prompts": self._ids()}, format="json")
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.data["needed"], 3)
        self.assertEqual(response.data["remaining"], 2)

        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)
            period.refresh_from_db()
        self.assertEqual(period.prompt_runs_used, 3)  # unchanged -- no partial billing

    def test_bulk_run_blocked_without_a_usable_subscription(self):
        with use_agency(self.agency):
            self.subscription.status = Subscription.Status.PENDING
            self.subscription.save(update_fields=["status"])

        response = self.api.post("/api/v1/prompts/run-bulk/", {"prompts": self._ids()}, format="json")
        self.assertEqual(response.status_code, 402)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_bulk_run_rejects_empty_list(self):
        response = self.api.post("/api/v1/prompts/run-bulk/", {"prompts": []}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_run_rejects_missing_prompts_field(self):
        response = self.api.post("/api/v1/prompts/run-bulk/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_run_rejects_another_agencys_prompt_and_creates_nothing(self):
        other_agency = Agency.objects.create(name="Other Co")
        with use_agency(other_agency):
            other_client = Client.objects.create(agency=other_agency, name="Other client")
            other_prompt = Prompt.objects.create(agency=other_agency, client=other_client, text="Not yours")

        response = self.api.post(
            "/api/v1/prompts/run-bulk/", {"prompts": self._ids() + [str(other_prompt.id)]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(str(other_prompt.id), response.data["prompts"][0])
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_bulk_run_rejects_batches_over_the_max_size(self):
        with use_agency(self.agency):
            many_ids = [
                str(
                    Prompt.objects.create(agency=self.agency, client=self.acme_client, text=f"Extra {i}").id
                )
                for i in range(51)
            ]
        response = self.api.post("/api/v1/prompts/run-bulk/", {"prompts": many_ids}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PromptRunScheduleReservationTests(APITestCase):
    """_check_run_budget (PromptViewSet.run/run_bulk) also reserves
    today's still-pending obligation from every ACTIVE schedule
    (billing.today_reserved_prompt_runs), so a manual/bulk run can't
    spend credits a schedule already due today is counting on -- only
    today's reservation, never the schedule's whole remaining lifetime
    (see billing.schedule_due_today_pending's docstring)."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.plan = _make_plan(slug="reservation-plan", prompt_runs_included=3)
        self.subscription = _make_subscription(self.agency, self.plan)
        today = timezone.now().date()
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.brand = Brand.objects.create(agency=self.agency, client=self.acme_client, name="Acme Brand")
            self.scheduled_prompt = Prompt.objects.create(
                agency=self.agency, client=self.acme_client, text="Scheduled prompt"
            )
            self.manual_prompt_a = Prompt.objects.create(
                agency=self.agency, client=self.acme_client, text="Manual prompt A"
            )
            self.manual_prompt_b = Prompt.objects.create(
                agency=self.agency, client=self.acme_client, text="Manual prompt B"
            )
            self.schedule = PromptSchedule.objects.create(
                agency=self.agency,
                client=self.acme_client,
                brand=self.brand,
                frequency=PromptSchedule.Frequency.DAILY,
                start_date=today,
                end_date=today + timedelta(days=6),
                timezone="UTC",
                run_time=time(0, 0),
                status=PromptSchedule.Status.ACTIVE,
                providers=[AIProvider.OPENAI],
            )
            self.schedule.prompts.set([self.scheduled_prompt])
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    # The bulk run must genuinely succeed to consume its 2 credits -- failed
    # runs are refunded, which would leave the budget untouched.
    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="A great option.")
    def test_manual_run_blocked_when_it_would_eat_into_todays_schedule_reservation(self, _send):
        # Plan allows 3. The schedule due today needs 1 (1 prompt x 1
        # provider), leaving 2 available for anything else today. A bulk
        # run of those other 2 prompts fits -- but the schedule's own
        # prompt is then blocked, even though raw remaining (3) alone
        # would otherwise have allowed a 1-Prompt-Run request.
        response = self.api.post(
            "/api/v1/prompts/run-bulk/",
            {"prompts": [str(self.manual_prompt_a.id), str(self.manual_prompt_b.id)]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        blocked = self.api.post(f"/api/v1/prompts/{self.scheduled_prompt.id}/run/")
        self.assertEqual(blocked.status_code, 402)
        self.assertEqual(blocked.data["reserved_for_schedules"], 1)
        self.assertEqual(blocked.data["remaining"], 0)

        with use_agency(self.agency):
            # The blocked request billed nothing -- still just the 2 from
            # the earlier bulk run.
            self.assertEqual(PromptRun.objects.count(), 2)

    def test_manual_run_allowed_once_the_schedule_no_longer_needs_todays_credit(self):
        # Dispatching the schedule spends its own 1 credit and clears its
        # reservation (schedule_due_today_pending returns [] once today's
        # idempotency key exists) -- freeing the rest of the period's
        # budget back up for manual runs.
        tasks.dispatch_scheduled_prompt_runs()
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.filter(schedule=self.schedule).count(), 1)

        response = self.api.post(
            "/api/v1/prompts/run-bulk/",
            {"prompts": [str(self.manual_prompt_a.id), str(self.manual_prompt_b.id)]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_schedule_not_due_today_reserves_nothing(self):
        with use_agency(self.agency):
            self.schedule.start_date = timezone.now().date() + timedelta(days=1)
            self.schedule.end_date = self.schedule.start_date + timedelta(days=6)
            self.schedule.save(update_fields=["start_date", "end_date"])

        response = self.api.post(
            "/api/v1/prompts/run-bulk/",
            {
                "prompts": [
                    str(self.manual_prompt_a.id),
                    str(self.manual_prompt_b.id),
                    str(self.scheduled_prompt.id),
                ]
            },
            format="json",
        )
        # All 3 fit the plan's raw allowance since the not-yet-due
        # schedule reserves nothing today.
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_today_reserved_prompt_runs_matches_schedule_due_today_pending(self):
        with use_agency(self.agency):
            pending = schedule_due_today_pending(self.schedule)
            self.assertEqual(len(pending), 1)
            self.assertEqual(today_reserved_prompt_runs(self.agency), 1)
            self.assertEqual(today_reserved_prompt_runs(self.agency, exclude_schedule_id=self.schedule.id), 0)


class CeleryTaskTests(TestCase):
    """Task *bodies* are called directly here (bypassing the broker
    entirely, same as celery's own recommended way to unit test a task)
    -- there's no Redis in this test environment, and there doesn't need
    to be: that a live worker/beat actually discover and schedule these
    tasks was checked by hand via the CLI (`celery -A config worker` /
    `beat --loglevel=debug`)."""

    def test_execute_prompt_run_with_no_provider_set_fails_cleanly(self):
        # CELERY_TASK_ALWAYS_EAGER (settings.py, test-only) runs .delay()
        # inline, synchronously, exactly as a worker would -- just
        # without a broker in between; .get() unwraps the eager result
        # to the task's actual return value. A blank provider
        # (get_provider_client's unknown-provider case) should be
        # handled the same as any other AIProviderError -- FAILED, not
        # an unhandled exception.
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency, prompt=prompt, prompt_text=prompt.text, status=PromptRun.Status.QUEUED
            )
        result = tasks.execute_prompt_run.delay(str(run.id)).get()
        self.assertIsNone(result)
        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.FAILED)

    def test_execute_prompt_run_does_not_error_for_unknown_id(self):
        result = tasks.execute_prompt_run.delay(str(uuid.uuid4())).get()
        self.assertIsNone(result)

    def test_dispatch_scheduled_prompt_runs_ignores_the_plain_prompt_schedule_tag(self):
        # AVTR_SPEC §5/§23 superseded the old contract: dispatch used to
        # be driven directly off Prompt.schedule (a simple cadence tag),
        # but now only real PromptSchedule rows (with their own dated
        # range, providers, and subscription/usage enforcement) drive
        # anything. Prompt.schedule is kept only as a display tag on the
        # prompt itself (see PromptManagementTests) -- setting it alone
        # must dispatch nothing, since there's no PromptSchedule at all.
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            Prompt.objects.create(agency=agency, client=client, text="Active weekly", schedule=Prompt.Schedule.WEEKLY)

        self.assertEqual(tasks.dispatch_scheduled_prompt_runs(), 0)
        with use_agency(agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_manual_run_trigger_leaves_idempotency_key_blank(self):
        # Manual clicks are deliberate user actions, not retries of the
        # same logical trigger -- they should never be deduplicated
        # against each other, so the key stays blank (and the partial
        # unique constraint doesn't apply to them at all).
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency, prompt=prompt, prompt_text=prompt.text, status=PromptRun.Status.QUEUED
            )
        self.assertEqual(run.idempotency_key, "")

    def test_debug_task_runs_without_error(self):
        result = tasks.debug_task()
        self.assertEqual(result, "debug_task ok")

    def test_celery_app_discovers_all_tasks(self):
        from config.celery import app

        app.autodiscover_tasks(force=True)
        self.assertIn("core.tasks.execute_prompt_run", app.tasks)
        self.assertIn("core.tasks.dispatch_scheduled_prompt_runs", app.tasks)
        self.assertIn("core.tasks.debug_task", app.tasks)
        self.assertIn("core.tasks.ping_database", app.tasks)

    def test_beat_schedule_points_at_the_real_task_path(self):
        # A typo'd string here would only ever fail silently at runtime
        # (Beat would schedule sends to a task name no worker has
        # registered) -- assert it matches the actual importable path.
        entry = settings.CELERY_BEAT_SCHEDULE["dispatch-scheduled-prompt-runs"]
        self.assertEqual(entry["task"], f"{tasks.dispatch_scheduled_prompt_runs.__module__}.dispatch_scheduled_prompt_runs")

    def test_database_keepalive_is_off_by_default(self):
        # The keep-alive stops a serverless DB from ever suspending, which
        # burned the whole Neon free-tier compute allowance -- opt-in only.
        self.assertFalse(settings.DB_KEEPALIVE_ENABLED)
        self.assertNotIn("ping-database", settings.CELERY_BEAT_SCHEDULE)

    def test_ping_database_runs_without_error(self):
        # A trivial, side-effect-free query -- just confirms the task
        # (and its use_agency(bypass=True) wrapping) doesn't raise.
        self.assertIsNone(tasks.ping_database())

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_computes_a_short_explicit_retry_countdown(self, mock_send_prompt):
        # self.retry() with no explicit countdown falls back to Celery's
        # own default_retry_delay -- 180 seconds -- and the task's
        # retry_backoff* options do nothing for a manual self.retry()
        # call (they only apply to Celery's own autoretry_for wrapper).
        # Confirmed live against a real provider timeout: a bare
        # self.retry(exc=exc) here made a failing run wait 180s before
        # its first retry, invisible in eager-mode unit tests, which
        # never actually sleep for the countdown. This guards against
        # ever dropping the explicit countdown= again.
        mock_send_prompt.side_effect = [TransientAIProviderError("boom"), "ok"]
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        captured = {}
        original_retry = tasks.execute_prompt_run.retry

        def capturing_retry(*args, **kwargs):
            captured["countdown"] = kwargs.get("countdown")
            return original_retry(*args, **kwargs)

        with patch.object(tasks.execute_prompt_run, "retry", side_effect=capturing_retry):
            tasks.execute_prompt_run.delay(str(run.id))

        self.assertIsNotNone(captured.get("countdown"))
        self.assertLess(captured["countdown"], 10)


class AIProviderTests(TestCase):
    """core/ai_providers.py: the provider-independent interface used by
    execute_prompt_run. No real network calls are made here -- requests
    is mocked throughout."""

    def test_get_provider_client_returns_one_client_per_known_provider(self):
        self.assertIsInstance(get_provider_client(AIProvider.OPENAI), OpenAIProviderClient)
        self.assertIsInstance(get_provider_client(AIProvider.GEMINI), GeminiProviderClient)
        self.assertIsInstance(get_provider_client(AIProvider.PERPLEXITY), UnimplementedProviderClient)

    def test_get_provider_client_rejects_an_unknown_provider(self):
        with self.assertRaises(AIProviderError):
            get_provider_client("not-a-real-provider")

    def test_default_manual_provider_is_openai_when_nothing_is_configured(self):
        self.assertEqual(default_manual_provider(), AIProvider.OPENAI)

    @override_settings(OPENAI_API_KEY="", GEMINI_API_KEY="test-gemini-key")
    def test_default_manual_provider_falls_back_to_gemini_when_only_gemini_is_configured(self):
        self.assertEqual(default_manual_provider(), AIProvider.GEMINI)

    @override_settings(OPENAI_API_KEY="sk-test-key", GEMINI_API_KEY="test-gemini-key")
    def test_default_manual_provider_prefers_openai_when_both_are_configured(self):
        self.assertEqual(default_manual_provider(), AIProvider.OPENAI)

    def test_unimplemented_provider_is_never_configured_and_always_errors(self):
        client = UnimplementedProviderClient("Perplexity")
        self.assertFalse(client.is_configured())
        with self.assertRaises(AIProviderError):
            client.send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="")
    def test_openai_client_is_not_configured_without_a_key(self):
        client = OpenAIProviderClient()
        self.assertFalse(client.is_configured())
        with self.assertRaises(AIProviderError):
            client.send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    def test_openai_client_is_configured_with_a_key(self):
        self.assertTrue(OpenAIProviderClient().is_configured())

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_returns_the_message_content_on_success(self, mock_post):
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {"choices": [{"message": {"content": "Acme Dental is a great option."}}]},
        )
        mock_post.return_value.raise_for_status = lambda: None

        result = OpenAIProviderClient().send_prompt("Best dentist near downtown")

        self.assertEqual(result, "Acme Dental is a great option.")
        called_headers = mock_post.call_args.kwargs["headers"]
        self.assertEqual(called_headers["Authorization"], "Bearer sk-test-key")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_wraps_a_malformed_response_in_ai_provider_error(self, mock_post):
        mock_post.return_value = Mock(status_code=200, json=lambda: {"unexpected": "shape"})
        mock_post.return_value.raise_for_status = lambda: None

        with self.assertRaises(AIProviderError):
            OpenAIProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_wraps_a_network_failure_in_a_transient_error(self, mock_post):
        mock_post.side_effect = requests.ConnectionError("boom")

        with self.assertRaises(TransientAIProviderError):
            OpenAIProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_wraps_a_timeout_in_a_transient_error(self, mock_post):
        mock_post.side_effect = requests.Timeout("timed out")

        with self.assertRaises(TransientAIProviderError):
            OpenAIProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_treats_429_as_transient(self, mock_post):
        mock_post.return_value = Mock(status_code=429, text="rate limited")

        with self.assertRaises(TransientAIProviderError):
            OpenAIProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_treats_5xx_as_transient(self, mock_post):
        mock_post.return_value = Mock(status_code=503, text="service unavailable")

        with self.assertRaises(TransientAIProviderError):
            OpenAIProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.requests.post")
    def test_openai_client_treats_400_as_permanent_not_transient(self, mock_post):
        response = Mock(status_code=400, text="bad request")
        response.raise_for_status = Mock(side_effect=requests.HTTPError("400", response=response))
        mock_post.return_value = response

        with self.assertRaises(AIProviderError) as ctx:
            OpenAIProviderClient().send_prompt("Best dentist near downtown")
        self.assertNotIsInstance(ctx.exception, TransientAIProviderError)

    @override_settings(GEMINI_API_KEY="")
    def test_gemini_client_is_not_configured_without_a_key(self):
        client = GeminiProviderClient()
        self.assertFalse(client.is_configured())
        with self.assertRaises(AIProviderError):
            client.send_prompt("Best dentist near downtown")

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    def test_gemini_client_is_configured_with_a_key(self):
        self.assertTrue(GeminiProviderClient().is_configured())

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_returns_the_message_content_on_success(self, mock_post):
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": "Acme Dental is a great option."}]}}]},
        )
        mock_post.return_value.raise_for_status = lambda: None

        result = GeminiProviderClient().send_prompt("Best dentist near downtown")

        self.assertEqual(result, "Acme Dental is a great option.")
        called_params = mock_post.call_args.kwargs["params"]
        self.assertEqual(called_params["key"], "test-gemini-key")

    @override_settings(GEMINI_API_KEY="test-gemini-key", GEMINI_SEARCH_GROUNDING_ENABLED=False)
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_omits_search_grounding_by_default(self, mock_post):
        # Confirmed live (2026-09): requesting grounding on a free-tier
        # key makes the *whole* call 429, not just skip citations --
        # this must stay opt-in, never on by default.
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": "Acme Dental is a great option."}]}}]},
        )
        mock_post.return_value.raise_for_status = lambda: None

        GeminiProviderClient().send_prompt("Best dentist near downtown")

        called_json = mock_post.call_args.kwargs["json"]
        self.assertNotIn("tools", called_json)

    @override_settings(GEMINI_API_KEY="test-gemini-key", GEMINI_SEARCH_GROUNDING_ENABLED=True)
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_requests_search_grounding_when_enabled(self, mock_post):
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": "Acme Dental is a great option."}]}}]},
        )
        mock_post.return_value.raise_for_status = lambda: None

        GeminiProviderClient().send_prompt("Best dentist near downtown")

        called_json = mock_post.call_args.kwargs["json"]
        self.assertEqual(called_json["tools"], [{"google_search": {}}])

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_appends_citations_when_grounded(self, mock_post):
        # "Café" -- 2-byte "é" -- deliberately sits before the cited
        # segment, so a naive character-index insertion (instead of the
        # byte-index Gemini's API actually documents) would land the
        # marker one position too early and this test would catch it.
        text = "Café is great. Also try Joe's Diner."
        first_sentence_byte_len = len("Café is great.".encode())
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {
                "candidates": [
                    {
                        "content": {"parts": [{"text": text}]},
                        "groundingMetadata": {
                            "groundingChunks": [{"web": {"uri": "https://example.com/cafe", "title": "Café Reviews"}}],
                            "groundingSupports": [
                                {
                                    "segment": {"endIndex": first_sentence_byte_len},
                                    "groundingChunkIndices": [0],
                                }
                            ],
                        },
                    }
                ]
            },
        )
        mock_post.return_value.raise_for_status = lambda: None

        result = GeminiProviderClient().send_prompt("Best cafe near downtown")

        self.assertIn("Café is great.[[1]](https://example.com/cafe) Also try Joe's Diner.", result)
        self.assertIn("**Sources:**", result)
        self.assertIn("1. [Café Reviews](https://example.com/cafe)", result)

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_returns_plain_text_when_grounding_metadata_is_malformed(self, mock_post):
        mock_post.return_value = Mock(
            status_code=200,
            json=lambda: {
                "candidates": [
                    {
                        "content": {"parts": [{"text": "Acme Dental is a great option."}]},
                        # Missing the "web" key entirely -- a shape
                        # change should degrade gracefully, not crash
                        # the whole run over a citations nice-to-have.
                        "groundingMetadata": {"groundingChunks": [{"unexpected": "shape"}]},
                    }
                ]
            },
        )
        mock_post.return_value.raise_for_status = lambda: None

        result = GeminiProviderClient().send_prompt("Best dentist near downtown")

        self.assertEqual(result, "Acme Dental is a great option.")

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_wraps_a_malformed_response_in_ai_provider_error(self, mock_post):
        mock_post.return_value = Mock(status_code=200, json=lambda: {"unexpected": "shape"})
        mock_post.return_value.raise_for_status = lambda: None

        with self.assertRaises(AIProviderError):
            GeminiProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_wraps_a_network_failure_in_a_transient_error(self, mock_post):
        mock_post.side_effect = requests.ConnectionError("boom")

        with self.assertRaises(TransientAIProviderError):
            GeminiProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_treats_429_as_transient(self, mock_post):
        mock_post.return_value = Mock(status_code=429, text="rate limited")

        with self.assertRaises(TransientAIProviderError):
            GeminiProviderClient().send_prompt("Best dentist near downtown")

    @override_settings(GEMINI_API_KEY="test-gemini-key")
    @patch("core.ai_providers.requests.post")
    def test_gemini_client_treats_5xx_as_transient(self, mock_post):
        mock_post.return_value = Mock(status_code=503, text="service unavailable")

        with self.assertRaises(TransientAIProviderError):
            GeminiProviderClient().send_prompt("Best dentist near downtown")

    def test_execute_prompt_run_marks_failed_when_provider_not_configured(self):
        # No OPENAI_API_KEY in the test environment -- this is the
        # everyday path every other test in this file already relies on.
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )
        self.assertIsNone(run.executed_at)

        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.FAILED)
        self.assertIn("isn't configured", run.response_text)
        self.assertIsNotNone(run.executed_at)

    @override_settings(DEBUG=True)
    def test_unconfigured_provider_fails_even_in_debug_mode(self):
        # Regression: DEBUG used to swap in a generated "AI answer" that was
        # saved as COMPLETED and shown as the provider's real output.
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.FAILED)
        self.assertIn("isn't configured", run.response_text)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_uses_the_real_response_when_provider_is_configured(self, mock_send_prompt):
        mock_send_prompt.return_value = "Acme Dental is a great option."
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.COMPLETED)
        self.assertEqual(run.response_text, "Acme Dental is a great option.")
        self.assertIsNotNone(run.executed_at)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_fails_immediately_on_a_permanent_error(self, mock_send_prompt):
        # A plain AIProviderError (as opposed to TransientAIProviderError)
        # is treated as permanent -- no retries, straight to FAILED.
        mock_send_prompt.side_effect = AIProviderError("invalid request: prompt violates content policy")
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        self.assertEqual(mock_send_prompt.call_count, 1)
        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.FAILED)
        self.assertEqual(run.response_text, "invalid request: prompt violates content policy")
        self.assertIsNotNone(run.executed_at)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_retries_a_transient_error_and_then_succeeds(self, mock_send_prompt):
        mock_send_prompt.side_effect = [
            TransientAIProviderError("OpenAI rate limit hit (429)"),
            "Acme Dental is a great option.",
        ]
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        self.assertEqual(mock_send_prompt.call_count, 2)
        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.COMPLETED)
        self.assertEqual(run.response_text, "Acme Dental is a great option.")
        self.assertIsNotNone(run.executed_at)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_fails_after_exhausting_retries_on_a_transient_error(self, mock_send_prompt):
        mock_send_prompt.side_effect = TransientAIProviderError("OpenAI server error (503)")
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        # Initial attempt + MAX_PROMPT_RUN_RETRIES retries.
        self.assertEqual(mock_send_prompt.call_count, tasks.MAX_PROMPT_RUN_RETRIES + 1)
        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.FAILED)
        self.assertIn("Failed after", run.response_text)
        self.assertIn("OpenAI server error (503)", run.response_text)
        self.assertIsNotNone(run.executed_at)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="   ")
    def test_execute_prompt_run_marks_needs_review_when_the_response_is_blank(self, mock_send_prompt):
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.status, PromptRun.Status.NEEDS_REVIEW)
        self.assertIn("empty response", run.response_text)
        self.assertIsNotNone(run.executed_at)

    def test_execute_prompt_run_transitions_through_running_before_a_terminal_state(self):
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(agency=agency, name="Acme's Client")
            prompt = Prompt.objects.create(agency=agency, client=client, text="Best dentist near downtown")
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        seen_statuses = []
        original_save = PromptRun.save

        def tracking_save(self, *args, **kwargs):
            seen_statuses.append(self.status)
            return original_save(self, *args, **kwargs)

        with patch.object(PromptRun, "save", tracking_save):
            tasks.execute_prompt_run.delay(str(run.id))

        # No OPENAI_API_KEY in the test environment, so this ends on
        # FAILED -- the point here is the RUNNING step in between, not
        # which terminal state it lands on (covered elsewhere).
        self.assertEqual(seen_statuses, [PromptRun.Status.RUNNING, PromptRun.Status.FAILED])

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="A great option.")
    def test_execute_prompt_run_sends_the_context_enriched_prompt_not_the_bare_text(self, mock_send_prompt):
        agency = Agency.objects.create(name="Acme")
        with use_agency(agency):
            client = Client.objects.create(
                agency=agency, name="Acme's Client", target_locations=["Austin, TX"], services=["General Dentistry"]
            )
            prompt = Prompt.objects.create(
                agency=agency,
                client=client,
                text="Best dentist near downtown for same-day appointments",
                service_tags=["Invisalign"],
                location_tags=["Round Rock, TX"],
            )
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        sent_text = mock_send_prompt.call_args[0][0]
        self.assertIn("Best dentist near downtown for same-day appointments", sent_text)
        # The prompt's own tags win over the client's general ones.
        self.assertIn("Round Rock, TX", sent_text)
        self.assertIn("Invisalign", sent_text)
        self.assertNotIn("Austin, TX", sent_text)
        # The stored snapshot itself stays exactly the bare question --
        # only what's actually sent to the provider is enriched.
        with use_agency(agency):
            run.refresh_from_db()
        self.assertEqual(run.prompt_text, "Best dentist near downtown for same-day appointments")


class PromptBuildingTests(TestCase):
    """core/prompt_building.py: turning a bare buyer-intent question
    into the text actually sent to an AI provider."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Acme's Client")

    def test_returns_the_bare_text_when_there_is_no_context_at_all(self):
        with use_agency(self.agency):
            prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best dentist near downtown"
            )
        self.assertEqual(build_effective_prompt(prompt.text, prompt), "Best dentist near downtown")

    def test_includes_the_prompts_own_location_and_service_tags(self):
        with use_agency(self.agency):
            prompt = Prompt.objects.create(
                agency=self.agency,
                client=self.client_obj,
                text="Best dentist near downtown",
                location_tags=["Austin, TX"],
                service_tags=["Invisalign"],
                category="Local search intent",
            )
        result = build_effective_prompt(prompt.text, prompt)
        self.assertIn("Best dentist near downtown", result)
        self.assertIn("Austin, TX", result)
        self.assertIn("Invisalign", result)
        self.assertIn("Local search intent", result)

    def test_falls_back_to_the_clients_locations_and_services_when_the_prompt_has_none(self):
        with use_agency(self.agency):
            self.client_obj.target_locations = ["Austin, TX"]
            self.client_obj.services = ["General Dentistry"]
            self.client_obj.save(update_fields=["target_locations", "services"])
            prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best dentist near downtown"
            )
        result = build_effective_prompt(prompt.text, prompt)
        self.assertIn("Austin, TX", result)
        self.assertIn("General Dentistry", result)

    def test_never_includes_the_clients_brand_name(self):
        # The whole point of a run is checking whether the brand comes
        # up organically -- naming it in the outbound question would
        # defeat that.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            prompt = Prompt.objects.create(
                agency=self.agency,
                client=self.client_obj,
                text="Best dentist near downtown",
                location_tags=["Austin, TX"],
            )
        result = build_effective_prompt(prompt.text, prompt)
        self.assertNotIn("Brightleaf", result)


class _StubProviderClient:
    """A do-nothing AIProviderClient stand-in for tests that exercise
    detect_mentions() without caring about the AI-assisted sentiment
    path specifically -- most of the response bodies below are either
    keyword-free or one-sided, so the rule-based stage resolves them
    without ever calling send_prompt. Sentiment-specific behavior is
    covered in SentimentClassificationTests instead."""

    def send_prompt(self, prompt_text):
        return "neutral"


class SentimentClassificationTests(TestCase):
    """core/sentiment.py: rule-based-first, AI-assisted-fallback tone
    classification for one mention's surrounding context. No real AI
    calls -- the AI-assisted stage is driven entirely by a mocked
    provider_client here."""

    def test_rule_based_detects_a_positive_keyword(self):
        context = "This is widely considered one of the best options in the area."
        self.assertEqual(classify_sentiment_rule_based(context), Mention.Sentiment.POSITIVE)

    def test_rule_based_detects_a_negative_keyword(self):
        context = "Multiple customers say to avoid this store due to poor quality."
        self.assertEqual(classify_sentiment_rule_based(context), Mention.Sentiment.NEGATIVE)

    def test_rule_based_is_neutral_with_no_signal_words(self):
        context = "This store is located downtown and open on weekdays."
        self.assertEqual(classify_sentiment_rule_based(context), Mention.Sentiment.NEUTRAL)

    def test_rule_based_is_none_when_genuinely_mixed(self):
        # Both a positive and a negative signal in the same window --
        # not confident enough to call it either way without help.
        context = "Some call it one of the best options, though others warn to avoid it."
        self.assertIsNone(classify_sentiment_rule_based(context))

    def test_extract_context_window_clamps_to_text_bounds(self):
        # A short text with a wide radius shouldn't raise/crash by
        # trying to slice past either end.
        text = "short"
        self.assertEqual(extract_context_window(text, 0, len(text), radius=100), "short")

    def test_extract_context_window_is_centered_on_the_mention(self):
        text = "A" * 200 + "TARGET" + "B" * 200
        start, end = 200, 206
        window = extract_context_window(text, start, end, radius=10)
        self.assertEqual(window, "A" * 10 + "TARGET" + "B" * 10)

    def test_classify_sentiment_uses_rule_based_result_without_calling_ai(self):
        text = "Acme Dental is one of the best clinics downtown."
        start = text.index("Acme Dental")
        provider = Mock()

        sentiment, source = classify_sentiment(text, start, start + len("Acme Dental"), "Acme Dental", provider)

        self.assertEqual(sentiment, Mention.Sentiment.POSITIVE)
        self.assertEqual(source, Mention.SentimentSource.RULE)
        provider.send_prompt.assert_not_called()

    def test_classify_sentiment_falls_back_to_ai_when_ambiguous(self):
        text = "Acme Dental is one of the best, though some reviews warn to avoid it."
        start = text.index("Acme Dental")
        provider = Mock()
        provider.send_prompt.return_value = "negative"

        sentiment, source = classify_sentiment(text, start, start + len("Acme Dental"), "Acme Dental", provider)

        self.assertEqual(sentiment, Mention.Sentiment.NEGATIVE)
        self.assertEqual(source, Mention.SentimentSource.AI)
        provider.send_prompt.assert_called_once()
        # The entity name is what the AI is asked to focus on.
        self.assertIn("Acme Dental", provider.send_prompt.call_args.args[0])

    def test_classify_sentiment_ai_response_defaults_to_neutral_when_unparseable(self):
        text = "Acme Dental is one of the best, though some reviews warn to avoid it."
        start = text.index("Acme Dental")
        provider = Mock()
        provider.send_prompt.return_value = "I'm not sure how to answer that."

        sentiment, source = classify_sentiment(text, start, start + len("Acme Dental"), "Acme Dental", provider)

        self.assertEqual(sentiment, Mention.Sentiment.NEUTRAL)
        self.assertEqual(source, Mention.SentimentSource.AI)

    def test_classify_sentiment_picks_whichever_sentiment_word_the_ai_said_first(self):
        # The AI is asked for exactly one word but doesn't always
        # comply -- if its answer technically contains more than one
        # valid sentiment word, the result must be picked
        # deterministically (whichever appears earliest in its raw
        # response), not by iterating an unordered set.
        text = "Acme Dental is one of the best, though some reviews warn to avoid it."
        start = text.index("Acme Dental")
        provider = Mock()
        provider.send_prompt.return_value = "Negative overall, despite a few positive reviews."

        sentiment, source = classify_sentiment(text, start, start + len("Acme Dental"), "Acme Dental", provider)

        self.assertEqual(sentiment, Mention.Sentiment.NEGATIVE)
        self.assertEqual(source, Mention.SentimentSource.AI)

    def test_classify_sentiment_defaults_to_neutral_when_the_ai_call_fails(self):
        text = "Acme Dental is one of the best, though some reviews warn to avoid it."
        start = text.index("Acme Dental")
        provider = Mock()
        provider.send_prompt.side_effect = AIProviderError("rate limited")

        sentiment, source = classify_sentiment(text, start, start + len("Acme Dental"), "Acme Dental", provider)

        self.assertEqual(sentiment, Mention.Sentiment.NEUTRAL)
        self.assertEqual(source, Mention.SentimentSource.AI)


class MentionDetectionTests(TestCase):
    """core/mention_detection.py: turning a completed PromptRun's raw
    response into Mention rows via core.matching.find_name_mentions
    (Week 3)."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Brightleaf Dental")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best dentist near downtown"
            )

    def _make_run(self, response_text):
        with use_agency(self.agency):
            return PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text=response_text,
            )

    def test_detects_the_clients_own_brand_by_primary_name(self):
        with use_agency(self.agency):
            brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is a great choice for same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 1)
            self.assertEqual(mentions[0].brand_id, brand.id)
            self.assertIsNone(mentions[0].competitor_id)
            self.assertEqual(mentions[0].term, "Brightleaf Dental")
            self.assertTrue(mentions[0].is_primary)
            self.assertEqual(
                run.response_text[mentions[0].start_index : mentions[0].end_index], "Brightleaf Dental"
            )

    def test_detects_a_brand_alias_as_non_primary(self):
        with use_agency(self.agency):
            Brand.objects.create(
                agency=self.agency, client=self.client_obj, name="Brightleaf Dental", aliases=["Brightleaf"]
            )
            run = self._make_run("Brightleaf offers same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 1)
            self.assertEqual(mentions[0].term, "Brightleaf")
            self.assertFalse(mentions[0].is_primary)

    def test_detects_a_tracked_competitor(self):
        with use_agency(self.agency):
            competitor = Competitor.objects.create(
                agency=self.agency, client=self.client_obj, name="Downtown Dental Co"
            )
            run = self._make_run("Downtown Dental Co is also a popular option nearby.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 1)
            self.assertEqual(mentions[0].competitor_id, competitor.id)
            self.assertIsNone(mentions[0].brand_id)

    def test_no_mentions_when_nothing_matches(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Downtown Dental Co")
            run = self._make_run("Several clinics in the area offer same-day appointments.")

            self.assertEqual(detect_mentions(run, _StubProviderClient()), [])

    def test_multiple_occurrences_create_multiple_rows(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is great. I'd recommend Brightleaf Dental to anyone.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 2)
            self.assertEqual([m.mention_order for m in mentions], [1, 2])

    def test_mention_order_spans_brand_and_competitors_together(self):
        # mention_order is one shared sequence across every entity in
        # the response, not restarted per brand/competitor.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            rival = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Downtown Dental Co")
            run = self._make_run("Downtown Dental Co is popular, but Brightleaf Dental is our top pick.")

            mentions = detect_mentions(run, _StubProviderClient())

            by_term = {m.term: m for m in mentions}
            self.assertEqual(by_term["Downtown Dental Co"].mention_order, 1)  # appears first in the raw text
            self.assertEqual(by_term["Brightleaf Dental"].mention_order, 2)
            self.assertEqual(by_term["Downtown Dental Co"].competitor_id, rival.id)

    def test_list_rank_is_captured_from_a_numbered_recommendation(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            rival = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Downtown Dental Co")
            run = self._make_run(
                "Top picks near downtown:\n"
                "1. Downtown Dental Co -- known for sedation options\n"
                "2. Brightleaf Dental -- known for same-day visits"
            )

            mentions = detect_mentions(run, _StubProviderClient())

            by_term = {m.term: m for m in mentions}
            self.assertEqual(by_term["Downtown Dental Co"].list_rank, 1)
            self.assertEqual(by_term["Brightleaf Dental"].list_rank, 2)
            # List rank and raw mention_order aren't the same axis --
            # both happen to agree here since the list is in text order,
            # but they're independently stored.
            self.assertEqual(by_term["Downtown Dental Co"].mention_order, 1)
            self.assertEqual(by_term["Brightleaf Dental"].mention_order, 2)
            self.assertEqual(rival.id, by_term["Downtown Dental Co"].competitor_id)

    def test_list_rank_is_null_when_the_response_has_no_numbered_list(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is a solid, no-frills choice for same-day visits.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertIsNone(mentions[0].list_rank)
            self.assertEqual(mentions[0].mention_order, 1)

    def test_client_without_a_brand_still_checks_competitors(self):
        # Brand is a OneToOneField -- a client with none set shouldn't
        # crash detection, just skip that half of it.
        with use_agency(self.agency):
            competitor = Competitor.objects.create(
                agency=self.agency, client=self.client_obj, name="Downtown Dental Co"
            )
            run = self._make_run("Downtown Dental Co is a popular option nearby.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 1)
            self.assertEqual(mentions[0].competitor_id, competitor.id)

    def test_detects_the_brand_and_several_different_competitors_in_one_response(self):
        # A single AI answer commonly names more than one business --
        # the client's own brand plus however many competitors it
        # happens to also mention -- and each needs its own correctly
        # attributed Mention row, not just the first match found.
        with use_agency(self.agency):
            brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            rival_1 = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Downtown Dental Co")
            rival_2 = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Smile Studio")
            run = self._make_run(
                "Top picks near downtown: Brightleaf Dental for same-day visits, "
                "Downtown Dental Co for sedation, and Smile Studio for cosmetic work."
            )

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 3)
            by_term = {m.term: m for m in mentions}
            self.assertEqual(by_term["Brightleaf Dental"].brand_id, brand.id)
            self.assertEqual(by_term["Downtown Dental Co"].competitor_id, rival_1.id)
            self.assertEqual(by_term["Smile Studio"].competitor_id, rival_2.id)
            # Each stays attributed to exactly one kind of entity.
            self.assertIsNone(by_term["Brightleaf Dental"].competitor_id)
            self.assertIsNone(by_term["Downtown Dental Co"].brand_id)
            self.assertIsNone(by_term["Smile Studio"].brand_id)

    def test_rerunning_detection_replaces_rather_than_duplicates(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is a great choice.")

            detect_mentions(run, _StubProviderClient())
            second_pass = detect_mentions(run, _StubProviderClient())

            with use_agency(self.agency):
                self.assertEqual(Mention.objects.filter(prompt_run=run).count(), 1)
            self.assertEqual(len(second_pass), 1)

    def test_detect_mentions_stores_rule_based_sentiment_without_an_ai_call(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is one of the best choices for same-day appointments.")
            stub = Mock()

            mentions = detect_mentions(run, stub)

            self.assertEqual(mentions[0].sentiment, Mention.Sentiment.POSITIVE)
            self.assertEqual(mentions[0].sentiment_source, Mention.SentimentSource.RULE)
            stub.send_prompt.assert_not_called()

    def test_detect_mentions_stores_negative_sentiment(self):
        with use_agency(self.agency):
            Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Downtown Dental Co")
            run = self._make_run("Reviewers warn to avoid Downtown Dental Co due to poor service.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(mentions[0].sentiment, Mention.Sentiment.NEGATIVE)
            self.assertEqual(mentions[0].sentiment_source, Mention.SentimentSource.RULE)

    def test_detect_mentions_falls_back_to_ai_for_an_ambiguous_context(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run(
                "Brightleaf Dental is one of the best choices, though some reviews warn to avoid it."
            )
            stub = Mock()
            stub.send_prompt.return_value = "negative"

            mentions = detect_mentions(run, stub)

            self.assertEqual(mentions[0].sentiment, Mention.Sentiment.NEGATIVE)
            self.assertEqual(mentions[0].sentiment_source, Mention.SentimentSource.AI)
            stub.send_prompt.assert_called_once()

    def test_execute_prompt_run_creates_mentions_for_a_completed_run(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")

        with override_settings(OPENAI_API_KEY="sk-test-key"), patch(
            "core.ai_providers.OpenAIProviderClient.send_prompt",
            return_value="Brightleaf Dental is a great choice for same-day appointments.",
        ):
            with use_agency(self.agency):
                run = PromptRun.objects.create(
                    agency=self.agency,
                    prompt=self.prompt,
                    prompt_text=self.prompt.text,
                    provider=AIProvider.OPENAI,
                    status=PromptRun.Status.QUEUED,
                )
            tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(self.agency):
            self.assertEqual(Mention.objects.filter(prompt_run=run).count(), 1)

    def test_execute_prompt_run_creates_no_mentions_for_a_failed_run(self):
        # A FAILED run's response_text is our own error message, not AI
        # content -- it must never be scanned for brand/competitor
        # mentions.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )

        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(self.agency):
            run.refresh_from_db()
            self.assertEqual(run.status, PromptRun.Status.FAILED)
            self.assertEqual(Mention.objects.filter(prompt_run=run).count(), 0)

    def test_execute_prompt_run_survives_a_crash_in_mention_analysis(self):
        # A bug or transient error in mention/citation detection is a
        # secondary, best-effort layer on top of a real, already-saved
        # answer -- it must never crash the whole task or leave a
        # genuinely successful run in an unhandled-exception state.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")

        with (
            override_settings(OPENAI_API_KEY="sk-test-key"),
            patch(
                "core.ai_providers.OpenAIProviderClient.send_prompt",
                return_value="Brightleaf Dental is a great choice for same-day appointments.",
            ),
            patch("core.tasks.detect_mentions", side_effect=RuntimeError("boom")),
        ):
            with use_agency(self.agency):
                run = PromptRun.objects.create(
                    agency=self.agency,
                    prompt=self.prompt,
                    prompt_text=self.prompt.text,
                    provider=AIProvider.OPENAI,
                    status=PromptRun.Status.QUEUED,
                )
            tasks.execute_prompt_run.delay(str(run.id))  # must not raise

        with use_agency(self.agency):
            run.refresh_from_db()
            self.assertEqual(run.status, PromptRun.Status.COMPLETED)
            self.assertEqual(run.response_text, "Brightleaf Dental is a great choice for same-day appointments.")
            self.assertEqual(Mention.objects.filter(prompt_run=run).count(), 0)

    def test_detect_mentions_stores_full_confidence_for_a_clean_primary_match(self):
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is a great choice for same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(mentions[0].confidence_score, 1.0)
            self.assertFalse(mentions[0].needs_review)

    def test_detect_mentions_flags_a_short_alias_match_as_needing_review(self):
        with use_agency(self.agency):
            Brand.objects.create(
                agency=self.agency, client=self.client_obj, name="Brightleaf Dental", aliases=["BD"]
            )
            run = self._make_run("BD is a great choice for same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            # alias (-0.15) + <=3 chars (-0.4) = 0.45, below the default
            # 0.5 review threshold.
            self.assertAlmostEqual(mentions[0].confidence_score, 0.45)
            self.assertTrue(mentions[0].needs_review)

    @override_settings(MENTION_CONFIDENCE_REVIEW_THRESHOLD=1.1)
    def test_confidence_review_threshold_is_configurable_stricter(self):
        # Even a perfect 1.0 match gets flagged once the threshold is
        # raised above what any match can score -- proves the threshold
        # actually drives the flag rather than being hardcoded.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run("Brightleaf Dental is a great choice for same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(mentions[0].confidence_score, 1.0)
            self.assertTrue(mentions[0].needs_review)

    @override_settings(MENTION_CONFIDENCE_REVIEW_THRESHOLD=0.0)
    def test_confidence_review_threshold_is_configurable_more_lenient(self):
        # Lowering the threshold to 0.0 means nothing gets flagged, even
        # a shaky short-alias match.
        with use_agency(self.agency):
            Brand.objects.create(
                agency=self.agency, client=self.client_obj, name="Brightleaf Dental", aliases=["BD"]
            )
            run = self._make_run("BD is a great choice for same-day appointments.")

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertAlmostEqual(mentions[0].confidence_score, 0.45)
            self.assertFalse(mentions[0].needs_review)

    def test_detect_mentions_scores_a_compound_name_match_lower(self):
        # Real Week 7 finding, reproduced end-to-end: a name that reads
        # as the start of a longer proper noun in the actual response
        # ("Brightleaf Dental Plaza", a shopping plaza, not the tracked
        # brand) scores lower than a clean standalone mention elsewhere
        # in the same response.
        with use_agency(self.agency):
            Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            run = self._make_run(
                "Brightleaf Dental is a great choice. It's located inside Brightleaf Dental Plaza."
            )

            mentions = detect_mentions(run, _StubProviderClient())

            self.assertEqual(len(mentions), 2)
            self.assertEqual(mentions[0].confidence_score, 1.0)
            self.assertAlmostEqual(mentions[1].confidence_score, 0.75)
            self.assertFalse(mentions[1].needs_review)


class MentionDetectionFormatTests(TestCase):
    """detect_mentions against the range of shapes a real AI response
    actually takes -- numbered lists, plain prose, and comparison
    tables -- plus edge cases (brand absent, mentioned repeatedly,
    ambiguous/unranked lists) called out in today's dev task. Each test
    uses a full, realistic response body rather than a one-line snippet,
    since format-detection bugs tend to hide in the surrounding
    structure, not the mention itself."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Brightleaf Dental")
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Brightleaf Dental")
            self.rival_1 = Competitor.objects.create(
                agency=self.agency, client=self.client_obj, name="Downtown Dental Co"
            )
            self.rival_2 = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Smile Studio")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best dentist near downtown"
            )

    def _run(self, response_text):
        with use_agency(self.agency):
            return PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text=response_text,
            )

    def _by_term(self, mentions):
        return {m.term: m for m in mentions}

    def _detect(self, run):
        with use_agency(self.agency):
            return detect_mentions(run, _StubProviderClient())

    # --- Format: numbered list ------------------------------------

    def test_numbered_list_format(self):
        run = self._run(
            "Here are the top picks near downtown:\n"
            "1. Downtown Dental Co -- known for sedation dentistry.\n"
            "2. Brightleaf Dental -- known for same-day visits.\n"
            "3. Smile Studio -- known for cosmetic work.\n"
        )
        mentions = self._by_term(self._detect(run))
        self.assertEqual(mentions["Downtown Dental Co"].list_rank, 1)
        self.assertEqual(mentions["Brightleaf Dental"].list_rank, 2)
        self.assertEqual(mentions["Smile Studio"].list_rank, 3)
        self.assertEqual({m.competitor_id for t, m in mentions.items() if t != "Brightleaf Dental"},
                          {self.rival_1.id, self.rival_2.id})
        self.assertEqual(mentions["Brightleaf Dental"].brand_id, self.brand.id)

    # --- Format: prose paragraph, no list structure -----------------

    def test_prose_paragraph_format(self):
        run = self._run(
            "For same-day dental visits near downtown, Brightleaf Dental is a popular, no-frills choice. "
            "Some patients also consider Downtown Dental Co if sedation is needed, though it tends to be "
            "pricier. Smile Studio is another option worth a look for cosmetic work specifically."
        )
        mentions = self._by_term(self._detect(run))
        self.assertEqual(len(mentions), 3)
        # Prose has no numbered structure -- every mention is an
        # ordinary text occurrence, not a ranked recommendation.
        self.assertTrue(all(m.list_rank is None for m in mentions.values()))
        # Raw mention_order still reflects reading order, independent
        # of any (nonexistent) list rank.
        self.assertEqual(mentions["Brightleaf Dental"].mention_order, 1)
        self.assertEqual(mentions["Downtown Dental Co"].mention_order, 2)
        self.assertEqual(mentions["Smile Studio"].mention_order, 3)

    # --- Format: markdown comparison table --------------------------

    def test_comparison_table_format_with_a_rank_column(self):
        run = self._run(
            "| Rank | Clinic | Best For |\n"
            "|------|--------|----------|\n"
            "| 1 | Downtown Dental Co | Sedation dentistry |\n"
            "| 2 | Brightleaf Dental | Same-day visits |\n"
            "| 3 | Smile Studio | Cosmetic work |\n"
        )
        mentions = self._by_term(self._detect(run))
        self.assertEqual(mentions["Downtown Dental Co"].list_rank, 1)
        self.assertEqual(mentions["Brightleaf Dental"].list_rank, 2)
        self.assertEqual(mentions["Smile Studio"].list_rank, 3)

    def test_comparison_table_format_without_a_rank_column(self):
        # A side-by-side comparison isn't necessarily an ordered
        # ranking -- no numeric column means no rank should be claimed.
        run = self._run(
            "| Clinic | Known For |\n"
            "|--------|-----------|\n"
            "| Brightleaf Dental | Same-day visits |\n"
            "| Downtown Dental Co | Sedation dentistry |\n"
        )
        mentions = self._by_term(self._detect(run))
        self.assertTrue(all(m.list_rank is None for m in mentions.values()))

    # --- Edge case: brand not mentioned at all ----------------------

    def test_edge_case_brand_not_mentioned(self):
        run = self._run(
            "1. Downtown Dental Co -- known for sedation dentistry.\n2. Smile Studio -- known for cosmetic work.\n"
        )
        mentions = self._by_term(self._detect(run))
        self.assertNotIn("Brightleaf Dental", mentions)
        self.assertEqual(len(mentions), 2)
        self.assertTrue(all(m.brand_id is None for m in mentions.values()))

    # --- Edge case: brand mentioned multiple times, mixed formats ---

    def test_edge_case_brand_mentioned_multiple_times_across_the_response(self):
        run = self._run(
            "1. Brightleaf Dental -- our top pick for same-day visits.\n"
            "2. Downtown Dental Co -- a solid alternative.\n\n"
            "In short, Brightleaf Dental stands out for convenience, and many patients specifically "
            "search for Brightleaf Dental when they need a same-day appointment."
        )
        mentions = [m for m in self._detect(run) if m.brand_id == self.brand.id]
        self.assertEqual(len(mentions), 3)
        # The first occurrence (the actual list item) carries the real
        # rank; the later prose repeats don't retroactively gain one --
        # each mention's rank reflects *where that specific occurrence*
        # sits, not the entity's best rank anywhere in the response.
        self.assertEqual(mentions[0].list_rank, 1)
        self.assertIsNone(mentions[1].list_rank)
        self.assertIsNone(mentions[2].list_rank)
        self.assertEqual([m.mention_order for m in mentions], [1, 3, 4])

    # --- Edge case: ambiguous / unranked list ------------------------

    def test_edge_case_unordered_bullet_list_has_no_rank(self):
        run = self._run(
            "A few solid options near downtown:\n"
            "- Brightleaf Dental\n"
            "- Downtown Dental Co\n"
            "- Smile Studio\n"
        )
        mentions = self._detect(run)
        self.assertEqual(len(mentions), 3)
        self.assertTrue(all(m.list_rank is None for m in mentions))

    def test_edge_case_two_separate_ranked_lists_do_not_bleed_into_each_other(self):
        run = self._run(
            "Best for same-day visits:\n"
            "1. Brightleaf Dental\n"
            "2. Downtown Dental Co\n\n"
            "Best for cosmetic work:\n"
            "1. Smile Studio\n"
            "2. Brightleaf Dental\n"
        )
        mentions = [m for m in self._detect(run) if m.brand_id == self.brand.id]
        self.assertEqual(len(mentions), 2)
        self.assertEqual(mentions[0].list_rank, 1)  # first list, item 1
        self.assertEqual(mentions[1].list_rank, 2)  # second list, item 2 -- not a global rank


class CitationExtractionTests(TestCase):
    """core/citations.py: pure-function URL extraction and domain
    normalization -- no DB involved."""

    def test_normalize_domain_strips_protocol_and_www(self):
        self.assertEqual(normalize_domain("https://www.Example.com/page"), "example.com")

    def test_normalize_domain_strips_port(self):
        self.assertEqual(normalize_domain("http://example.com:8080/page"), "example.com")

    def test_normalize_domain_strips_userinfo(self):
        self.assertEqual(normalize_domain("https://user:pass@example.com/page"), "example.com")

    def test_normalize_domain_leaves_a_subdomain_alone(self):
        # Deliberately not a full public-suffix-aware "root domain"
        # reduction -- see the docstring.
        self.assertEqual(normalize_domain("https://blog.example.com/post"), "blog.example.com")

    def test_normalize_domain_handles_a_bare_domain_with_no_scheme(self):
        self.assertEqual(normalize_domain("www.example.com/page"), "example.com")

    def test_extract_citations_finds_a_markdown_link_with_title(self):
        text = "See [Master Replica](https://masterreplica.pk/) for details."
        citations = extract_citations(text)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["url"], "https://masterreplica.pk/")
        self.assertEqual(citations[0]["title"], "Master Replica")
        self.assertEqual(citations[0]["domain"], "masterreplica.pk")

    def test_extract_citations_finds_a_bare_url_with_no_title(self):
        text = "More info at https://masterreplica.pk/about for details."
        citations = extract_citations(text)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["url"], "https://masterreplica.pk/about")
        self.assertEqual(citations[0]["title"], "")

    def test_extract_citations_strips_trailing_punctuation_from_a_bare_url(self):
        text = "Check https://masterreplica.pk/about."
        citations = extract_citations(text)
        self.assertEqual(citations[0]["url"], "https://masterreplica.pk/about")

    def test_extract_citations_does_not_double_count_a_markdown_links_own_url(self):
        text = "See [Master Replica](https://masterreplica.pk/) here."
        citations = extract_citations(text)
        self.assertEqual(len(citations), 1)

    def test_extract_citations_deduplicates_the_same_url_keeping_first_title(self):
        text = (
            "[Master Replica](https://masterreplica.pk/) is popular. "
            "Later, [MR](https://masterreplica.pk/) is mentioned again."
        )
        citations = extract_citations(text)
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["title"], "Master Replica")

    def test_extract_citations_finds_multiple_distinct_sources(self):
        text = (
            "### 1. [Master Replica](https://masterreplica.pk/)\n"
            "### 2. [Replica Zone](https://www.ladiesreplica.com/)\n"
        )
        citations = extract_citations(text)
        domains = {c["domain"] for c in citations}
        self.assertEqual(domains, {"masterreplica.pk", "ladiesreplica.com"})

    def test_extract_citations_returns_empty_list_for_blank_text(self):
        self.assertEqual(extract_citations(""), [])

    def test_extract_citations_returns_empty_list_when_no_urls_present(self):
        self.assertEqual(extract_citations("A plain answer with no sources at all."), [])


class CitationStorageTests(TestCase):
    """core/citations.py: store_citations wiring citations to a
    PromptRun, plus its idempotency and status-gating in
    execute_prompt_run."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best dentist near downtown"
            )

    def _run(self, response_text, status=PromptRun.Status.COMPLETED):
        with use_agency(self.agency):
            return PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=status,
                response_text=response_text,
            )

    def test_store_citations_creates_one_row_per_unique_url(self):
        run = self._run(
            "### 1. [Master Replica](https://masterreplica.pk/)\n"
            "### 2. [Replica Zone](https://www.ladiesreplica.com/)\n"
        )
        with use_agency(self.agency):
            created = store_citations(run)
            self.assertEqual(len(created), 2)
            self.assertEqual(Citation.objects.filter(prompt_run=run).count(), 2)

    def test_store_citations_sets_agency_and_prompt_run(self):
        run = self._run("See [Master Replica](https://masterreplica.pk/) for details.")
        with use_agency(self.agency):
            citation = store_citations(run)[0]
            self.assertEqual(citation.agency_id, self.agency.id)
            self.assertEqual(citation.prompt_run_id, run.id)
            self.assertEqual(citation.domain, "masterreplica.pk")

    def test_store_citations_is_empty_when_no_urls_present(self):
        run = self._run("A plain answer with no sources at all.")
        with use_agency(self.agency):
            self.assertEqual(store_citations(run), [])

    def test_rerunning_store_citations_replaces_rather_than_duplicates(self):
        run = self._run("See [Master Replica](https://masterreplica.pk/) for details.")
        with use_agency(self.agency):
            store_citations(run)
            second_pass = store_citations(run)
            self.assertEqual(Citation.objects.filter(prompt_run=run).count(), 1)
        self.assertEqual(len(second_pass), 1)

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt")
    def test_execute_prompt_run_stores_citations_for_a_completed_run(self, mock_send_prompt):
        mock_send_prompt.return_value = "See [Master Replica](https://masterreplica.pk/) for details."
        with use_agency(self.agency):
            run = PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )
        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(self.agency):
            self.assertEqual(Citation.objects.filter(prompt_run=run).count(), 1)

    def test_execute_prompt_run_does_not_store_citations_for_a_failed_run(self):
        # A FAILED run's response_text is our own error message (which
        # can itself contain a URL, e.g. a rate-limit docs link) -- it
        # must never be scanned for citations.
        with use_agency(self.agency):
            run = PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.OPENAI,
                status=PromptRun.Status.QUEUED,
            )
        tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(self.agency):
            run.refresh_from_db()
            self.assertEqual(run.status, PromptRun.Status.FAILED)
            self.assertEqual(Citation.objects.filter(prompt_run=run).count(), 0)

    def test_store_citations_truncates_an_oversized_url_instead_of_erroring(self):
        # An unusually long URL (a tracking/redirect link with a huge
        # query string, say) would otherwise fail at the database level
        # -- and since each Citation is created independently, that one
        # bad row could leave the run with only *some* of its citations
        # stored. Truncating keeps every citation this run actually had.
        oversized_url = "https://example.com/?" + ("a" * 2100)
        run = self._run(f"See [Source]({oversized_url}) for details.")

        with use_agency(self.agency):
            created = store_citations(run)
            self.assertEqual(len(created), 1)
            self.assertLessEqual(len(created[0].url), 2000)
            self.assertEqual(created[0].url, oversized_url[:2000])


class MentionCitationLinkingTests(TestCase):
    """core/mention_citations.py: associating each Mention with whichever
    of the same response's Citations actually support it -- zero, one,
    or several on either side -- and querying that relationship in both
    directions (mention -> citations, citation -> mentions) the way a
    later dashboard/report would."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Grace Replica")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best replica clothing store"
            )
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Grace Replica")
            self.competitor = Competitor.objects.create(
                agency=self.agency, client=self.client_obj, name="Master Replica"
            )

    def _process(self, response_text):
        with use_agency(self.agency):
            run = PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text=response_text,
            )
            detect_mentions(run, _StubProviderClient())
            store_citations(run)
            link_mention_citations(run)
            return run

    def test_mention_with_a_citation_in_the_same_sentence_is_linked(self):
        run = self._process("Grace Replica is a great choice [[1]](https://gracereplica.store/). It ships fast.")
        with use_agency(self.agency):
            mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            citations = list(mention.citations.all())
            self.assertEqual(len(citations), 1)
            self.assertEqual(citations[0].url, "https://gracereplica.store/")

    def test_mention_with_no_nearby_citation_has_an_empty_citation_set(self):
        run = self._process("Grace Replica is a solid pick, with no sources cited here at all.")
        with use_agency(self.agency):
            mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            self.assertEqual(list(mention.citations.all()), [])

    def test_mention_with_two_citations_in_the_same_segment_gets_both(self):
        run = self._process(
            "Grace Replica is well reviewed [[1]](https://a.example.com/) [[2]](https://b.example.com/)."
        )
        with use_agency(self.agency):
            mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            urls = {c.url for c in mention.citations.all()}
            self.assertEqual(urls, {"https://a.example.com/", "https://b.example.com/"})

    def test_numbered_list_items_do_not_share_each_others_citations(self):
        run = self._process(
            "1. **Master Replica** - excellent quality [[1]](https://masterreplica.pk/)\n"
            "2. **Grace Replica** - also solid [[2]](https://gracereplica.store/)\n"
        )
        with use_agency(self.agency):
            competitor_mention = Mention.objects.get(prompt_run=run, competitor=self.competitor)
            brand_mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            self.assertEqual([c.url for c in competitor_mention.citations.all()], ["https://masterreplica.pk/"])
            self.assertEqual([c.url for c in brand_mention.citations.all()], ["https://gracereplica.store/"])

    def test_one_citation_can_support_two_mentions_in_the_same_segment(self):
        run = self._process(
            "Both Grace Replica and Master Replica are listed here [[1]](https://comparison.example.com/)."
        )
        with use_agency(self.agency):
            brand_mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            competitor_mention = Mention.objects.get(prompt_run=run, competitor=self.competitor)
            citation = Citation.objects.get(prompt_run=run)
            self.assertIn(citation, brand_mention.citations.all())
            self.assertIn(citation, competitor_mention.citations.all())

    def test_citation_reverse_query_returns_its_supporting_mentions(self):
        # The direction a dashboard/report would actually use: "for this
        # source, which mentions does it back?"
        run = self._process(
            "Both Grace Replica and Master Replica are listed here [[1]](https://comparison.example.com/)."
        )
        with use_agency(self.agency):
            citation = Citation.objects.get(prompt_run=run)
            supported_terms = {mention.term for mention in citation.mentions.all()}
            self.assertEqual(supported_terms, {"Grace Replica", "Master Replica"})

    def test_rerunning_link_replaces_rather_than_accumulates(self):
        run = self._process("Grace Replica is great [[1]](https://gracereplica.store/).")
        with use_agency(self.agency):
            mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            link_mention_citations(run)
            self.assertEqual(mention.citations.count(), 1)

    def test_execute_prompt_run_links_citations_to_mentions_end_to_end(self):
        with override_settings(OPENAI_API_KEY="sk-test-key"), patch(
            "core.ai_providers.OpenAIProviderClient.send_prompt",
            return_value="Grace Replica is a great choice [[1]](https://gracereplica.store/).",
        ):
            with use_agency(self.agency):
                run = PromptRun.objects.create(
                    agency=self.agency,
                    prompt=self.prompt,
                    prompt_text=self.prompt.text,
                    provider=AIProvider.OPENAI,
                    status=PromptRun.Status.QUEUED,
                )
            tasks.execute_prompt_run.delay(str(run.id))

        with use_agency(self.agency):
            mention = Mention.objects.get(prompt_run=run, brand=self.brand)
            self.assertEqual([c.url for c in mention.citations.all()], ["https://gracereplica.store/"])


class VisibilityScoreTests(TestCase):
    """core/visibility_score.py: the RankLens Visibility Score formula
    (0.40 x Mention Rate + 0.25 x Position Score + 0.20 x Sentiment
    Score + 0.15 x Citation Score), verified against hand-calculated
    scenarios. Mention/Citation rows are created directly here rather
    than through the detection pipeline, so every number in a scenario
    is exact and traceable to this test, not to how detect_mentions
    happens to format a particular response."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Grace Replica")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best replica clothing store"
            )
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Grace Replica")

    def _completed_run(self, executed_at=None, response_text=None, prompt=None):
        # Unique per call by default -- these represent independent
        # sample runs unless a test explicitly passes a shared
        # response_text to exercise duplicate-response handling.
        response_text = response_text if response_text is not None else f"irrelevant for this test ({uuid.uuid4()})"
        with use_agency(self.agency):
            return PromptRun.objects.create(
                agency=self.agency,
                prompt=prompt or self.prompt,
                prompt_text=(prompt or self.prompt).text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text=response_text,
                executed_at=executed_at or timezone.now(),
            )

    def _mention(self, run, entity=None, *, list_rank=None, sentiment=Mention.Sentiment.NEUTRAL, order=1, cited=False):
        entity = entity if entity is not None else self.brand
        is_brand = isinstance(entity, Brand)
        with use_agency(self.agency):
            mention = Mention.objects.create(
                agency=self.agency,
                prompt_run=run,
                client=self.client_obj,
                brand=entity if is_brand else None,
                competitor=None if is_brand else entity,
                term=entity.name,
                is_primary=True,
                start_index=0,
                end_index=len(entity.name),
                mention_order=order,
                list_rank=list_rank,
                sentiment=sentiment,
                sentiment_source=Mention.SentimentSource.RULE,
            )
            if cited:
                citation = Citation.objects.create(
                    agency=self.agency,
                    prompt_run=run,
                    url="https://gracereplica.store/",
                    domain="gracereplica.store",
                )
                mention.citations.add(citation)
            return mention

    def test_weights_sum_to_one(self):
        # The formula's own weights, pinned down so a future edit that
        # breaks this invariant fails loudly here rather than silently
        # producing a score that isn't really 0.0-1.0 anymore.
        total = MENTION_RATE_WEIGHT + POSITION_SCORE_WEIGHT + SENTIMENT_SCORE_WEIGHT + CITATION_SCORE_WEIGHT
        self.assertAlmostEqual(total, 1.0)

    def test_no_completed_runs_returns_none(self):
        with use_agency(self.agency):
            self.assertIsNone(compute_visibility_score(self.brand))

    def test_completed_runs_with_zero_mentions_scores_all_zero(self):
        for _ in range(3):
            self._completed_run()

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.total_runs, 3)
        self.assertEqual(result.mention_count, 0)
        self.assertEqual(result.mention_rate, 0.0)
        self.assertEqual(result.position_score, 0.0)
        self.assertEqual(result.sentiment_score, 0.0)
        self.assertEqual(result.citation_score, 0.0)
        self.assertEqual(result.visibility_score, 0.0)

    def test_perfect_score_when_ranked_first_positive_and_cited_every_run(self):
        for _ in range(2):
            run = self._completed_run()
            self._mention(run, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.mention_rate, 1.0)
        self.assertEqual(result.position_score, 1.0)
        self.assertEqual(result.sentiment_score, 1.0)
        self.assertEqual(result.citation_score, 1.0)
        self.assertAlmostEqual(result.visibility_score, 1.0)

    def test_hand_calculated_mixed_scenario(self):
        # Run 1: mentioned, ranked #1, positive, cited.
        run1 = self._completed_run()
        self._mention(run1, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True)
        # Run 2: mentioned, plain prose (no list rank), neutral, not cited.
        run2 = self._completed_run()
        self._mention(run2, list_rank=None, sentiment=Mention.Sentiment.NEUTRAL, cited=False)
        # Runs 3 & 4: not mentioned at all.
        self._completed_run()
        self._completed_run()

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        # Mention Rate = 2 of 4 runs mentioned it = 0.5
        self.assertAlmostEqual(result.mention_rate, 0.5)
        # Position Score = average(1/1, 0.5) = 0.75
        self.assertAlmostEqual(result.position_score, 0.75)
        # Sentiment Score = average(1.0, 0.5) = 0.75
        self.assertAlmostEqual(result.sentiment_score, 0.75)
        # Citation Score = average(1, 0) = 0.5
        self.assertAlmostEqual(result.citation_score, 0.5)
        # Visibility Score = 0.40*0.5 + 0.25*0.75 + 0.20*0.75 + 0.15*0.5
        #                   = 0.20 + 0.1875 + 0.15 + 0.075 = 0.6125
        self.assertAlmostEqual(result.visibility_score, 0.6125)

    def test_multiple_mentions_in_the_same_run_all_count_toward_the_averages(self):
        run = self._completed_run()
        self._mention(run, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True, order=1)
        self._mention(run, list_rank=3, sentiment=Mention.Sentiment.NEGATIVE, cited=False, order=2)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        # Only 1 run total, and it has a mention -- Mention Rate is
        # about *runs*, not raw mention count.
        self.assertEqual(result.total_runs, 1)
        self.assertEqual(result.mention_count, 2)
        self.assertAlmostEqual(result.mention_rate, 1.0)
        # Position Score = average(1/1, 1/3)
        self.assertAlmostEqual(result.position_score, (1.0 + 1 / 3) / 2)
        # Sentiment Score = average(1.0, 0.0) = 0.5
        self.assertAlmostEqual(result.sentiment_score, 0.5)
        # Citation Score = average(1, 0) = 0.5
        self.assertAlmostEqual(result.citation_score, 0.5)
        expected = 0.40 * 1.0 + 0.25 * ((1.0 + 1 / 3) / 2) + 0.20 * 0.5 + 0.15 * 0.5
        self.assertAlmostEqual(result.visibility_score, expected)

    def test_unranked_mention_scores_a_neutral_half_position(self):
        run = self._completed_run()
        self._mention(run, list_rank=None)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.position_score, 0.5)

    def test_works_for_a_competitor_the_same_way_as_a_brand(self):
        with use_agency(self.agency):
            competitor = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Master Replica")
        run = self._completed_run()
        self._mention(run, entity=competitor, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=False)

        with use_agency(self.agency):
            result = compute_visibility_score(competitor)

        self.assertEqual(result.mention_rate, 1.0)
        self.assertEqual(result.position_score, 1.0)
        self.assertEqual(result.sentiment_score, 1.0)
        self.assertEqual(result.citation_score, 0.0)

    def test_rejects_something_that_is_not_a_brand_or_competitor(self):
        with use_agency(self.agency), self.assertRaises(TypeError):
            compute_visibility_score(self.client_obj)

    def test_since_excludes_runs_executed_before_it(self):
        with use_agency(self.agency):
            old_run = self._completed_run()
            PromptRun.objects.filter(pk=old_run.pk).update(
                executed_at=datetime(2020, 1, 1, tzinfo=UTC)
            )
            old_run.refresh_from_db()
        self._mention(old_run, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True)
        recent_run = self._completed_run()
        self._mention(recent_run, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand, since=datetime(2025, 1, 1, tzinfo=UTC))

        self.assertEqual(result.total_runs, 1)
        self.assertEqual(result.runs[0].id, recent_run.id)

    def test_until_excludes_runs_executed_after_it(self):
        with use_agency(self.agency):
            old_run = self._completed_run()
            PromptRun.objects.filter(pk=old_run.pk).update(
                executed_at=datetime(2020, 1, 1, tzinfo=UTC)
            )
            old_run.refresh_from_db()
        recent_run = self._completed_run()

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand, until=datetime(2025, 1, 1, tzinfo=UTC))

        self.assertEqual(result.total_runs, 1)
        self.assertEqual(result.runs[0].id, old_run.id)
        self.assertNotEqual(result.runs[0].id, recent_run.id)

    def test_result_carries_the_exact_runs_and_mentions_it_computed_from(self):
        # The traceability guarantee: .runs/.mentions on the result are
        # the *same* rows the aggregate numbers were computed from, not
        # a separate approximation a caller has to trust.
        run = self._completed_run()
        mention = self._mention(run, list_rank=1, sentiment=Mention.Sentiment.POSITIVE, cited=True)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual([r.id for r in result.runs], [run.id])
        self.assertEqual([m.id for m in result.mentions], [mention.id])

    def test_duplicate_responses_for_the_same_prompt_count_as_one_run(self):
        # Three runs, but two are byte-for-byte identical answers to
        # the same prompt (e.g. a manual re-run that happened to come
        # back the same) -- that's one real sample of AI behavior, not
        # three, so it shouldn't inflate Mention Rate.
        same_text = "Grace Replica is a solid choice."
        run_a = self._completed_run(response_text=same_text)
        self._mention(run_a, sentiment=Mention.Sentiment.POSITIVE)
        run_b = self._completed_run(response_text=same_text)
        self._mention(run_b, sentiment=Mention.Sentiment.POSITIVE)
        distinct_run = self._completed_run(response_text="Something else entirely.")

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.total_runs, 3)
        self.assertEqual(result.duplicate_runs_excluded, 0)
        self.assertEqual([r.id for r in result.runs], [run_a.id, run_b.id, distinct_run.id])
        self.assertAlmostEqual(result.mention_rate, 2 / 3, places=2)

    def test_identical_responses_to_different_prompts_are_not_treated_as_duplicates(self):
        with use_agency(self.agency):
            other_prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="A completely different question"
            )
        same_text = "Grace Replica is a solid choice."
        self._completed_run(response_text=same_text)
        self._completed_run(response_text=same_text, prompt=other_prompt)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.total_runs, 2)
        self.assertEqual(result.duplicate_runs_excluded, 0)

    def test_no_duplicates_leaves_the_count_at_zero(self):
        self._completed_run(response_text="First answer.")
        self._completed_run(response_text="Second, different answer.")

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.duplicate_runs_excluded, 0)

    def test_a_zero_list_rank_does_not_crash_and_scores_as_unranked(self):
        # list_rank_at can only ever produce what it reads out of the
        # response, and nothing stops a real response from containing
        # a literal "0." marker -- 1/0 must not be allowed to blow up
        # the whole score over one malformed rank.
        run = self._completed_run()
        self._mention(run, list_rank=0, sentiment=Mention.Sentiment.NEUTRAL)

        with use_agency(self.agency):
            result = compute_visibility_score(self.brand)

        self.assertEqual(result.position_score, 0.5)


class VisibilityScoreEvidenceTests(TestCase):
    """core/visibility_score.py's visibility_score_evidence -- the same
    computation as VisibilityScoreTests, shaped into the JSON-ready
    evidence trail the API action returns. Focuses on the shape and
    traceability of that payload; the underlying math is already
    covered by VisibilityScoreTests."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Grace Replica")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best replica clothing store"
            )
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Grace Replica")

    def _completed_run(self, response_text=None):
        # Unique per call by default -- these represent independent
        # sample runs unless a test explicitly passes a shared
        # response_text to exercise duplicate-response handling.
        response_text = response_text if response_text is not None else f"irrelevant for this test ({uuid.uuid4()})"
        with use_agency(self.agency):
            return PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text=response_text,
            )

    def test_shape_when_there_is_no_data_yet(self):
        with use_agency(self.agency):
            data = visibility_score_evidence(self.brand)

        self.assertIsNone(data["visibility_score"])
        self.assertIsNone(data["components"])
        self.assertEqual(data["prompt_runs"], [])
        self.assertEqual(data["total_runs"], 0)
        self.assertEqual(data["entity_type"], "brand")
        self.assertEqual(data["entity_id"], str(self.brand.id))

    def test_evidence_includes_the_full_response_and_mention_detail(self):
        run = self._completed_run(response_text="Grace Replica is a great choice.")
        with use_agency(self.agency):
            mention = Mention.objects.create(
                agency=self.agency,
                prompt_run=run,
                client=self.client_obj,
                brand=self.brand,
                term="Grace Replica",
                is_primary=True,
                start_index=0,
                end_index=13,
                mention_order=1,
                list_rank=1,
                sentiment=Mention.Sentiment.POSITIVE,
                sentiment_source=Mention.SentimentSource.RULE,
            )
            citation = Citation.objects.create(
                agency=self.agency, prompt_run=run, url="https://gracereplica.store/", domain="gracereplica.store"
            )
            mention.citations.add(citation)

        with use_agency(self.agency):
            data = visibility_score_evidence(self.brand)

        self.assertEqual(data["visibility_score"], 1.0)
        self.assertEqual(len(data["prompt_runs"]), 1)
        run_data = data["prompt_runs"][0]
        self.assertEqual(run_data["id"], str(run.id))
        self.assertEqual(run_data["response_text"], "Grace Replica is a great choice.")
        self.assertTrue(run_data["mentioned"])
        self.assertEqual(len(run_data["mentions"]), 1)
        mention_data = run_data["mentions"][0]
        self.assertEqual(mention_data["term"], "Grace Replica")
        self.assertEqual(mention_data["position_score"], 1.0)
        self.assertEqual(mention_data["sentiment_score"], 1.0)
        self.assertEqual(len(mention_data["citations"]), 1)
        self.assertEqual(mention_data["citations"][0]["domain"], "gracereplica.store")

    def test_a_run_with_no_mention_still_appears_with_an_empty_mentions_list(self):
        # Full traceability means the runs that *didn't* mention the
        # brand are visible too -- they're exactly why Mention Rate
        # isn't 1.0.
        mentioned_run = self._completed_run()
        with use_agency(self.agency):
            Mention.objects.create(
                agency=self.agency,
                prompt_run=mentioned_run,
                client=self.client_obj,
                brand=self.brand,
                term="Grace Replica",
                is_primary=True,
                start_index=0,
                end_index=13,
                mention_order=1,
                sentiment=Mention.Sentiment.NEUTRAL,
                sentiment_source=Mention.SentimentSource.RULE,
            )
        silent_run = self._completed_run()

        with use_agency(self.agency):
            data = visibility_score_evidence(self.brand)

        self.assertEqual(len(data["prompt_runs"]), 2)
        by_id = {run["id"]: run for run in data["prompt_runs"]}
        self.assertTrue(by_id[str(mentioned_run.id)]["mentioned"])
        self.assertEqual(by_id[str(silent_run.id)]["mentioned"], False)
        self.assertEqual(by_id[str(silent_run.id)]["mentions"], [])


class VisibilityScoreApiTests(APITestCase):
    """The `visibility-score` action on BrandViewSet/CompetitorViewSet --
    HTTP-level coverage of core.visibility_score.visibility_score_evidence
    (already unit-tested directly in VisibilityScoreEvidenceTests), plus
    the ?since=/?until= period query params and error handling that only
    exist at this layer. Cross-agency isolation for this action is
    covered in ApiCrossAgencyIsolationTests."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Grace Replica")
            self.prompt = Prompt.objects.create(
                agency=self.agency, client=self.client_obj, text="Best replica clothing store"
            )
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Grace Replica")
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _completed_run(self, executed_at=None):
        with use_agency(self.agency):
            run = PromptRun.objects.create(
                agency=self.agency,
                prompt=self.prompt,
                prompt_text=self.prompt.text,
                provider=AIProvider.GEMINI,
                status=PromptRun.Status.COMPLETED,
                response_text="Grace Replica is a great choice.",
            )
            if executed_at is not None:
                PromptRun.objects.filter(pk=run.pk).update(executed_at=executed_at)
                run.refresh_from_db()
            return run

    def _mention(self, run, entity=None, **kwargs):
        entity = entity if entity is not None else self.brand
        is_brand = isinstance(entity, Brand)
        defaults = {
            "agency": self.agency,
            "prompt_run": run,
            "client": self.client_obj,
            "brand": entity if is_brand else None,
            "competitor": None if is_brand else entity,
            "term": entity.name,
            "is_primary": True,
            "start_index": 0,
            "end_index": len(entity.name),
            "mention_order": 1,
            "sentiment": Mention.Sentiment.POSITIVE,
            "sentiment_source": Mention.SentimentSource.RULE,
        }
        defaults.update(kwargs)
        with use_agency(self.agency):
            return Mention.objects.create(**defaults)

    def test_returns_no_data_shape_when_brand_has_no_completed_runs(self):
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-score/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["visibility_score"])
        self.assertIsNone(response.data["components"])
        self.assertEqual(response.data["prompt_runs"], [])
        self.assertEqual(response.data["total_runs"], 0)

    def test_returns_score_and_full_evidence_trail(self):
        run = self._completed_run()
        mention = self._mention(run, list_rank=1)
        with use_agency(self.agency):
            citation = Citation.objects.create(
                agency=self.agency, prompt_run=run, url="https://gracereplica.store/", domain="gracereplica.store"
            )
            mention.citations.add(citation)

        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-score/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["entity_type"], "brand")
        self.assertEqual(response.data["visibility_score"], 1.0)
        self.assertEqual(len(response.data["prompt_runs"]), 1)
        run_data = response.data["prompt_runs"][0]
        self.assertEqual(run_data["response_text"], "Grace Replica is a great choice.")
        self.assertEqual(len(run_data["mentions"]), 1)
        mention_data = run_data["mentions"][0]
        self.assertEqual(mention_data["term"], "Grace Replica")
        self.assertEqual(mention_data["position_score"], 1.0)
        self.assertEqual(len(mention_data["citations"]), 1)
        self.assertEqual(mention_data["citations"][0]["domain"], "gracereplica.store")

    def test_since_and_until_narrow_the_period(self):
        self._mention(self._completed_run(executed_at=datetime(2020, 1, 1, tzinfo=UTC)))
        recent_run = self._completed_run(executed_at=timezone.now())
        self._mention(recent_run)

        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-score/?since=2025-01-01")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["total_runs"], 1)
        self.assertEqual(response.data["prompt_runs"][0]["id"], str(recent_run.id))

    def test_invalid_period_param_returns_400(self):
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-score/?since=not-a-date")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_works_on_the_competitor_endpoint_too(self):
        with use_agency(self.agency):
            competitor = Competitor.objects.create(agency=self.agency, client=self.client_obj, name="Master Replica")
        self._mention(self._completed_run(), entity=competitor, list_rank=1)

        response = self.api.get(f"/api/v1/competitors/{competitor.id}/visibility-score/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["entity_type"], "competitor")
        # Mentioned once, ranked #1, positive sentiment (the _mention
        # helper's default), but not cited -- 0.40*1.0 + 0.25*1.0 +
        # 0.20*1.0 + 0.15*0.0 = 0.85.
        self.assertAlmostEqual(response.data["visibility_score"], 0.85)



    def test_score_response_never_includes_the_formula_weights(self):
        self._mention(self._completed_run())
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-score/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("weights", response.data)

    def test_visibility_history_returns_one_cumulative_point_per_day(self):
        self._mention(self._completed_run(executed_at=datetime(2026, 9, 1, 10, tzinfo=UTC)))
        self._completed_run(executed_at=datetime(2026, 9, 2, 10, tzinfo=UTC))
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([p["date"] for p in response.data], ["2026-09-01", "2026-09-02"])
        self.assertEqual([p["total_runs"] for p in response.data], [1, 2])
        self.assertEqual([p["mention_rate"] for p in response.data], [1.0, 0.5])
        self.assertNotIn("weights", response.data[0])

    def test_visibility_history_is_empty_without_runs(self):
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-history/")
        self.assertEqual(response.data, [])

    def test_visibility_history_rejects_a_bad_date(self):
        response = self.api.get(f"/api/v1/brands/{self.brand.id}/visibility-history/?since=nope")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

class ClientAgencySafeguardTests(TestCase):
    """Direct unit tests of ClientMustBelongToRequestersAgencyMixin, the
    explicit belt-and-suspenders check backing Brand/Competitor/Prompt's
    `client` field. AgencyAutoScopedManager already stops a cross-agency
    client id from resolving through the normal request/response cycle
    (see AssociationChainIntegrationTests below for that, exercised
    end-to-end through the real API) -- this instead calls the safeguard
    directly, so it's verified to hold in its own right rather than only
    ever being exercised in combination with the scoping it's backing up."""

    def setUp(self):
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.user_a = User.objects.create_user(
            email="admin-a@safeguard.test", password="pw123456789", agency=self.agency_a, role=User.Role.ADMIN
        )
        with use_agency(bypass=True):
            self.client_a = Client.objects.create(agency=self.agency_a, name="Agency A Client")
            self.client_b = Client.objects.create(agency=self.agency_b, name="Agency B Client")

    def _request_as(self, user):
        request = request_factory.post("/")
        request.user = user
        return request

    def test_brand_serializer_rejects_a_client_from_another_agency(self):
        serializer = BrandSerializer(context={"request": self._request_as(self.user_a)})
        with self.assertRaises(serializers.ValidationError):
            serializer.validate_client(self.client_b)

    def test_brand_serializer_accepts_a_client_from_the_same_agency(self):
        serializer = BrandSerializer(context={"request": self._request_as(self.user_a)})
        self.assertEqual(serializer.validate_client(self.client_a), self.client_a)

    def test_competitor_serializer_rejects_a_client_from_another_agency(self):
        serializer = CompetitorSerializer(context={"request": self._request_as(self.user_a)})
        with self.assertRaises(serializers.ValidationError):
            serializer.validate_client(self.client_b)

    def test_prompt_serializer_rejects_a_client_from_another_agency(self):
        serializer = PromptSerializer(context={"request": self._request_as(self.user_a)})
        with self.assertRaises(serializers.ValidationError):
            serializer.validate_client(self.client_b)


class AssociationChainIntegrationTests(APITestCase):
    """Walks the full agency -> client -> brand -> competitor -> prompt
    chain, built for two separate agencies entirely through the real API,
    and confirms every record traces back to exactly the agency that
    created it -- both directly in the database and through what each
    agency's own API calls return. A broader, end-to-end companion to the
    narrower per-endpoint isolation tests elsewhere in this file, plus
    coverage for a case those don't otherwise hit: re-pointing an
    *existing* brand/competitor at a different agency's client via update."""

    def setUp(self):
        cache.clear()
        self.password = "correct-horse-battery-staple"
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.admin_a = User.objects.create_user(
            email="admin-a@chain.test", password=self.password, agency=self.agency_a, role=User.Role.ADMIN
        )
        self.admin_b = User.objects.create_user(
            email="admin-b@chain.test", password=self.password, agency=self.agency_b, role=User.Role.ADMIN
        )
        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _build_chain_via_api(self, label):
        """Creates client -> brand -> competitor -> prompt through the live
        API, as whichever agency is currently logged in, and returns their ids."""
        client_id = self.api.post("/api/v1/clients/", {"name": f"{label} Client"}, format="json").data["id"]
        brand_id = self.api.post(
            "/api/v1/brands/", {"client": client_id, "name": f"{label} Brand"}, format="json"
        ).data["id"]
        competitor_id = self.api.post(
            "/api/v1/competitors/", {"client": client_id, "name": f"{label} Rival"}, format="json"
        ).data["id"]
        prompt_id = self.api.post(
            "/api/v1/prompts/", {"client": client_id, "text": f"Best {label} option nearby"}, format="json"
        ).data["id"]
        return client_id, brand_id, competitor_id, prompt_id

    def test_full_chain_traces_back_to_the_creating_agency_in_the_database(self):
        self._login_as("admin-a@chain.test")
        client_id, brand_id, competitor_id, prompt_id = self._build_chain_via_api("Agency A")

        with use_agency(bypass=True):
            client = Client.objects.get(id=client_id)
            brand = Brand.objects.get(id=brand_id)
            competitor = Competitor.objects.get(id=competitor_id)
            prompt = Prompt.objects.get(id=prompt_id)

        for record in (client, brand, competitor, prompt):
            self.assertEqual(record.agency_id, self.agency_a.id)

        # Every child record points at *this* client specifically, not just
        # *some* client that happens to belong to the right agency.
        self.assertEqual(brand.client_id, client.id)
        self.assertEqual(competitor.client_id, client.id)
        self.assertEqual(prompt.client_id, client.id)

    def test_two_agencies_full_chains_never_cross_through_the_api(self):
        self._login_as("admin-a@chain.test")
        self._build_chain_via_api("Agency A")

        self._login_as("admin-b@chain.test")
        chain_b = self._build_chain_via_api("Agency B")

        # Agency B, reading back through its own API calls, sees exactly its
        # own chain and nothing belonging to agency A.
        self.assertEqual([c["id"] for c in self.api.get("/api/v1/clients/").data], [chain_b[0]])
        self.assertEqual([b["id"] for b in self.api.get("/api/v1/brands/").data], [chain_b[1]])
        self.assertEqual([c["id"] for c in self.api.get("/api/v1/competitors/").data], [chain_b[2]])
        self.assertEqual([p["id"] for p in self.api.get("/api/v1/prompts/").data], [chain_b[3]])

    def test_cannot_repoint_an_existing_brand_to_another_agencys_client_via_update(self):
        self._login_as("admin-a@chain.test")
        _, brand_id, _, _ = self._build_chain_via_api("Agency A")

        self._login_as("admin-b@chain.test")
        # A bare client with no brand of its own yet, so this specifically
        # exercises the cross-agency check rather than the separate
        # one-brand-per-client uniqueness rule.
        other_client_id = self.api.post("/api/v1/clients/", {"name": "Agency B Bare Client"}, format="json").data[
            "id"
        ]

        self._login_as("admin-a@chain.test")
        response = self.api.patch(f"/api/v1/brands/{brand_id}/", {"client": other_client_id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

        with use_agency(bypass=True):
            brand = Brand.objects.get(id=brand_id)
        self.assertNotEqual(brand.client_id, other_client_id)

    def test_cannot_repoint_an_existing_competitor_to_another_agencys_client_via_update(self):
        self._login_as("admin-a@chain.test")
        _, _, competitor_id, _ = self._build_chain_via_api("Agency A")

        self._login_as("admin-b@chain.test")
        chain_b = self._build_chain_via_api("Agency B")
        other_client_id = chain_b[0]

        self._login_as("admin-a@chain.test")
        response = self.api.patch(f"/api/v1/competitors/{competitor_id}/", {"client": other_client_id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

        with use_agency(bypass=True):
            competitor = Competitor.objects.get(id=competitor_id)
        self.assertNotEqual(competitor.client_id, other_client_id)

    def test_cannot_repoint_an_existing_prompt_to_another_agencys_client_via_update(self):
        self._login_as("admin-a@chain.test")
        _, _, _, prompt_id = self._build_chain_via_api("Agency A")

        self._login_as("admin-b@chain.test")
        chain_b = self._build_chain_via_api("Agency B")
        other_client_id = chain_b[0]

        self._login_as("admin-a@chain.test")
        response = self.api.patch(f"/api/v1/prompts/{prompt_id}/", {"client": other_client_id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

        with use_agency(bypass=True):
            prompt = Prompt.objects.get(id=prompt_id)
        self.assertNotEqual(prompt.client_id, other_client_id)


class TeamMemberManagementTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@a.test", password=self.password, agency=self.agency_a, role=User.Role.ADMIN
        )
        self.member = User.objects.create_user(
            email="member@a.test", password=self.password, agency=self.agency_a, role=User.Role.MEMBER
        )
        self.other_agency_admin = User.objects.create_user(
            email="admin@b.test", password=self.password, agency=self.agency_b, role=User.Role.ADMIN
        )
        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_member_can_list_teammates_scoped_to_own_agency(self):
        self._login_as("member@a.test")
        response = self.api.get("/api/v1/team-members/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        emails = {row["email"] for row in response.data}
        self.assertEqual(emails, {"admin@a.test", "member@a.test"})
        self.assertNotIn("admin@b.test", emails)

    def test_cannot_retrieve_teammate_from_another_agency(self):
        self._login_as("admin@a.test")
        response = self.api.get(f"/api/v1/team-members/{self.other_agency_admin.pk}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_change_a_teammates_role(self):
        self._login_as("admin@a.test")
        response = self.api.patch(f"/api/v1/team-members/{self.member.pk}/", {"role": User.Role.ADMIN}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertEqual(self.member.role, User.Role.ADMIN)

    def test_admin_can_deactivate_a_teammate(self):
        self._login_as("admin@a.test")
        response = self.api.patch(f"/api/v1/team-members/{self.member.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)

    def test_plain_member_cannot_change_a_teammates_role(self):
        self._login_as("member@a.test")
        response = self.api.patch(f"/api/v1/team-members/{self.admin.pk}/", {"role": User.Role.MEMBER}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_modify_own_membership_via_this_endpoint(self):
        self._login_as("admin@a.test")
        response = self.api.patch(f"/api/v1/team-members/{self.admin.pk}/", {"role": User.Role.MEMBER}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_remove_yourself_via_this_endpoint(self):
        self._login_as("admin@a.test")
        response = self.api.delete(f"/api/v1/team-members/{self.admin.pk}/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())

    def test_admin_can_remove_a_fellow_admin_leaving_exactly_one(self):
        # Only an admin can reach this endpoint, and self-removal is
        # blocked, so the acting admin always survives their own request --
        # an agency can shrink to one admin here, never to zero, with no
        # separate "last admin" check needed.
        self._login_as("admin@a.test")
        self.api.patch(f"/api/v1/team-members/{self.member.pk}/", {"role": User.Role.ADMIN}, format="json")
        self._login_as("member@a.test")

        response = self.api.delete(f"/api/v1/team-members/{self.admin.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        remaining_admins = User.objects.filter(agency=self.agency_a, role=User.Role.ADMIN)
        self.assertEqual(list(remaining_admins), [self.member])

    def test_plain_member_cannot_remove_a_teammate(self):
        self._login_as("member@a.test")
        response = self.api.delete(f"/api/v1/team-members/{self.admin.pk}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class TeamInviteFlowTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.member = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_admin_can_invite_a_teammate(self):
        # Fresh agency (admin only, no member yet) so the invite lands
        # under the 2-account cap.
        agency = Agency.objects.create(name="Fresh Co")
        User.objects.create_user(email="admin@fresh.test", password=self.password, agency=agency, role=User.Role.ADMIN)
        self._login_as("admin@fresh.test")
        response = self.api.post(
            "/api/v1/team-members/invite/", {"email": "newbie@fresh.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        invited = User.objects.get(email="newbie@fresh.test")
        self.assertEqual(invited.agency_id, agency.id)
        self.assertFalse(invited.is_active)
        self.assertFalse(invited.has_usable_password())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("newbie@fresh.test", mail.outbox[0].to)

    def test_plain_member_cannot_invite(self):
        self._login_as("member@acme.test")
        response = self.api.post(
            "/api/v1/team-members/invite/", {"email": "newbie@acme.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(User.objects.filter(email="newbie@acme.test").exists())

    def test_invite_is_rejected_once_agency_is_at_the_two_member_cap(self):
        # setUp already created an admin + a member -- agency is at the cap.
        self._login_as("admin@acme.test")
        response = self.api.post(
            "/api/v1/team-members/invite/", {"email": "one-too-many@acme.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="one-too-many@acme.test").exists())

    def test_pending_unaccepted_invite_still_counts_toward_the_cap(self):
        agency = Agency.objects.create(name="Fresh Co 2")
        User.objects.create_user(email="admin@fresh2.test", password=self.password, agency=agency, role=User.Role.ADMIN)
        self._login_as("admin@fresh2.test")
        first = self.api.post(
            "/api/v1/team-members/invite/", {"email": "invitee1@fresh2.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.api.post(
            "/api/v1/team-members/invite/", {"email": "invitee2@fresh2.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_invite_an_email_that_already_has_an_account(self):
        self._login_as("admin@acme.test")
        response = self.api.post(
            "/api/v1/team-members/invite/", {"email": "member@acme.test", "role": User.Role.MEMBER}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def _invite_and_get_token(self):
        agency = Agency.objects.create(name="Invite Accept Co")
        User.objects.create_user(email="admin@acceptco.test", password=self.password, agency=agency, role=User.Role.ADMIN)
        self._login_as("admin@acceptco.test")
        self.api.post(
            "/api/v1/team-members/invite/", {"email": "newbie@acceptco.test", "role": User.Role.MEMBER}, format="json"
        )
        invited = User.objects.get(email="newbie@acceptco.test")
        uid = urlsafe_base64_encode(force_bytes(invited.pk))
        token = default_token_generator.make_token(invited)
        self.api.credentials()  # log out the admin before the invitee accepts
        return invited, uid, token

    def test_accept_invite_with_valid_token_activates_and_logs_in(self):
        invited, uid, token = self._invite_and_get_token()
        response = self.api.post(
            "/api/v1/team-members/accept-invite/",
            {"uid": uid, "token": token, "password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

        invited.refresh_from_db()
        self.assertTrue(invited.is_active)
        self.assertTrue(invited.check_password("a-brand-new-passphrase"))

    def test_accepted_invitee_can_then_log_in_normally(self):
        self._invite_and_get_token()
        invited = User.objects.get(email="newbie@acceptco.test")
        uid = urlsafe_base64_encode(force_bytes(invited.pk))
        token = default_token_generator.make_token(invited)
        self.api.post(
            "/api/v1/team-members/accept-invite/",
            {"uid": uid, "token": token, "password": "a-brand-new-passphrase"},
            format="json",
        )

        response = self.client.post(
            "/api/v1/auth/token/",
            {"email": "newbie@acceptco.test", "password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_accept_invite_rejects_invalid_token(self):
        invited, uid, _ = self._invite_and_get_token()
        response = self.api.post(
            "/api/v1/team-members/accept-invite/",
            {"uid": uid, "token": "not-a-real-token", "password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        invited.refresh_from_db()
        self.assertFalse(invited.is_active)


class ChangePasswordTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.old_password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(email="member@acme.test", password=self.old_password, agency=self.agency)
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.old_password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_requires_authentication(self):
        anon = APIClient()
        response = anon.post(
            "/api/v1/auth/change-password/",
            {"old_password": self.old_password, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_correct_old_password_updates_and_new_password_works(self):
        response = self.api.post(
            "/api/v1/auth/change-password/",
            {"old_password": self.old_password, "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        login_response = self.client.post(
            "/api/v1/auth/token/",
            {"email": "member@acme.test", "password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

    def test_wrong_old_password_is_rejected(self):
        response = self.api.post(
            "/api/v1/auth/change-password/",
            {"old_password": "not-my-password", "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.old_password))

    def test_weak_new_password_is_rejected(self):
        response = self.api.post(
            "/api/v1/auth/change-password/",
            {"old_password": self.old_password, "new_password": "12345678"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data)


class TeamAndAccountRateLimitTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.owner = User.objects.create_user(
            email="owner@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "owner@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_team_invite_is_throttled_after_ten_attempts_per_minute(self):
        # MAX_TEAM_MEMBERS caps this agency at one invite (201), so most of
        # these return 400 (cap reached) rather than 201 -- irrelevant here,
        # since throttling is checked before the view body runs either way.
        # What matters is that none of the first 10 come back 429, and the
        # 11th does.
        for i in range(10):
            response = self.api.post(
                "/api/v1/team-members/invite/", {"email": f"invitee{i}@acme.test"}, format="json"
            )
            self.assertNotEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        eleventh = self.api.post("/api/v1/team-members/invite/", {"email": "one-too-many@acme.test"}, format="json")
        self.assertEqual(eleventh.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_change_password_is_throttled_after_five_attempts_per_minute(self):
        for _ in range(5):
            response = self.api.post(
                "/api/v1/auth/change-password/",
                {"old_password": "wrong", "new_password": "a-brand-new-passphrase"},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        sixth = self.api.post(
            "/api/v1/auth/change-password/",
            {"old_password": "wrong", "new_password": "a-brand-new-passphrase"},
            format="json",
        )
        self.assertEqual(sixth.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class CorsAllowListTests(APITestCase):
    def test_allows_configured_frontend_origin(self):
        response = self.client.get("/api/v1/auth/me/", HTTP_ORIGIN="http://localhost:3000")
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000")

    def test_rejects_unlisted_origin(self):
        response = self.client.get("/api/v1/auth/me/", HTTP_ORIGIN="http://evil.example.com")
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)


class ApiCrossAgencyIsolationTests(APITestCase):
    """Exercises the real HTTP request path end-to-end: login -> JWT ->
    AgencyContextMiddleware sets the ambient agency context ->
    AgencyAutoScopedManager filters automatically -> PostgreSQL RLS
    enforces independently underneath. No test-only shortcuts -- this is
    the same path a real API client hits."""

    def setUp(self):
        cache.clear()  # see AuthFlowTests.setUp -- avoids spurious 429s from the login throttle
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.password = "pw123456789"
        self.owner_a = User.objects.create_user(
            email="owner-a@iso.test", password=self.password, agency=self.agency_a, role=User.Role.ADMIN
        )
        self.owner_b = User.objects.create_user(
            email="owner-b@iso.test", password=self.password, agency=self.agency_b, role=User.Role.ADMIN
        )

        self.member_a = User.objects.create_user(
            email="member-a@iso.test", password=self.password, agency=self.agency_a, role=User.Role.MEMBER
        )

        with use_agency(bypass=True):
            self.client_a = Client.objects.create(agency=self.agency_a, name="Agency A Client", industry="Retail")
            self.client_b = Client.objects.create(agency=self.agency_b, name="Agency B Client", industry="Legal")
            self.brand_a = Brand.objects.create(agency=self.agency_a, client=self.client_a, name="Agency A Brand")
            self.brand_b = Brand.objects.create(agency=self.agency_b, client=self.client_b, name="Agency B Brand")
            self.competitor_a = Competitor.objects.create(agency=self.agency_a, client=self.client_a, name="Agency A Rival")
            self.competitor_b = Competitor.objects.create(agency=self.agency_b, client=self.client_b, name="Agency B Rival")
            self.prompt_a = Prompt.objects.create(agency=self.agency_a, client=self.client_a, text="Agency A prompt")
            self.prompt_b = Prompt.objects.create(agency=self.agency_b, client=self.client_b, text="Agency B prompt")
            self.prompt_run_a = PromptRun.objects.create(
                agency=self.agency_a, prompt=self.prompt_a, prompt_text=self.prompt_a.text, status=PromptRun.Status.QUEUED
            )
            self.prompt_run_b = PromptRun.objects.create(
                agency=self.agency_b, prompt=self.prompt_b, prompt_text=self.prompt_b.text, status=PromptRun.Status.QUEUED
            )
            self.mention_a = Mention.objects.create(
                agency=self.agency_a, prompt_run=self.prompt_run_a, client=self.client_a, brand=self.brand_a,
                term="Agency A Brand", is_primary=True, start_index=0, end_index=15, mention_order=1,
            )
            self.mention_b = Mention.objects.create(
                agency=self.agency_b, prompt_run=self.prompt_run_b, client=self.client_b, brand=self.brand_b,
                term="Agency B Brand", is_primary=True, start_index=0, end_index=15, mention_order=1,
            )
            self.citation_a = Citation.objects.create(
                agency=self.agency_a, prompt_run=self.prompt_run_a,
                url="https://a.example.com/", domain="a.example.com",
            )
            self.citation_b = Citation.objects.create(
                agency=self.agency_b, prompt_run=self.prompt_run_b,
                url="https://b.example.com/", domain="b.example.com",
            )

        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_list_only_shows_own_agencys_clients(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/clients/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([c["name"] for c in response.data], ["Agency A Client"])

    def test_cannot_retrieve_other_agencys_client_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/clients/{self.client_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_agencys_client(self):
        self._login_as("owner-a@iso.test")
        response = self.api.patch(f"/api/v1/clients/{self.client_b.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.client_b.refresh_from_db()
        self.assertEqual(self.client_b.name, "Agency B Client")

    def test_cannot_delete_other_agencys_client(self):
        self._login_as("owner-a@iso.test")
        response = self.api.delete(f"/api/v1/clients/{self.client_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.assertTrue(Client.objects.filter(id=self.client_b.id).exists())

    def test_created_client_is_force_assigned_to_requesters_agency(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post("/api/v1/clients/", {"name": "New Client", "industry": "Finance"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        with use_agency(bypass=True):
            created = Client.objects.get(id=response.data["id"])
        self.assertEqual(created.agency_id, self.agency_a.id)

    def test_create_payload_cannot_override_agency(self):
        # `agency` isn't even a field on ClientSerializer, so this should
        # be silently ignored -- confirming that explicitly, not just
        # relying on "no payload includes it" like the test above.
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            "/api/v1/clients/",
            {"name": "Sneaky Client", "industry": "Finance", "agency": str(self.agency_b.id)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        with use_agency(bypass=True):
            created = Client.objects.get(id=response.data["id"])
        self.assertEqual(created.agency_id, self.agency_a.id)

    def test_cannot_create_brand_pointing_at_other_agencys_client(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            "/api/v1/brands/", {"client": str(self.client_b.id), "name": "Sneaky Brand"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    # --- Brand: same read/write isolation coverage as Client above ---

    def test_list_only_shows_own_agencys_brands(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/brands/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([b["name"] for b in response.data], ["Agency A Brand"])

    def test_cannot_retrieve_other_agencys_brand_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/brands/{self.brand_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_agencys_brand(self):
        self._login_as("owner-a@iso.test")
        response = self.api.patch(f"/api/v1/brands/{self.brand_b.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.brand_b.refresh_from_db()
        self.assertEqual(self.brand_b.name, "Agency B Brand")

    def test_cannot_delete_other_agencys_brand(self):
        self._login_as("owner-a@iso.test")
        response = self.api.delete(f"/api/v1/brands/{self.brand_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.assertTrue(Brand.objects.filter(id=self.brand_b.id).exists())

    def test_cannot_test_match_on_other_agencys_brand(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            f"/api/v1/brands/{self.brand_b.id}/test-match/", {"text": "Agency A Brand mentioned here."}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_get_visibility_score_for_other_agencys_brand(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/brands/{self.brand_b.id}/visibility-score/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # --- Competitor: same read/write isolation coverage ---

    def test_list_only_shows_own_agencys_competitors(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/competitors/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([c["name"] for c in response.data], ["Agency A Rival"])

    def test_cannot_retrieve_other_agencys_competitor_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/competitors/{self.competitor_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_agencys_competitor(self):
        self._login_as("owner-a@iso.test")
        response = self.api.patch(f"/api/v1/competitors/{self.competitor_b.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.competitor_b.refresh_from_db()
        self.assertEqual(self.competitor_b.name, "Agency B Rival")

    def test_cannot_delete_other_agencys_competitor(self):
        self._login_as("owner-a@iso.test")
        response = self.api.delete(f"/api/v1/competitors/{self.competitor_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.assertTrue(Competitor.objects.filter(id=self.competitor_b.id).exists())

    def test_cannot_test_match_on_other_agencys_competitor(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            f"/api/v1/competitors/{self.competitor_b.id}/test-match/",
            {"text": "Agency B Rival mentioned here."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_get_visibility_score_for_other_agencys_competitor(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/competitors/{self.competitor_b.id}/visibility-score/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_create_competitor_pointing_at_other_agencys_client(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            "/api/v1/competitors/", {"client": str(self.client_b.id), "name": "Sneaky Rival"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    # --- Prompt: same read/write isolation coverage ---

    def test_list_only_shows_own_agencys_prompts(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/prompts/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([p["text"] for p in response.data], ["Agency A prompt"])

    def test_cannot_retrieve_other_agencys_prompt_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/prompts/{self.prompt_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_agencys_prompt(self):
        self._login_as("owner-a@iso.test")
        response = self.api.patch(f"/api/v1/prompts/{self.prompt_b.id}/", {"text": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.prompt_b.refresh_from_db()
        self.assertEqual(self.prompt_b.text, "Agency B prompt")

    def test_cannot_delete_other_agencys_prompt(self):
        self._login_as("owner-a@iso.test")
        response = self.api.delete(f"/api/v1/prompts/{self.prompt_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.assertTrue(Prompt.objects.filter(id=self.prompt_b.id).exists())

    def test_cannot_create_prompt_pointing_at_other_agencys_client(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(
            "/api/v1/prompts/", {"client": str(self.client_b.id), "text": "Sneaky prompt"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client", response.data)

    # --- PromptRun: can't trigger a run on, or read the history of, a
    # prompt that belongs to another agency ---

    def test_cannot_trigger_run_on_other_agencys_prompt(self):
        self._login_as("owner-a@iso.test")
        response = self.api.post(f"/api/v1/prompts/{self.prompt_b.id}/run/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with use_agency(bypass=True):
            self.assertEqual(PromptRun.objects.filter(prompt=self.prompt_b).count(), 1)  # only the seeded one

    def test_list_only_shows_own_agencys_prompt_runs(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/prompt-runs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([r["id"] for r in response.data], [str(self.prompt_run_a.id)])

    def test_cannot_retrieve_other_agencys_prompt_run_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/prompt-runs/{self.prompt_run_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_filter_in_other_agencys_runs_via_prompt_query_param(self):
        # ?prompt=<other agency's prompt id> must not leak that prompt's
        # runs -- the queryset is scoped to the caller's own agency
        # first, and the query-param filter is applied on top of that.
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/prompt-runs/?prompt={self.prompt_b.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_list_only_shows_own_agencys_mentions(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/mentions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([m["id"] for m in response.data], [str(self.mention_a.id)])

    def test_cannot_retrieve_other_agencys_mention_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/mentions/{self.mention_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_filter_in_other_agencys_mentions_via_query_params(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/mentions/?prompt_run={self.prompt_run_b.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_list_only_shows_own_agencys_citations(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get("/api/v1/citations/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([c["id"] for c in response.data], [str(self.citation_a.id)])

    def test_cannot_retrieve_other_agencys_citation_by_id(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/citations/{self.citation_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_filter_in_other_agencys_citations_via_query_params(self):
        self._login_as("owner-a@iso.test")
        response = self.api.get(f"/api/v1/citations/?prompt_run={self.prompt_run_b.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    # --- Isolation holds regardless of role: a plain Member is blocked
    # exactly like an Admin -- IsAgencyMember doesn't check role at all,
    # so this is what proves that's true rather than assuming it. ---

    def test_member_role_is_blocked_from_other_agencys_data_same_as_admin(self):
        self._login_as("member-a@iso.test")

        list_response = self.api.get("/api/v1/clients/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([c["name"] for c in list_response.data], ["Agency A Client"])

        retrieve_response = self.api.get(f"/api/v1/clients/{self.client_b.id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_404_NOT_FOUND)

        update_response = self.api.patch(f"/api/v1/clients/{self.client_b.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(update_response.status_code, status.HTTP_404_NOT_FOUND)

        delete_response = self.api.delete(f"/api/v1/clients/{self.client_b.id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_404_NOT_FOUND)

        with use_agency(bypass=True):
            self.client_b.refresh_from_db()
        self.assertEqual(self.client_b.name, "Agency B Client")


class PostgresRowLevelSecurityTests(TestCase):
    """Bypasses the Django ORM/manager entirely and talks to PostgreSQL
    directly via raw SQL, to prove the row-level-security policies
    themselves do real work -- independent of, and a backstop for,
    everything the Python-level AgencyAutoScopedManager does above."""

    def setUp(self):
        self.agency_a = Agency.objects.create(name="RLS Agency A")
        self.agency_b = Agency.objects.create(name="RLS Agency B")
        with use_agency(bypass=True):
            self.client_a = Client.objects.create(agency=self.agency_a, name="RLS Client A")
            self.client_b = Client.objects.create(agency=self.agency_b, name="RLS Client B")

    def tearDown(self):
        # Same reasoning as use_agency.__exit__: a test that deliberately
        # triggers a DB error (test_insert_across_agency_is_rejected)
        # leaves the transaction broken until rollback -- don't try to
        # run more SQL on top of that.
        if connection.in_atomic_block and connection.needs_rollback:
            return
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', '', false)")

    def test_no_session_context_sees_nothing(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', '', false)")
            cursor.execute("SELECT count(*) FROM core_client")
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_session_scoped_to_agency_a_sees_only_agency_a(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', %s, false)", [str(self.agency_a.id)])
            cursor.execute("SELECT name FROM core_client")
            names = {row[0] for row in cursor.fetchall()}
        self.assertEqual(names, {"RLS Client A"})

    def test_insert_across_agency_is_rejected(self):
        new_id = uuid.uuid4()
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', %s, false)", [str(self.agency_a.id)])

        # transaction.atomic() -> savepoint, so the expected rejection
        # rolls back only this insert, not the whole test transaction.
        with self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO core_client (id, agency_id, name, industry, created_at) "
                "VALUES (%s, %s, 'Sneaky', '', now())",
                [str(new_id), str(self.agency_b.id)],
            )

    def test_update_across_agency_affects_zero_rows(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', %s, false)", [str(self.agency_a.id)])
            cursor.execute("UPDATE core_client SET name = 'Hijacked' WHERE id = %s", [str(self.client_b.id)])
            self.assertEqual(cursor.rowcount, 0)

        with use_agency(bypass=True):
            self.client_b.refresh_from_db()
        self.assertEqual(self.client_b.name, "RLS Client B")

    def test_delete_across_agency_affects_zero_rows(self):
        # The API-level delete test (ApiCrossAgencyIsolationTests) only
        # proves the ORM-level filter -- the object is 404 before a
        # DELETE statement is ever issued. This proves RLS's own FOR ALL
        # policy independently covers DELETE too, not just SELECT/INSERT/
        # UPDATE (which each already have a dedicated test above).
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.bypass_rls', 'off', false)")
            cursor.execute("SELECT set_config('app.current_agency_id', %s, false)", [str(self.agency_a.id)])
            cursor.execute("DELETE FROM core_client WHERE id = %s", [str(self.client_b.id)])
            self.assertEqual(cursor.rowcount, 0)

        with use_agency(bypass=True):
            self.assertTrue(Client.objects.filter(id=self.client_b.id).exists())

    def test_nested_use_agency_restores_the_outer_scope_on_exit(self):
        # Regression: __exit__ used to unconditionally blank the Postgres
        # session vars instead of restoring whatever was there before
        # __enter__. That's harmless for the top-level case (nothing to
        # restore to), but a *nested* use_agency -- e.g. PromptViewSet.run
        # calling execute_prompt_run(...) directly, in-process, from
        # inside a request already scoped to an agency -- would wipe the
        # outer request's RLS scoping out from under it on exit, even
        # though the outer Python contextvar was still correctly set.
        # Every query for the rest of the request would then see zero
        # rows (RLS fails closed), exactly what broke here.
        with use_agency(self.agency_a):
            with use_agency(bypass=True):
                pass  # simulates execute_prompt_run's own inner scope
            # Back inside the outer block: RLS must still be scoped to
            # agency_a, not blanked by the inner block's exit.
            with connection.cursor() as cursor:
                cursor.execute("SELECT name FROM core_client")
                names = {row[0] for row in cursor.fetchall()}
        self.assertEqual(names, {"RLS Client A"})


class ScheduleCalculatorTests(TestCase):
    """calculate_schedule_dates (AVTR_SPEC section 7) -- pure date math, no DB."""

    def test_once_returns_exactly_start_date(self):
        result = calculate_schedule_dates(
            frequency="once", start_date=date(2026, 8, 13), end_date=date(2026, 9, 12)
        )
        self.assertEqual(result.execution_dates, [date(2026, 8, 13)])
        self.assertEqual(result.execution_count, 1)
        self.assertEqual(result.first_execution, date(2026, 8, 13))
        self.assertEqual(result.last_execution, date(2026, 8, 13))

    def test_daily_across_a_short_range(self):
        result = calculate_schedule_dates(
            frequency="daily", start_date=date(2026, 8, 1), end_date=date(2026, 8, 5)
        )
        self.assertEqual(
            result.execution_dates,
            [date(2026, 8, 1), date(2026, 8, 2), date(2026, 8, 3), date(2026, 8, 4), date(2026, 8, 5)],
        )
        self.assertEqual(result.execution_count, 5)

    def test_weekly_steps_by_seven_days(self):
        result = calculate_schedule_dates(
            frequency="weekly", start_date=date(2026, 8, 1), end_date=date(2026, 8, 29)
        )
        self.assertEqual(
            result.execution_dates,
            [date(2026, 8, 1), date(2026, 8, 8), date(2026, 8, 15), date(2026, 8, 22), date(2026, 8, 29)],
        )

    def test_monthly_steps_by_calendar_month(self):
        result = calculate_schedule_dates(
            frequency="monthly", start_date=date(2026, 1, 15), end_date=date(2026, 5, 1)
        )
        self.assertEqual(
            result.execution_dates,
            [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)],
        )

    def test_monthly_clamps_at_short_months_instead_of_rolling_over(self):
        # Jan 31 + 1 month must land on Feb 28 (2026 isn't a leap year),
        # not spill into March -- naive date arithmetic gets this wrong.
        result = calculate_schedule_dates(
            frequency="monthly", start_date=date(2026, 1, 31), end_date=date(2026, 4, 30)
        )
        self.assertEqual(
            result.execution_dates,
            [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)],
        )

    def test_custom_every_n_days(self):
        result = calculate_schedule_dates(
            frequency="custom",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 10),
            custom_interval_days=3,
        )
        self.assertEqual(
            result.execution_dates, [date(2026, 8, 1), date(2026, 8, 4), date(2026, 8, 7), date(2026, 8, 10)]
        )

    def test_end_before_start_returns_empty(self):
        result = calculate_schedule_dates(
            frequency="daily", start_date=date(2026, 8, 10), end_date=date(2026, 8, 1)
        )
        self.assertEqual(result.execution_dates, [])
        self.assertEqual(result.execution_count, 0)
        self.assertIsNone(result.first_execution)
        self.assertIsNone(result.last_execution)

    def test_invalid_timezone_raises(self):
        from zoneinfo import ZoneInfoNotFoundError

        with self.assertRaises(ZoneInfoNotFoundError):
            calculate_schedule_dates(
                frequency="daily",
                start_date=date(2026, 8, 1),
                end_date=date(2026, 8, 2),
                timezone="Not/A_Real_Zone",
            )

    def test_unknown_frequency_raises(self):
        with self.assertRaises(ValueError):
            calculate_schedule_dates(frequency="yearly", start_date=date(2026, 8, 1), end_date=date(2026, 8, 2))


class UsageEstimatorTests(TestCase):
    """estimate_usage (AVTR_SPEC section 8/9/11) -- the exact worked
    examples from the spec, checked directly against the formulas."""

    def test_safe_status_at_60_percent(self):
        # 120 / 200 = 60% -> SAFE
        period = _fake_billing_period(base=200, used=120)
        result = estimate_usage(
            billing_period=period, prompt_count=0, provider_count=0, frequency="once",
            start_date=date(2026, 8, 13), end_date=date(2026, 8, 13),
        )
        self.assertEqual(result.usage_percentage, 60.0)
        self.assertEqual(result.status, "SAFE")

    def test_warning_status_at_92_5_percent(self):
        # 185 / 200 = 92.5% -> WARNING
        period = _fake_billing_period(base=200, used=185)
        result = estimate_usage(
            billing_period=period, prompt_count=0, provider_count=0, frequency="once",
            start_date=date(2026, 8, 13), end_date=date(2026, 8, 13),
        )
        self.assertEqual(result.usage_percentage, 92.5)
        self.assertEqual(result.status, "WARNING")

    def test_exceeds_limit_status_at_140_percent(self):
        # 280 / 200 = 140% -> EXCEEDS_LIMIT, 80 runs over
        period = _fake_billing_period(base=200, used=0)
        result = estimate_usage(
            billing_period=period, prompt_count=280, provider_count=1, frequency="once",
            start_date=date(2026, 8, 13), end_date=date(2026, 8, 13),
        )
        self.assertEqual(result.estimated_prompt_runs, 280)
        self.assertEqual(result.usage_percentage, 140.0)
        self.assertEqual(result.status, "EXCEEDS_LIMIT")
        self.assertEqual(result.excess_runs, 80)

    def test_status_boundary_exactly_80_percent_is_safe(self):
        self.assertEqual(usage_status(160, 200), "SAFE")  # 80.0% -- boundary is inclusive

    def test_status_boundary_just_over_80_percent_is_warning(self):
        self.assertEqual(usage_status(161, 200), "WARNING")

    def test_status_boundary_exactly_100_percent_is_warning_not_exceeds(self):
        self.assertEqual(usage_status(200, 200), "WARNING")

    def test_status_boundary_just_over_100_percent_exceeds(self):
        self.assertEqual(usage_status(201, 200), "EXCEEDS_LIMIT")

    def test_provider_multiplier_full_worked_example(self):
        # 20 prompts x 2 providers x 5 executions = 200 PromptRuns
        period = _fake_billing_period(base=1000, used=0)
        result = estimate_usage(
            billing_period=period,
            prompt_count=20,
            provider_count=2,
            frequency="daily",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 5),
        )
        self.assertEqual(result.scheduled_execution_count, 5)
        self.assertEqual(result.runs_per_execution, 40)
        self.assertEqual(result.estimated_prompt_runs, 200)

    def test_exact_spec_example_from_section_23(self):
        # The literal worked example from AVTR_SPEC section 23's sample response.
        period = _fake_billing_period(base=200, rollover=0, used=120, period_end=date(2026, 9, 12))
        result = estimate_usage(
            billing_period=period,
            prompt_count=20,
            provider_count=2,
            frequency="daily",
            start_date=date(2026, 8, 12),
            end_date=date(2026, 8, 16),  # 5 daily executions
        )
        self.assertEqual(result.prompt_count, 20)
        self.assertEqual(result.provider_count, 2)
        self.assertEqual(result.scheduled_execution_count, 5)
        self.assertEqual(result.estimated_prompt_runs, 200)
        self.assertEqual(result.current_usage, 120)
        self.assertEqual(result.base_allowance, 200)
        self.assertEqual(result.rollover_received, 0)
        self.assertEqual(result.total_available, 200)
        self.assertEqual(result.remaining_runs, 80)
        self.assertEqual(result.projected_usage, 320)
        self.assertEqual(result.excess_runs, 120)
        self.assertEqual(result.usage_percentage, 160.0)
        self.assertEqual(result.status, "EXCEEDS_LIMIT")
        self.assertEqual(result.runs_per_execution, 40)
        self.assertEqual(result.supported_executions, 2)
        self.assertEqual(result.forecast_exhaustion_date, date(2026, 8, 13))  # 2nd execution date
        self.assertEqual(result.billing_period_end, date(2026, 9, 12))

    def test_daily_forecast_message_in_full_days(self):
        # 80 remaining, 20 Prompt Runs/day (daily) -> 4 full days.
        period = _fake_billing_period(base=80, used=0)
        result = estimate_usage(
            billing_period=period,
            prompt_count=20,
            provider_count=1,
            frequency="daily",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 31),  # far more than 4 due dates
        )
        self.assertEqual(result.supported_executions, 4)
        self.assertEqual(result.forecast_message, "Your included usage can support this schedule for 4 full days.")

    def test_weekly_forecast_message_in_executions(self):
        # 120 remaining, 40 Prompt Runs/execution (weekly) -> 3 executions.
        period = _fake_billing_period(base=120, used=0)
        result = estimate_usage(
            billing_period=period,
            prompt_count=40,
            provider_count=1,
            frequency="weekly",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 12, 1),
        )
        self.assertEqual(result.supported_executions, 3)
        self.assertEqual(result.forecast_message, "Your included usage supports 3 scheduled executions.")

    def test_no_forecast_message_when_plan_fully_covers_schedule(self):
        period = _fake_billing_period(base=1000, used=0)
        result = estimate_usage(
            billing_period=period, prompt_count=1, provider_count=1, frequency="once",
            start_date=date(2026, 8, 13), end_date=date(2026, 8, 13),
        )
        self.assertIsNone(result.forecast_message)

    def test_forecast_exhaustion_date_none_when_no_runs_supported(self):
        period = _fake_billing_period(base=10, used=10)  # 0 remaining
        result = estimate_usage(
            billing_period=period, prompt_count=1, provider_count=1, frequency="daily",
            start_date=date(2026, 8, 1), end_date=date(2026, 8, 5),
        )
        self.assertEqual(result.supported_executions, 0)
        self.assertIsNone(result.forecast_exhaustion_date)


class RolloverAndBillingPeriodTests(TestCase):
    """close_billing_period / get_or_create_current_billing_period
    (AVTR_SPEC section 15/16/17) -- the exact worked rollover examples
    from the spec, plus the no-compounding and immutability guarantees.

    Every direct call to these two functions is wrapped in
    `with use_agency(...)` here, same as any other direct ORM write to
    an agency-scoped table outside a request (see core/tenancy.py) --
    in real usage that context comes from the Celery task's own
    `use_agency(bypass=True)` (close_expired_billing_periods) or from
    AgencyContextMiddleware on a real request; tests calling these
    functions directly have to supply it themselves, or RLS silently
    (UPDATE) or loudly (INSERT) rejects the write."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Rollover Co")
        self.growth = _make_plan(slug="growth-rollover", prompt_runs_included=600)

    def _period(self, **overrides):
        defaults = {
            "agency": self.agency,
            "subscription": self.subscription,
            "plan": self.growth,
            "billing_interval": Subscription.BillingInterval.MONTHLY,
            "period_start": date(2026, 8, 13),
            "period_end": date(2026, 9, 12),
            "base_prompt_run_allowance": 600,
        }
        defaults.update(overrides)
        with use_agency(self.agency):
            return BillingPeriodUsage.objects.create(**defaults)

    def _close(self, period):
        with use_agency(self.agency):
            return close_billing_period(period)

    def _current_period(self):
        with use_agency(self.agency):
            return get_or_create_current_billing_period(self.subscription)

    def test_growth_5_percent_rollover_from_100_unused(self):
        # 600 included, 500 used, 100 unused -> 100 x 5% = 5 rollover.
        self.subscription = _make_subscription(self.agency, self.growth)
        period = self._period(prompt_runs_used=500)
        closed = self._close(period)
        self.assertEqual(closed.rollover_generated, 5)
        self.assertIsNotNone(closed.closed_at)

        # Prove it actually persisted (not just the in-memory instance) --
        # a fresh fetch, scoped the same way a real read would be.
        with use_agency(self.agency):
            reloaded = BillingPeriodUsage.objects.get(pk=period.pk)
        self.assertEqual(reloaded.rollover_generated, 5)
        self.assertIsNotNone(reloaded.closed_at)

    def test_growth_5_percent_rollover_from_fully_unused(self):
        # 600 included, 0 used -> 600 x 5% = 30 rollover.
        self.subscription = _make_subscription(self.agency, self.growth)
        period = self._period(prompt_runs_used=0)
        closed = self._close(period)
        self.assertEqual(closed.rollover_generated, 30)

    def test_rollover_capped_at_percent_of_base_allowance(self):
        # A plan whose rollover RATE is generous but CAP is tight: rate
        # would compute more than the cap allows, so the cap wins.
        self.subscription = _make_subscription(self.agency, self.growth)
        plan = _make_plan(
            slug="generous-rate-tight-cap", prompt_runs_included=600,
            rollover_percent=Decimal(50), rollover_cap_percent=Decimal(5),
        )
        period = self._period(plan=plan, base_prompt_run_allowance=600, prompt_runs_used=0)
        # Uncapped would be floor(600 * 0.50) = 300; capped at floor(600 * 0.05) = 30.
        closed = self._close(period)
        self.assertEqual(closed.rollover_generated, 30)

    def test_rollover_disabled_on_plan_generates_zero(self):
        self.subscription = _make_subscription(self.agency, self.growth)
        plan = _make_plan(slug="no-rollover-plan", prompt_runs_included=600, rollover_enabled=False)
        period = self._period(plan=plan, prompt_runs_used=0)
        closed = self._close(period)
        self.assertEqual(closed.rollover_generated, 0)

    def test_closing_is_idempotent(self):
        self.subscription = _make_subscription(self.agency, self.growth)
        period = self._period(prompt_runs_used=500)
        self._close(period)
        first_closed_at = period.closed_at
        # Calling it again (e.g. Beat retrying) must not recompute or
        # move closed_at -- an already-closed period is left alone.
        self._close(period)
        self.assertEqual(period.closed_at, first_closed_at)
        self.assertEqual(period.rollover_generated, 5)

    def test_rollover_does_not_compound_across_multiple_periods(self):
        # AVTR_SPEC section 15: only the IMMEDIATELY PREVIOUS period's
        # unused usage contributes -- rollover never accumulates
        # generation-over-generation.
        self.subscription = _make_subscription(
            self.agency, self.growth, current_period_start=date(2026, 6, 13), current_period_end=date(2026, 7, 12)
        )
        period_1 = self._period(
            period_start=date(2026, 6, 13), period_end=date(2026, 7, 12), prompt_runs_used=0
        )
        self._close(period_1)  # generates 30
        self.assertEqual(period_1.rollover_generated, 30)

        with use_agency(self.agency):
            self.subscription.current_period_start = date(2026, 7, 13)
            self.subscription.current_period_end = date(2026, 8, 12)
            self.subscription.save()
        period_2 = self._current_period()
        self.assertEqual(period_2.rollover_received, 30)  # from period_1

        with use_agency(self.agency):
            period_2.prompt_runs_used = 0
            period_2.save(update_fields=["prompt_runs_used"])
        self._close(period_2)
        # period_2's own rollover is 5% of ITS base (600), not of its
        # inflated total_available (630) -- no compounding.
        self.assertEqual(period_2.rollover_generated, 30)

        with use_agency(self.agency):
            self.subscription.current_period_start = date(2026, 8, 13)
            self.subscription.current_period_end = date(2026, 9, 12)
            self.subscription.save()
        period_3 = self._current_period()
        # Only period_2's rollover_generated carries forward -- period_1's
        # is not still being added on top.
        self.assertEqual(period_3.rollover_received, 30)

    def test_get_or_create_current_billing_period_snapshots_plan_allowance(self):
        self.subscription = _make_subscription(self.agency, self.growth)
        period = self._current_period()
        self.assertEqual(period.base_prompt_run_allowance, 600)
        self.assertEqual(period.rollover_received, 0)
        self.assertEqual(period.total_available, 600)

        # Calling it again for the SAME period returns the same row, not
        # a duplicate -- unique_agency_billing_period backs this too.
        again = self._current_period()
        self.assertEqual(period.id, again.id)

    def test_plan_edit_does_not_change_an_already_started_billing_period(self):
        # AVTR_SPEC section 22 plan version safety: an admin raising
        # Growth's allowance from 600 to 750 must not retroactively
        # change a period that already started at 600.
        self.subscription = _make_subscription(self.agency, self.growth)
        period = self._current_period()
        self.assertEqual(period.base_prompt_run_allowance, 600)

        self.growth.prompt_runs_included = 750
        self.growth.save(update_fields=["prompt_runs_included"])

        with use_agency(self.agency):
            period.refresh_from_db()
        self.assertEqual(period.base_prompt_run_allowance, 600)


class PromptScheduleAPITests(APITestCase):
    """Real HTTP CRUD for PromptSchedule, plus the two custom actions
    (AVTR_SPEC §5/§6/§10/§14/§23) -- max-duration validation,
    EXCEEDS_LIMIT blocking creation, active_schedule_limit, provider
    gating, the estimate action never saving, and resume."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.acme_client = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.brand = Brand.objects.create(agency=self.agency, client=self.acme_client, name="Acme Brand")
            self.prompt_1 = Prompt.objects.create(agency=self.agency, client=self.acme_client, text="Prompt one")
            self.prompt_2 = Prompt.objects.create(agency=self.agency, client=self.acme_client, text="Prompt two")

        self.plan = _make_plan(
            slug="growth-schedule-api", prompt_runs_included=600, active_schedule_limit=50,
            providers=[AIProvider.OPENAI, AIProvider.GEMINI],
        )
        # Relative to "today" (not a fixed calendar date) -- several
        # tests below build a schedule spanning today through the end
        # of this period, so a hardcoded end_date silently expires and
        # starts failing every test in this class the moment real time
        # catches up to it (confirmed: 2026-08-31 had already passed).
        today = timezone.now().date()
        self.subscription = _make_subscription(
            self.agency, self.plan, current_period_start=today - timedelta(days=9), current_period_end=today + timedelta(days=21)
        )

        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def _payload(self, **overrides):
        payload = {
            "client": str(self.acme_client.id),
            "brand": str(self.brand.id),
            "prompts": [str(self.prompt_1.id)],
            "providers": [AIProvider.OPENAI],
            "frequency": PromptSchedule.Frequency.DAILY,
            "start_date": "2026-08-05",
            "end_date": "2026-08-10",
            "timezone": "UTC",
        }
        payload.update(overrides)
        return payload

    def test_full_crud_lifecycle(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED, create_response.data)
        self.assertEqual(create_response.data["status"], PromptSchedule.Status.ACTIVE)
        # 1 prompt x 1 provider x 6 daily executions (Aug 5-10 inclusive) = 6.
        self.assertEqual(create_response.data["estimate"]["estimated_prompt_runs"], 6)
        self.assertEqual(create_response.data["estimate"]["status"], "SAFE")
        schedule_id = create_response.data["id"]

        retrieve_response = self.api.get(f"/api/v1/prompt-schedules/{schedule_id}/")
        self.assertEqual(retrieve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(retrieve_response.data["frequency"], PromptSchedule.Frequency.DAILY)

        update_response = self.api.patch(
            f"/api/v1/prompt-schedules/{schedule_id}/", {"prompts": [str(self.prompt_1.id), str(self.prompt_2.id)]},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK, update_response.data)
        self.assertEqual(update_response.data["estimate"]["estimated_prompt_runs"], 12)  # 2 prompts now

        delete_response = self.api.delete(f"/api/v1/prompt-schedules/{schedule_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.api.get(f"/api/v1/prompt-schedules/{schedule_id}/").status_code, status.HTTP_404_NOT_FOUND)

    def test_new_schedule_is_force_assigned_to_requesters_agency_and_goes_active(self):
        response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        with use_agency(self.agency):
            created = PromptSchedule.objects.get(id=response.data["id"])
        self.assertEqual(created.agency_id, self.agency.id)
        self.assertEqual(created.status, PromptSchedule.Status.ACTIVE)

    def test_end_date_beyond_current_billing_period_is_rejected(self):
        # AVTR_SPEC §6: bounded by the CURRENT billing period regardless
        # of anything the frontend already checked -- one day past
        # current_period_end (itself relative to "today", see setUp) is
        # guaranteed to be beyond it no matter when this test runs.
        beyond_period = (self.subscription.current_period_end + timedelta(days=1)).isoformat()
        response = self.api.post(
            "/api/v1/prompt-schedules/", self._payload(end_date=beyond_period), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("end_date", response.data)

    def test_end_date_before_start_date_is_rejected(self):
        response = self.api.post(
            "/api/v1/prompt-schedules/", self._payload(start_date="2026-08-10", end_date="2026-08-05"),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("end_date", response.data)

    def test_provider_not_in_plan_is_rejected(self):
        response = self.api.post(
            "/api/v1/prompt-schedules/", self._payload(providers=[AIProvider.PERPLEXITY]), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("providers", response.data)
        with use_agency(self.agency):
            self.assertEqual(PromptSchedule.objects.count(), 0)

    def test_custom_frequency_requires_interval_days(self):
        response = self.api.post(
            "/api/v1/prompt-schedules/", self._payload(frequency=PromptSchedule.Frequency.CUSTOM), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("custom_interval_days", response.data)

    def test_exceeds_limit_blocks_creation_with_estimate_in_error_body(self):
        # A tiny plan (5 included) + a schedule that would need far more
        # than that -- AVTR_SPEC §10: this must be rejected outright, no
        # partial/overage creation, and the error body carries the full
        # estimate so the frontend can render "Adjust Schedule"/"Upgrade
        # Plan" without a second round-trip.
        tiny_plan = _make_plan(slug="tiny-plan", prompt_runs_included=5, providers=[AIProvider.OPENAI])
        agency = Agency.objects.create(name="Tiny Co")
        _make_subscription(agency, tiny_plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31))
        User.objects.create_user(email="admin@tiny.test", password="pw123456789", agency=agency, role=User.Role.ADMIN)
        with use_agency(agency):
            tiny_client = Client.objects.create(agency=agency, name="Tiny Client")
            tiny_brand = Brand.objects.create(agency=agency, client=tiny_client, name="Tiny Brand")
            tiny_prompt = Prompt.objects.create(agency=agency, client=tiny_client, text="Tiny prompt")

        api = APIClient()
        token_response = api.post(
            "/api/v1/auth/token/", {"email": "admin@tiny.test", "password": "pw123456789"}, format="json"
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        response = api.post(
            "/api/v1/prompt-schedules/",
            {
                "client": str(tiny_client.id),
                "brand": str(tiny_brand.id),
                "prompts": [str(tiny_prompt.id)],
                "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.DAILY,
                "start_date": "2026-08-01",
                "end_date": "2026-08-10",  # 10 daily executions x 1 x 1 = 10 > 5 included
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("estimate", response.data)
        self.assertEqual(response.data["estimate"]["status"], "EXCEEDS_LIMIT")
        self.assertIn("non_field_errors", response.data)
        with use_agency(agency):
            self.assertEqual(PromptSchedule.objects.count(), 0)

    def test_active_schedule_limit_enforced_only_on_create(self):
        limited_plan = _make_plan(
            slug="one-schedule-plan", prompt_runs_included=600, active_schedule_limit=1,
            providers=[AIProvider.OPENAI],
        )
        agency = Agency.objects.create(name="OneSchedule Co")
        _make_subscription(
            agency, limited_plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31)
        )
        User.objects.create_user(
            email="admin@onesched.test", password="pw123456789", agency=agency, role=User.Role.ADMIN
        )
        with use_agency(agency):
            c = Client.objects.create(agency=agency, name="C")
            b = Brand.objects.create(agency=agency, client=c, name="B")
            p = Prompt.objects.create(agency=agency, client=c, text="P")

        api = APIClient()
        token_response = api.post(
            "/api/v1/auth/token/", {"email": "admin@onesched.test", "password": "pw123456789"}, format="json"
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        payload = {
            "client": str(c.id), "brand": str(b.id), "prompts": [str(p.id)], "providers": [AIProvider.OPENAI],
            "frequency": PromptSchedule.Frequency.ONCE, "start_date": "2026-08-05", "end_date": "2026-08-05",
            "timezone": "UTC",
        }
        first = api.post("/api/v1/prompt-schedules/", payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = api.post("/api/v1/prompt-schedules/", payload, format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

        # But editing the existing (already-counted) schedule is fine --
        # the limit is a create-time gate only.
        schedule_id = first.data["id"]
        patch_response = api.patch(
            f"/api/v1/prompt-schedules/{schedule_id}/", {"timezone": "America/New_York"}, format="json"
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK, patch_response.data)

    def test_estimate_action_never_saves_a_schedule(self):
        response = self.api.post(
            "/api/v1/prompt-schedules/estimate/",
            {
                "client": str(self.acme_client.id),
                "prompts": [str(self.prompt_1.id), str(self.prompt_2.id)],
                "providers": [AIProvider.OPENAI, AIProvider.GEMINI],
                "frequency": PromptSchedule.Frequency.WEEKLY,
                "start_date": "2026-08-05",
                "end_date": "2026-08-26",
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        # 2 prompts x 2 providers x 4 weekly executions (Aug 5,12,19,26) = 16.
        self.assertEqual(response.data["estimated_prompt_runs"], 16)
        self.assertEqual(response.data["status"], "SAFE")
        with use_agency(self.agency):
            self.assertEqual(PromptSchedule.objects.count(), 0)

    def test_estimate_action_rejects_prompt_from_another_agency(self):
        other_agency = Agency.objects.create(name="Other")
        with use_agency(other_agency):
            other_client = Client.objects.create(agency=other_agency, name="Other client")
            other_prompt = Prompt.objects.create(agency=other_agency, client=other_client, text="Not yours")

        response = self.api.post(
            "/api/v1/prompt-schedules/estimate/",
            {
                "client": str(self.acme_client.id),
                "prompts": [str(other_prompt.id)],
                "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.ONCE,
                "start_date": "2026-08-05",
                "end_date": "2026-08-05",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("prompts", response.data)

    def test_resume_reactivates_a_paused_schedule(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        schedule_id = create_response.data["id"]
        with use_agency(self.agency):
            PromptSchedule.objects.filter(id=schedule_id).update(status=PromptSchedule.Status.PAUSED)

        resume_response = self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/resume/")
        self.assertEqual(resume_response.status_code, status.HTTP_200_OK, resume_response.data)
        self.assertEqual(resume_response.data["status"], PromptSchedule.Status.ACTIVE)

    def test_resume_rejects_a_schedule_that_is_not_paused(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        schedule_id = create_response.data["id"]
        resume_response = self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/resume/")
        self.assertEqual(resume_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resume_re_validates_usage_and_can_still_reject(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        schedule_id = create_response.data["id"]
        with use_agency(self.agency):
            PromptSchedule.objects.filter(id=schedule_id).update(status=PromptSchedule.Status.PAUSED_LIMIT_REACHED)
            billing_period = get_or_create_current_billing_period(self.subscription)
            # Burn through everything but 1 unit so resuming this 6-run
            # schedule is still impossible even after the pause.
            billing_period.prompt_runs_used = 599
            billing_period.save(update_fields=["prompt_runs_used"])

        resume_response = self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/resume/")
        self.assertEqual(resume_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resume_response.data["estimate"]["status"], "EXCEEDS_LIMIT")
        with use_agency(self.agency):
            schedule = PromptSchedule.objects.get(id=schedule_id)
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED_LIMIT_REACHED)

    def test_estimate_reflects_an_existing_active_schedules_remaining_commitment(self):
        # An existing DAILY schedule, active today through the end of the
        # billing period: 1 prompt x 1 provider x N remaining days.
        today = timezone.now().date()
        existing = self.api.post(
            "/api/v1/prompt-schedules/",
            self._payload(
                start_date=today.isoformat(),
                end_date=self.subscription.current_period_end.isoformat(),
                frequency=PromptSchedule.Frequency.DAILY,
                providers=[AIProvider.OPENAI],
            ),
            format="json",
        )
        self.assertEqual(existing.status_code, status.HTTP_201_CREATED, existing.data)
        remaining_days = (self.subscription.current_period_end - today).days + 1

        # A brand-new, hypothetical schedule of the same shape, previewed
        # via the estimate action (nothing saved) -- must reflect the
        # FIRST schedule's full remaining draw, not just today's slice.
        response = self.api.post(
            "/api/v1/prompt-schedules/estimate/",
            {
                "client": str(self.acme_client.id),
                "prompts": [str(self.prompt_2.id)],
                "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.DAILY,
                "start_date": today.isoformat(),
                "end_date": self.subscription.current_period_end.isoformat(),
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["reserved_by_other_schedules"], remaining_days)
        self.assertEqual(len(response.data["other_active_schedules"]), 1)
        commitment = response.data["other_active_schedules"][0]
        self.assertEqual(commitment["schedule_id"], existing.data["id"])
        self.assertEqual(commitment["remaining_prompt_runs"], remaining_days)
        self.assertEqual(commitment["executed_so_far"], 0)
        self.assertEqual(commitment["end_date"], self.subscription.current_period_end)

    def test_new_schedule_blocked_when_it_would_exceed_limit_once_stacked_on_existing_commitment(self):
        tiny_plan = _make_plan(slug="tiny-stack-plan", prompt_runs_included=10, providers=[AIProvider.OPENAI])
        agency = Agency.objects.create(name="Tiny Stack Co")
        today = timezone.now().date()
        _make_subscription(
            agency,
            tiny_plan,
            current_period_start=today - timedelta(days=1),
            current_period_end=today + timedelta(days=20),
        )
        User.objects.create_user(
            email="admin@tinystack.test", password="pw123456789", agency=agency, role=User.Role.ADMIN
        )
        with use_agency(agency):
            c = Client.objects.create(agency=agency, name="C")
            b = Brand.objects.create(agency=agency, client=c, name="B")
            p1 = Prompt.objects.create(agency=agency, client=c, text="P1")
            p2 = Prompt.objects.create(agency=agency, client=c, text="P2")

        api = APIClient()
        token_response = api.post(
            "/api/v1/auth/token/", {"email": "admin@tinystack.test", "password": "pw123456789"}, format="json"
        )
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        # Existing schedule: 1 prompt x 1 provider, daily for 8 days
        # (today + 7 more) = 8 Prompt Runs still owed -- well within the
        # plan's 10, so it's created successfully on its own.
        existing = api.post(
            "/api/v1/prompt-schedules/",
            {
                "client": str(c.id), "brand": str(b.id), "prompts": [str(p1.id)], "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.DAILY,
                "start_date": today.isoformat(), "end_date": (today + timedelta(days=7)).isoformat(),
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(existing.status_code, status.HTTP_201_CREATED, existing.data)

        # A second schedule needing 5 more (daily for 5 days) would be
        # SAFE in isolation (5/10 = 50%), but the existing one already
        # owes 8 -- 8 + 5 = 13 > 10, so this must be rejected outright
        # rather than silently accepted and starving one of the two
        # schedules of credits later.
        second = api.post(
            "/api/v1/prompt-schedules/",
            {
                "client": str(c.id), "brand": str(b.id), "prompts": [str(p2.id)], "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.DAILY,
                "start_date": today.isoformat(), "end_date": (today + timedelta(days=4)).isoformat(),
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second.data["estimate"]["status"], "EXCEEDS_LIMIT")
        # DRF's raised ValidationError wraps every nested leaf value
        # (ints included) in an ErrorDetail(str subclass) -- cast back
        # before comparing against the int this really is.
        self.assertEqual(int(second.data["estimate"]["reserved_by_other_schedules"]), 8)
        with use_agency(agency):
            self.assertEqual(PromptSchedule.objects.filter(client=c).count(), 1)  # only the first was saved

    def test_updating_a_schedule_excludes_itself_from_its_own_reservation(self):
        # Regression: PATCHing an active schedule must not count that
        # same schedule as an "other" competing reservation against
        # itself -- it would otherwise (impossibly) always exceed limit.
        today = timezone.now().date()
        create_response = self.api.post(
            "/api/v1/prompt-schedules/",
            self._payload(
                start_date=today.isoformat(),
                end_date=self.subscription.current_period_end.isoformat(),
                frequency=PromptSchedule.Frequency.DAILY,
            ),
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED, create_response.data)
        schedule_id = create_response.data["id"]

        patch_response = self.api.patch(
            f"/api/v1/prompt-schedules/{schedule_id}/", {"timezone": "America/New_York"}, format="json"
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK, patch_response.data)
        self.assertEqual(patch_response.data["estimate"]["reserved_by_other_schedules"], 0)

    def test_pause_stops_an_active_schedule(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        schedule_id = create_response.data["id"]

        pause_response = self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/pause/")
        self.assertEqual(pause_response.status_code, status.HTTP_200_OK, pause_response.data)
        self.assertEqual(pause_response.data["status"], PromptSchedule.Status.PAUSED)
        with use_agency(self.agency):
            schedule = PromptSchedule.objects.get(id=schedule_id)
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED)

    def test_pause_frees_its_reservation_for_a_new_schedules_estimate(self):
        today = timezone.now().date()
        existing = self.api.post(
            "/api/v1/prompt-schedules/",
            self._payload(
                start_date=today.isoformat(),
                end_date=self.subscription.current_period_end.isoformat(),
                frequency=PromptSchedule.Frequency.DAILY,
            ),
            format="json",
        )
        self.api.post(f"/api/v1/prompt-schedules/{existing.data['id']}/pause/")

        response = self.api.post(
            "/api/v1/prompt-schedules/estimate/",
            {
                "client": str(self.acme_client.id),
                "prompts": [str(self.prompt_2.id)],
                "providers": [AIProvider.OPENAI],
                "frequency": PromptSchedule.Frequency.ONCE,
                "start_date": today.isoformat(),
                "end_date": today.isoformat(),
                "timezone": "UTC",
            },
            format="json",
        )
        self.assertEqual(response.data["reserved_by_other_schedules"], 0)
        self.assertEqual(response.data["other_active_schedules"], [])

    def test_pause_rejects_an_already_paused_schedule(self):
        create_response = self.api.post("/api/v1/prompt-schedules/", self._payload(), format="json")
        schedule_id = create_response.data["id"]
        self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/pause/")

        second_pause = self.api.post(f"/api/v1/prompt-schedules/{schedule_id}/pause/")
        self.assertEqual(second_pause.status_code, status.HTTP_400_BAD_REQUEST)


class SubscriptionAndBillingHistoryAPITests(APITestCase):
    """GET /subscription/, /subscription/history/, /plans/ (AVTR_SPEC
    §18/§23) -- all three are read-only from the agency-member side."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.member = User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.plan = _make_plan(slug="growth-sub-api", prompt_runs_included=600)

        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "member@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_subscription_detail_404_without_a_subscription(self):
        response = self.api.get("/api/v1/subscription/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_subscription_detail_includes_plan_and_current_billing_period(self):
        _make_subscription(
            self.agency, self.plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31)
        )
        response = self.api.get("/api/v1/subscription/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["plan"]["slug"], "growth-sub-api")
        self.assertEqual(response.data["status"], Subscription.Status.ACTIVE)
        self.assertIsNotNone(response.data["current_billing_period"])
        self.assertEqual(response.data["current_billing_period"]["base_prompt_run_allowance"], 600)
        self.assertEqual(response.data["current_billing_period"]["total_available"], 600)

    def test_subscription_detail_has_no_billing_period_when_not_usable(self):
        _make_subscription(
            self.agency, self.plan, status=Subscription.Status.EXPIRED,
            current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31),
        )
        response = self.api.get("/api/v1/subscription/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["current_billing_period"])

    def test_billing_period_history_lists_newest_first(self):
        subscription = _make_subscription(
            self.agency, self.plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31)
        )
        with use_agency(self.agency):
            older = BillingPeriodUsage.objects.create(
                agency=self.agency, subscription=subscription, plan=self.plan,
                billing_interval=Subscription.BillingInterval.MONTHLY,
                period_start=date(2026, 7, 1), period_end=date(2026, 7, 31),
                base_prompt_run_allowance=600, closed_at=timezone.now(), rollover_generated=10,
            )
            newer = BillingPeriodUsage.objects.create(
                agency=self.agency, subscription=subscription, plan=self.plan,
                billing_interval=Subscription.BillingInterval.MONTHLY,
                period_start=date(2026, 8, 1), period_end=date(2026, 8, 31),
                base_prompt_run_allowance=600,
            )
        response = self.api.get("/api/v1/subscription/history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["id"] for row in response.data], [str(newer.id), str(older.id)])

    def test_billing_period_history_only_shows_own_agency(self):
        other_agency = Agency.objects.create(name="Other")
        other_plan = _make_plan(slug="growth-sub-api-other")
        other_subscription = _make_subscription(
            other_agency, other_plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31)
        )
        with use_agency(other_agency):
            BillingPeriodUsage.objects.create(
                agency=other_agency, subscription=other_subscription, plan=other_plan,
                billing_interval=Subscription.BillingInterval.MONTHLY,
                period_start=date(2026, 8, 1), period_end=date(2026, 8, 31), base_prompt_run_allowance=600,
            )
        response = self.api.get("/api/v1/subscription/history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_plan_list_only_shows_active_plans(self):
        _make_plan(slug="inactive-plan", is_active=False)
        response = self.api.get("/api/v1/plans/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = [p["slug"] for p in response.data]
        self.assertIn("growth-sub-api", slugs)
        self.assertNotIn("inactive-plan", slugs)


class CeleryScheduleDispatchTests(TestCase):
    """dispatch_scheduled_prompt_runs, driven entirely by PromptSchedule
    now (AVTR_SPEC §5/§27/§28/§29): due-today creation with the provider
    multiplier, idempotency across repeated ticks, pausing on an
    unusable subscription, pausing (with NO partial creation) when usage
    is insufficient, and completion after the last execution."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        self.plan = _make_plan(
            slug="growth-dispatch", prompt_runs_included=600, providers=[AIProvider.OPENAI, AIProvider.GEMINI]
        )
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Acme Brand")
            self.prompt_1 = Prompt.objects.create(agency=self.agency, client=self.client_obj, text="Prompt one")
            self.prompt_2 = Prompt.objects.create(agency=self.agency, client=self.client_obj, text="Prompt two")

    def _make_schedule(self, **overrides):
        today = timezone.now().date()
        defaults = {
            "agency": self.agency,
            "client": self.client_obj,
            "brand": self.brand,
            "frequency": PromptSchedule.Frequency.DAILY,
            "start_date": today,
            "end_date": today + timedelta(days=6),
            "timezone": "UTC",
            # Midnight, not the model's own 09:00 default -- these tests
            # don't exercise run_time gating (see RunTimeGatingTests) and
            # must not depend on what time it happens to be when the
            # suite runs.
            "run_time": time(0, 0),
            "status": PromptSchedule.Status.ACTIVE,
            "providers": [AIProvider.OPENAI, AIProvider.GEMINI],
        }
        defaults.update(overrides)
        prompts = defaults.pop("prompts", [self.prompt_1, self.prompt_2])
        with use_agency(self.agency):
            schedule = PromptSchedule.objects.create(**defaults)
            schedule.prompts.set(prompts)
        return schedule

    @override_settings(OPENAI_API_KEY="sk-test-key")
    @patch("core.ai_providers.OpenAIProviderClient.send_prompt", return_value="A great option.")
    def test_due_today_creates_a_promptrun_per_prompt_times_provider(self, mock_send_prompt):
        _make_subscription(self.agency, self.plan)
        self._make_schedule()

        processed = tasks.dispatch_scheduled_prompt_runs()
        self.assertEqual(processed, 1)

        with use_agency(self.agency):
            runs = list(PromptRun.objects.all())
        # 2 prompts x 2 providers (AVTR_SPEC §28 multiplier) = 4 PromptRuns.
        self.assertEqual(len(runs), 4)
        self.assertEqual({r.provider for r in runs}, {AIProvider.OPENAI, AIProvider.GEMINI})
        self.assertTrue(all(r.idempotency_key for r in runs))
        # CELERY_TASK_ALWAYS_EAGER (settings.py, test-only) runs the
        # execute_prompt_run.delay() call inline instead of queuing it, so
        # by the time dispatch returns, every run has already reached its
        # terminal state -- same real code path a live worker would run.
        # OpenAI is mocked to succeed here; Gemini isn't integrated yet
        # (core/ai_providers.py), so its runs correctly land on FAILED.
        openai_runs = [r for r in runs if r.provider == AIProvider.OPENAI]
        gemini_runs = [r for r in runs if r.provider == AIProvider.GEMINI]
        self.assertTrue(all(r.status == PromptRun.Status.COMPLETED for r in openai_runs))
        self.assertTrue(all(r.status == PromptRun.Status.FAILED for r in gemini_runs))
        self.assertTrue(all(r.executed_at for r in runs))
        self.assertTrue(all(r.response_text for r in runs))

    def test_usage_is_recorded_once_per_dispatch(self):
        subscription = _make_subscription(self.agency, self.plan)
        self._make_schedule()

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            period = get_or_create_current_billing_period(subscription)
        self.assertEqual(period.prompt_runs_used, 4)

    def test_repeated_dispatch_the_same_day_is_idempotent(self):
        _make_subscription(self.agency, self.plan)
        self._make_schedule()

        first = tasks.dispatch_scheduled_prompt_runs()
        second = tasks.dispatch_scheduled_prompt_runs()

        self.assertEqual(first, 1)
        self.assertEqual(second, 1)  # schedule is still processed...
        with use_agency(self.agency):
            # ...but no duplicate PromptRuns and no double-billing.
            self.assertEqual(PromptRun.objects.count(), 4)

    def test_not_due_today_is_skipped(self):
        _make_subscription(self.agency, self.plan)
        tomorrow = timezone.now().date() + timedelta(days=1)
        self._make_schedule(frequency=PromptSchedule.Frequency.ONCE, start_date=tomorrow, end_date=tomorrow)

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_pauses_when_subscription_missing(self):
        schedule = self._make_schedule()  # no subscription created for this agency at all

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            schedule.refresh_from_db()
            self.assertEqual(PromptRun.objects.count(), 0)
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED)

    def test_pauses_when_subscription_is_not_usable(self):
        _make_subscription(self.agency, self.plan, status=Subscription.Status.EXPIRED)
        schedule = self._make_schedule()

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            schedule.refresh_from_db()
            self.assertEqual(PromptRun.objects.count(), 0)
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED)

    def test_pauses_with_limit_reached_status_and_creates_nothing_partial(self):
        # AVTR_SPEC §12: only 2 Prompt Runs remain, but this tick needs 4
        # (2 prompts x 2 providers) -- must pause with ZERO PromptRuns
        # created, never half-execute the due date.
        subscription = _make_subscription(self.agency, self.plan)
        with use_agency(self.agency):
            period = get_or_create_current_billing_period(subscription)
            period.prompt_runs_used = 598
            period.save(update_fields=["prompt_runs_used"])
        schedule = self._make_schedule()

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            schedule.refresh_from_db()
            self.assertEqual(PromptRun.objects.count(), 0)
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED_LIMIT_REACHED)

    def test_schedule_completes_after_its_last_execution(self):
        _make_subscription(self.agency, self.plan)
        today = timezone.now().date()
        schedule = self._make_schedule(
            frequency=PromptSchedule.Frequency.ONCE, start_date=today, end_date=today
        )

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            schedule.refresh_from_db()
        self.assertEqual(schedule.status, PromptSchedule.Status.COMPLETED)

    def test_only_active_schedules_are_considered(self):
        _make_subscription(self.agency, self.plan)
        self._make_schedule(status=PromptSchedule.Status.PAUSED)
        self._make_schedule(status=PromptSchedule.Status.DRAFT)
        self._make_schedule(status=PromptSchedule.Status.CANCELLED)

        processed = tasks.dispatch_scheduled_prompt_runs()

        self.assertEqual(processed, 0)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_invalid_timezone_is_skipped_without_raising(self):
        _make_subscription(self.agency, self.plan)
        self._make_schedule(timezone="Not/A_Real_Zone")

        # Must not raise -- an invalid timezone is logged and skipped,
        # not a task-crashing bug (see _process_schedule_tick).
        processed = tasks.dispatch_scheduled_prompt_runs()
        self.assertEqual(processed, 1)
        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)

    def test_due_today_but_run_time_not_yet_reached_creates_nothing(self):
        _make_subscription(self.agency, self.plan)
        today = timezone.now().date()
        # 23:59 -- due today, but (barring a test run in the literal last
        # minute of the day) its run_time hasn't arrived yet.
        schedule = self._make_schedule(
            frequency=PromptSchedule.Frequency.ONCE, start_date=today, end_date=today, run_time=time(23, 59)
        )

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 0)
            schedule.refresh_from_db()
        # Not completed either -- today's the last (only) execution date,
        # but it hasn't actually run yet, so the schedule must stay ACTIVE.
        self.assertEqual(schedule.status, PromptSchedule.Status.ACTIVE)

    def test_fires_once_its_run_time_has_passed(self):
        _make_subscription(self.agency, self.plan)
        # 00:01 -- due today, and (barring a test run in the literal
        # first minute of the day) its run_time has already passed.
        self._make_schedule(run_time=time(0, 1))

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            # 2 prompts x 2 providers.
            self.assertEqual(PromptRun.objects.count(), 4)

    def _frozen_today_at(self, hour, minute):
        """A datetime today (UTC) at hour:minute -- the real date, so the
        subscription's billing period still covers it."""
        today = timezone.now().date()
        return datetime(today.year, today.month, today.day, hour, minute, tzinfo=UTC)

    def _late_schedule(self, **overrides):
        yesterday = timezone.now().date() - timedelta(days=1)
        defaults = {"start_date": yesterday, "end_date": yesterday + timedelta(days=6), "run_time": time(23, 30)}
        defaults.update(overrides)
        return self._make_schedule(**defaults)

    @override_settings(SCHEDULE_TICK_MINUTES=60)
    def test_late_night_run_is_caught_up_on_the_first_tick_after_midnight(self):
        # Hourly ticks fire at 23:00 and 00:00, so a 23:30 run has no tick
        # left on its own day -- the 00:10 tick must still run it.
        _make_subscription(self.agency, self.plan)
        schedule = self._late_schedule()
        yesterday = timezone.now().date() - timedelta(days=1)

        with patch("django.utils.timezone.now", return_value=self._frozen_today_at(0, 10)):
            tasks.dispatch_scheduled_prompt_runs()
            tasks.dispatch_scheduled_prompt_runs()  # a repeated tick must not duplicate

        with use_agency(self.agency):
            keys = list(PromptRun.objects.values_list("idempotency_key", flat=True))
        self.assertEqual(len(keys), 4)
        self.assertTrue(all(f"schedule:{schedule.id}:{yesterday.isoformat()}:" in k for k in keys))

    @override_settings(SCHEDULE_TICK_MINUTES=60)
    def test_older_misses_are_not_replayed(self):
        # 03:00 is well past one tick interval after 23:30 -- the server was
        # simply down; replaying it now would spend runs nobody saw happen.
        _make_subscription(self.agency, self.plan)
        self._late_schedule()

        with patch("django.utils.timezone.now", return_value=self._frozen_today_at(3, 0)):
            tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            # Only today's occurrence is owed, and its 23:30 hasn't come yet.
            self.assertEqual(PromptRun.objects.count(), 0)

    @override_settings(SCHEDULE_TICK_MINUTES=60)
    def test_late_last_execution_runs_and_then_completes(self):
        _make_subscription(self.agency, self.plan)
        yesterday = timezone.now().date() - timedelta(days=1)
        schedule = self._late_schedule(frequency=PromptSchedule.Frequency.ONCE, end_date=yesterday)

        with patch("django.utils.timezone.now", return_value=self._frozen_today_at(0, 5)):
            tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            self.assertEqual(PromptRun.objects.count(), 4)
            schedule.refresh_from_db()
        self.assertEqual(schedule.status, PromptSchedule.Status.COMPLETED)

    def test_dispatch_creates_a_schedule_started_notification(self):
        _make_subscription(self.agency, self.plan)
        schedule = self._make_schedule()

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            notifications = list(Notification.objects.all())
        self.assertEqual(len(notifications), 1)
        notification = notifications[0]
        self.assertEqual(notification.type, Notification.Type.SCHEDULE_STARTED)
        self.assertEqual(notification.schedule_id, schedule.id)
        self.assertFalse(notification.is_read)
        self.assertIn(self.client_obj.name, notification.message)
        self.assertIn("4", notification.message)  # 2 prompts x 2 providers

    def test_repeated_dispatch_the_same_day_does_not_duplicate_the_notification(self):
        _make_subscription(self.agency, self.plan)
        self._make_schedule()

        tasks.dispatch_scheduled_prompt_runs()
        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            # Second tick creates 0 new PromptRuns (already_executed_today),
            # so _notify_schedule_started never fires a second time either.
            self.assertEqual(Notification.objects.count(), 1)

    def test_dispatch_with_nothing_created_does_not_notify(self):
        _make_subscription(self.agency, self.plan)
        tomorrow = timezone.now().date() + timedelta(days=1)
        self._make_schedule(frequency=PromptSchedule.Frequency.ONCE, start_date=tomorrow, end_date=tomorrow)

        tasks.dispatch_scheduled_prompt_runs()

        with use_agency(self.agency):
            self.assertEqual(Notification.objects.count(), 0)


class NotificationAPITests(APITestCase):
    """GET /api/v1/notifications/ + mark-read/mark-all-read -- rows are
    only ever created by core.tasks._notify_schedule_started; this is
    the read/acknowledge surface the dashboard uses."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.admin = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        with use_agency(self.agency):
            self.unread = Notification.objects.create(
                agency=self.agency, type=Notification.Type.SCHEDULE_STARTED, message="Schedule A started -- 2 runs."
            )
            self.read = Notification.objects.create(
                agency=self.agency,
                type=Notification.Type.SCHEDULE_STARTED,
                message="Schedule B started -- 1 run.",
                is_read=True,
            )
        self.api = APIClient()
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_list_returns_own_agencys_notifications_newest_first(self):
        response = self.api.get("/api/v1/notifications/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([n["id"] for n in response.data], [str(self.read.id), str(self.unread.id)])

    def test_filter_by_is_read_false_returns_only_unread(self):
        response = self.api.get("/api/v1/notifications/?is_read=false")
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], str(self.unread.id))

    def test_mark_read_flips_a_single_notification(self):
        response = self.api.post(f"/api/v1/notifications/{self.unread.id}/mark-read/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_read"])
        with use_agency(self.agency):
            self.unread.refresh_from_db()
        self.assertTrue(self.unread.is_read)

    def test_mark_all_read_flips_every_unread_notification(self):
        with use_agency(self.agency):
            Notification.objects.create(
                agency=self.agency, type=Notification.Type.SCHEDULE_STARTED, message="Schedule C started -- 3 runs."
            )

        response = self.api.post("/api/v1/notifications/mark-all-read/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["updated"], 2)  # self.unread + the new one, not self.read
        with use_agency(self.agency):
            self.assertEqual(Notification.objects.filter(is_read=False).count(), 0)

    def test_cannot_see_or_mark_another_agencys_notification(self):
        other_agency = Agency.objects.create(name="Other Co")
        with use_agency(other_agency):
            other_notification = Notification.objects.create(
                agency=other_agency, type=Notification.Type.SCHEDULE_STARTED, message="Not yours."
            )

        list_response = self.api.get("/api/v1/notifications/")
        self.assertNotIn(str(other_notification.id), [n["id"] for n in list_response.data])

        mark_response = self.api.post(f"/api/v1/notifications/{other_notification.id}/mark-read/")
        self.assertEqual(mark_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_notification_survives_its_schedules_deletion(self):
        plan = _make_plan(slug="notif-survives-plan")
        _make_subscription(self.agency, plan)
        with use_agency(self.agency):
            client_obj = Client.objects.create(agency=self.agency, name="C")
            brand = Brand.objects.create(agency=self.agency, client=client_obj, name="B")
            prompt = Prompt.objects.create(agency=self.agency, client=client_obj, text="P")
            schedule = PromptSchedule.objects.create(
                agency=self.agency, client=client_obj, brand=brand, frequency=PromptSchedule.Frequency.ONCE,
                start_date=timezone.now().date(), end_date=timezone.now().date(), timezone="UTC",
                run_time=time(0, 0), status=PromptSchedule.Status.ACTIVE, providers=[AIProvider.OPENAI],
            )
            schedule.prompts.set([prompt])

        tasks.dispatch_scheduled_prompt_runs()
        with use_agency(self.agency):
            notification = Notification.objects.get(schedule=schedule)
            schedule.delete()
            notification.refresh_from_db()
        self.assertIsNone(notification.schedule_id)
        self.assertIn("C", notification.message)  # the message text itself is untouched


class SubscriptionExpiryTaskTests(TestCase):
    """expire_overdue_subscriptions / close_expired_billing_periods
    (AVTR_SPEC §13/§15/§16): no data is ever deleted, only status
    transitions -- and a paused schedule stays paused until an explicit
    manual resume, even across a later renewal."""

    def setUp(self):
        self.agency = Agency.objects.create(name="Acme")
        self.plan = _make_plan(slug="growth-expiry", prompt_runs_included=600)
        with use_agency(self.agency):
            self.client_obj = Client.objects.create(agency=self.agency, name="Acme's Client")
            self.brand = Brand.objects.create(agency=self.agency, client=self.client_obj, name="Acme Brand")
            self.prompt = Prompt.objects.create(agency=self.agency, client=self.client_obj, text="Prompt")

    def test_expires_a_subscription_past_its_period_end(self):
        subscription = _make_subscription(
            self.agency, self.plan,
            current_period_start=date(2026, 6, 1), current_period_end=date(2026, 7, 1),
        )
        expired_count = tasks.expire_overdue_subscriptions()
        self.assertEqual(expired_count, 1)
        with use_agency(self.agency):
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.EXPIRED)

    def test_does_not_expire_a_subscription_still_within_its_period(self):
        today = timezone.now().date()
        subscription = _make_subscription(
            self.agency, self.plan, current_period_start=today, current_period_end=today + timedelta(days=10)
        )
        expired_count = tasks.expire_overdue_subscriptions()
        self.assertEqual(expired_count, 0)
        with use_agency(self.agency):
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.ACTIVE)

    def test_expiry_pauses_live_schedules_without_deleting_any_data(self):
        _make_subscription(
            self.agency, self.plan,
            current_period_start=date(2026, 6, 1), current_period_end=date(2026, 7, 1),
        )
        with use_agency(self.agency):
            active_schedule = PromptSchedule.objects.create(
                agency=self.agency, client=self.client_obj, brand=self.brand,
                frequency=PromptSchedule.Frequency.DAILY, start_date=date(2026, 6, 1), end_date=date(2026, 6, 30),
                status=PromptSchedule.Status.ACTIVE, providers=[AIProvider.OPENAI],
            )
            active_schedule.prompts.set([self.prompt])
            limit_paused_schedule = PromptSchedule.objects.create(
                agency=self.agency, client=self.client_obj, brand=self.brand,
                frequency=PromptSchedule.Frequency.DAILY, start_date=date(2026, 6, 1), end_date=date(2026, 6, 30),
                status=PromptSchedule.Status.PAUSED_LIMIT_REACHED, providers=[AIProvider.OPENAI],
            )
            limit_paused_schedule.prompts.set([self.prompt])
            completed_schedule = PromptSchedule.objects.create(
                agency=self.agency, client=self.client_obj, brand=self.brand,
                frequency=PromptSchedule.Frequency.ONCE, start_date=date(2026, 6, 1), end_date=date(2026, 6, 1),
                status=PromptSchedule.Status.COMPLETED, providers=[AIProvider.OPENAI],
            )
            completed_schedule.prompts.set([self.prompt])

        tasks.expire_overdue_subscriptions()

        with use_agency(self.agency):
            active_schedule.refresh_from_db()
            limit_paused_schedule.refresh_from_db()
            completed_schedule.refresh_from_db()
            # Nothing was deleted -- every row (client/brand/prompt/
            # schedules) still exists, just paused where it was live.
            self.assertTrue(Client.objects.filter(id=self.client_obj.id).exists())
            self.assertTrue(Prompt.objects.filter(id=self.prompt.id).exists())
        self.assertEqual(active_schedule.status, PromptSchedule.Status.PAUSED)
        self.assertEqual(limit_paused_schedule.status, PromptSchedule.Status.PAUSED)
        # Already-completed schedules are left alone -- expiry only acts
        # on schedules that were actually still live.
        self.assertEqual(completed_schedule.status, PromptSchedule.Status.COMPLETED)

    def test_renewal_preserves_history_and_paused_schedules_require_manual_resume(self):
        # AVTR_SPEC §14: renewing a subscription (moving its dates and
        # status back to active) must NOT auto-resume anything that was
        # paused -- only an explicit user resume action does that.
        subscription = _make_subscription(
            self.agency, self.plan,
            current_period_start=date(2026, 6, 1), current_period_end=date(2026, 7, 1),
        )
        with use_agency(self.agency):
            schedule = PromptSchedule.objects.create(
                agency=self.agency, client=self.client_obj, brand=self.brand,
                frequency=PromptSchedule.Frequency.DAILY, start_date=date(2026, 6, 1), end_date=date(2026, 6, 30),
                status=PromptSchedule.Status.ACTIVE, providers=[AIProvider.OPENAI],
            )
            schedule.prompts.set([self.prompt])
            old_period = get_or_create_current_billing_period(subscription)
            old_period.prompt_runs_used = 400
            old_period.save(update_fields=["prompt_runs_used"])

        tasks.expire_overdue_subscriptions()
        with use_agency(self.agency):
            schedule.refresh_from_db()
        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED)

        # Renewal: an admin/billing process moves the subscription back
        # to active with a fresh period -- old usage history is untouched.
        with use_agency(self.agency):
            subscription.status = Subscription.Status.ACTIVE
            subscription.current_period_start = date(2026, 7, 1)
            subscription.current_period_end = date(2026, 7, 31)
            subscription.save()
            schedule.refresh_from_db()
            old_period.refresh_from_db()

        self.assertEqual(schedule.status, PromptSchedule.Status.PAUSED)  # still paused -- no auto-resume
        self.assertEqual(old_period.prompt_runs_used, 400)  # old period's history untouched

    def test_close_expired_billing_periods_closes_overdue_open_periods_only(self):
        subscription = _make_subscription(
            self.agency, self.plan,
            current_period_start=date(2026, 6, 1), current_period_end=date(2026, 7, 1),
        )
        with use_agency(self.agency):
            overdue_period = get_or_create_current_billing_period(subscription)
            overdue_period.prompt_runs_used = 500

            still_open_future_period = BillingPeriodUsage.objects.create(
                agency=self.agency, subscription=subscription, plan=self.plan,
                billing_interval=Subscription.BillingInterval.MONTHLY,
                period_start=date(2026, 12, 1), period_end=date(2027, 1, 1),
                base_prompt_run_allowance=600,
            )
            overdue_period.save(update_fields=["prompt_runs_used"])

        closed_count = tasks.close_expired_billing_periods()
        self.assertEqual(closed_count, 1)

        with use_agency(self.agency):
            overdue_period.refresh_from_db()
            still_open_future_period.refresh_from_db()
        self.assertIsNotNone(overdue_period.closed_at)
        self.assertEqual(overdue_period.rollover_generated, 5)  # 100 unused x 5%
        self.assertIsNone(still_open_future_period.closed_at)


class AdminPlanManagementAPITests(APITestCase):
    """Admin-only plan CRUD (AVTR_SPEC §19/§20/§21/§22): a normal agency
    user gets 403, every changed field is written to PlanConfigAuditLog,
    and editing a plan never rewrites an already-started billing
    period's snapshotted allowance."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.agency_admin = User.objects.create_user(
            email="agencyadmin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.platform_admin = User.objects.create_user(
            email="platformadmin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN,
            is_staff=True,
        )
        self.plan = _make_plan(slug="growth-admin-api", prompt_runs_included=600)
        self.api = APIClient()

    def _login(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_normal_agency_admin_cannot_list_admin_plans(self):
        self._login("agencyadmin@acme.test")
        response = self.api.get("/api/v1/admin/plans/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_normal_agency_admin_cannot_edit_a_plan(self):
        self._login("agencyadmin@acme.test")
        response = self.api.patch(
            f"/api/v1/admin/plans/{self.plan.id}/", {"prompt_runs_included": 999}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.prompt_runs_included, 600)

    def test_platform_admin_can_list_and_edit_plans(self):
        self._login("platformadmin@acme.test")
        list_response = self.api.get("/api/v1/admin/plans/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)

        update_response = self.api.patch(
            f"/api/v1/admin/plans/{self.plan.id}/", {"prompt_runs_included": 750}, format="json"
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK, update_response.data)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.prompt_runs_included, 750)

    def test_platform_admin_can_create_a_plan(self):
        self._login("platformadmin@acme.test")
        response = self.api.post(
            "/api/v1/admin/plans/",
            {
                "slug": "brand-new-plan",
                "name": "Brand New",
                "monthly_price_usd": "99.00",
                "yearly_price_usd": "950.00",
                "prompt_runs_included": 300,
                "client_limit": 5,
                "stored_prompt_limit": 1000,
                "active_schedule_limit": 20,
                "team_member_limit": 3,
                "providers": [AIProvider.OPENAI],
                "white_label_level": "Basic",
                "support_level": "Email",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(SubscriptionPlan.objects.filter(slug="brand-new-plan").exists())
        log_entry = PlanConfigAuditLog.objects.get(plan_id=response.data["id"], field_changed="__created__")
        self.assertEqual(log_entry.admin_user_id, self.platform_admin.id)

    def test_editing_a_plan_writes_an_audit_log_entry_with_old_and_new_values(self):
        self._login("platformadmin@acme.test")
        response = self.api.patch(
            f"/api/v1/admin/plans/{self.plan.id}/",
            {"prompt_runs_included": 750, "monthly_price_usd": "199.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        logs = {log.field_changed: log for log in PlanConfigAuditLog.objects.filter(plan=self.plan)}
        self.assertEqual(logs["prompt_runs_included"].old_value, "600")
        self.assertEqual(logs["prompt_runs_included"].new_value, "750")
        self.assertEqual(logs["monthly_price_usd"].old_value, "149.00")
        self.assertEqual(logs["monthly_price_usd"].new_value, "199.00")
        self.assertEqual(logs["prompt_runs_included"].admin_user_id, self.platform_admin.id)

    def test_editing_a_plan_does_not_touch_an_already_started_billing_period(self):
        # AVTR_SPEC §22: the whole point of snapshotting the allowance --
        # a later admin edit must never retroactively change a period
        # that already started under the old numbers.
        agency = Agency.objects.create(name="Snapshot Co")
        subscription = _make_subscription(
            agency, self.plan, current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31)
        )
        with use_agency(agency):
            period = get_or_create_current_billing_period(subscription)
        self.assertEqual(period.base_prompt_run_allowance, 600)

        self._login("platformadmin@acme.test")
        self.api.patch(f"/api/v1/admin/plans/{self.plan.id}/", {"prompt_runs_included": 750}, format="json")

        with use_agency(agency):
            period.refresh_from_db()
        self.assertEqual(period.base_prompt_run_allowance, 600)

    def test_unauthenticated_request_is_rejected(self):
        response = self.api.get("/api/v1/admin/plans/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class SubscriptionSchedulingCrossAgencyIsolationTests(APITestCase):
    """Extends ApiCrossAgencyIsolationTests' coverage to the new
    resources: PromptSchedule, /subscription/, /subscription/history/."""

    def setUp(self):
        cache.clear()
        self.agency_a = Agency.objects.create(name="Agency A")
        self.agency_b = Agency.objects.create(name="Agency B")
        self.password = "pw123456789"
        self.owner_a = User.objects.create_user(
            email="owner-a@sched-iso.test", password=self.password, agency=self.agency_a, role=User.Role.ADMIN
        )
        User.objects.create_user(
            email="owner-b@sched-iso.test", password=self.password, agency=self.agency_b, role=User.Role.ADMIN
        )

        self.plan = _make_plan(slug="growth-sched-iso")
        with use_agency(bypass=True):
            self.subscription_a = Subscription.objects.create(
                agency=self.agency_a, plan=self.plan, status=Subscription.Status.ACTIVE,
                current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31),
            )
            self.subscription_b = Subscription.objects.create(
                agency=self.agency_b, plan=self.plan, status=Subscription.Status.ACTIVE,
                current_period_start=date(2026, 8, 1), current_period_end=date(2026, 8, 31),
            )
            client_a = Client.objects.create(agency=self.agency_a, name="Agency A Client")
            client_b = Client.objects.create(agency=self.agency_b, name="Agency B Client")
            brand_a = Brand.objects.create(agency=self.agency_a, client=client_a, name="Brand A")
            brand_b = Brand.objects.create(agency=self.agency_b, client=client_b, name="Brand B")
            prompt_a = Prompt.objects.create(agency=self.agency_a, client=client_a, text="A prompt")
            prompt_b = Prompt.objects.create(agency=self.agency_b, client=client_b, text="B prompt")
            self.schedule_a = PromptSchedule.objects.create(
                agency=self.agency_a, client=client_a, brand=brand_a, frequency=PromptSchedule.Frequency.DAILY,
                start_date=date(2026, 8, 5), end_date=date(2026, 8, 10), status=PromptSchedule.Status.ACTIVE,
                providers=[AIProvider.OPENAI],
            )
            self.schedule_a.prompts.set([prompt_a])
            self.schedule_b = PromptSchedule.objects.create(
                agency=self.agency_b, client=client_b, brand=brand_b, frequency=PromptSchedule.Frequency.DAILY,
                start_date=date(2026, 8, 5), end_date=date(2026, 8, 10), status=PromptSchedule.Status.ACTIVE,
                providers=[AIProvider.OPENAI],
            )
            self.schedule_b.prompts.set([prompt_b])
            self.period_b = BillingPeriodUsage.objects.create(
                agency=self.agency_b, subscription=self.subscription_b, plan=self.plan,
                billing_interval=Subscription.BillingInterval.MONTHLY,
                period_start=date(2026, 8, 1), period_end=date(2026, 8, 31), base_prompt_run_allowance=600,
            )

        self.api = APIClient()

    def _login_as(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_list_only_shows_own_agencys_schedules(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.get("/api/v1/prompt-schedules/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([str(s["id"]) for s in response.data], [str(self.schedule_a.id)])

    def test_cannot_retrieve_other_agencys_schedule_by_id(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.get(f"/api/v1/prompt-schedules/{self.schedule_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_update_other_agencys_schedule(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.patch(
            f"/api/v1/prompt-schedules/{self.schedule_b.id}/", {"timezone": "America/New_York"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with use_agency(bypass=True):
            self.schedule_b.refresh_from_db()
        self.assertEqual(self.schedule_b.timezone, "UTC")

    def test_cannot_delete_other_agencys_schedule(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.delete(f"/api/v1/prompt-schedules/{self.schedule_b.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with use_agency(bypass=True):
            self.assertTrue(PromptSchedule.objects.filter(id=self.schedule_b.id).exists())

    def test_cannot_resume_other_agencys_schedule(self):
        with use_agency(bypass=True):
            PromptSchedule.objects.filter(id=self.schedule_b.id).update(status=PromptSchedule.Status.PAUSED)
        self._login_as("owner-a@sched-iso.test")
        response = self.api.post(f"/api/v1/prompt-schedules/{self.schedule_b.id}/resume/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_subscription_detail_only_ever_returns_the_callers_own(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.get("/api/v1/subscription/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], str(self.subscription_a.id))

    def test_billing_period_history_only_shows_own_agency(self):
        self._login_as("owner-a@sched-iso.test")
        response = self.api.get("/api/v1/subscription/history/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn(str(self.period_b.id), [row["id"] for row in response.data])


class ManualPaymentGateTests(APITestCase):
    """Real payment collection (Stripe) is a ~3-month-out follow-up --
    until then, signup records a chosen plan as a PENDING subscription
    and an admin activates it manually after confirming payment out of
    band (see RegisterSerializer.create, SubscriptionAdmin.
    activate_subscriptions). Login always works regardless of
    subscription status; only the metered scheduling surface
    (PromptScheduleViewSet) is gated on HasUsableSubscription -- the
    base CRM resources (clients/brands/competitors/prompts) intentionally
    stay open so a pending agency can set up its account while it waits."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        self.user = User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        self.plan = _make_plan(slug="gate-test-plan")
        self.api = APIClient()

    def _login(self):
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_login_works_with_no_subscription_at_all(self):
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_login_works_with_a_pending_subscription(self):
        _make_subscription(self.agency, self.plan, status=Subscription.Status.PENDING)
        response = self.api.post(
            "/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_prompt_schedules_blocked_with_no_subscription(self):
        self._login()
        response = self.api.get("/api/v1/prompt-schedules/")
        self.assertEqual(response.status_code, 402)
        self.assertIn("pending", response.data["detail"].lower())

    def test_prompt_schedules_blocked_with_a_pending_subscription(self):
        _make_subscription(self.agency, self.plan, status=Subscription.Status.PENDING)
        self._login()
        response = self.api.get("/api/v1/prompt-schedules/")
        self.assertEqual(response.status_code, 402)

    def test_prompt_schedules_work_once_active(self):
        _make_subscription(self.agency, self.plan, status=Subscription.Status.ACTIVE)
        self._login()
        response = self.api.get("/api/v1/prompt-schedules/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_core_crm_resources_stay_open_while_pending(self):
        # Clients/brands/competitors/prompts aren't the metered surface --
        # a pending agency can still set up its account.
        _make_subscription(self.agency, self.plan, status=Subscription.Status.PENDING)
        self._login()
        self.assertEqual(self.api.get("/api/v1/clients/").status_code, status.HTTP_200_OK)
        create_response = self.api.post(
            "/api/v1/clients/", {"name": "Pending-era client", "industry": "Retail"}, format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

    def test_core_crm_resources_stay_open_with_no_subscription(self):
        self._login()
        self.assertEqual(self.api.get("/api/v1/clients/").status_code, status.HTTP_200_OK)

    def test_plans_endpoint_is_public(self):
        # No auth at all -- a prospective signup needs to see plans
        # before they have any credentials (RegisterPage's plan picker).
        anonymous = APIClient()
        response = anonymous.get("/api/v1/plans/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(self.plan.slug, [p["slug"] for p in response.data])


class SubscriptionTestActivateEndpointTests(APITestCase):
    """POST /subscription/activate-test/ -- the local/dev-only "simulate
    payment" convenience (AVTR_SPEC follow-up: not real Stripe, gated on
    settings.DEBUG) that lets a tester self-serve past /subscribe without
    touching Django admin every time. Real activation for an actual
    customer still only ever happens through SubscriptionAdmin.
    activate_subscriptions."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        User.objects.create_user(
            email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        User.objects.create_user(
            email="member@acme.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.plan = _make_plan(slug="test-activate-plan")
        self.subscription = _make_subscription(self.agency, self.plan, status=Subscription.Status.PENDING)
        self.api = APIClient()

    def _login(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    @override_settings(DEBUG=True)
    def test_agency_admin_can_self_activate_in_debug_mode(self):
        self._login("admin@acme.test")
        response = self.api.post("/api/v1/subscription/activate-test/")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["status"], Subscription.Status.ACTIVE)

        with use_agency(self.agency):
            self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, Subscription.Status.ACTIVE)
        self.assertTrue(self.subscription.is_usable())

        # And the gate it exists to unblock actually opens up now.
        schedules_response = self.api.get("/api/v1/prompt-schedules/")
        self.assertEqual(schedules_response.status_code, status.HTTP_200_OK)

    @override_settings(DEBUG=True)
    def test_plain_member_cannot_self_activate(self):
        self._login("member@acme.test")
        response = self.api.post("/api/v1/subscription/activate-test/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        with use_agency(self.agency):
            self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, Subscription.Status.PENDING)

    @override_settings(DEBUG=True)
    def test_returns_400_when_agency_has_no_subscription(self):
        agency = Agency.objects.create(name="No Sub Co")
        User.objects.create_user(
            email="admin@nosub.test", password=self.password, agency=agency, role=User.Role.ADMIN
        )
        self._login("admin@nosub.test")
        response = self.api.post("/api/v1/subscription/activate-test/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_disabled_outside_debug_mode(self):
        # No override here -- Django's test runner already forces
        # DEBUG=False regardless of the local .env, which is exactly the
        # "real deployment" condition this endpoint must refuse under.
        self._login("admin@acme.test")
        response = self.api.post("/api/v1/subscription/activate-test/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with use_agency(self.agency):
            self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.status, Subscription.Status.PENDING)

    @override_settings(DEBUG=True)
    def test_recomputes_period_dates_fresh_from_today(self):
        self._login("admin@acme.test")
        today = timezone.now().date()
        response = self.api.post("/api/v1/subscription/activate-test/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["current_period_start"], today.isoformat())
        self.assertEqual(response.data["current_period_end"], (today + timedelta(days=30)).isoformat())


class SubscriptionChoosePlanAPITests(APITestCase):
    """POST /subscription/choose-plan/ -- the frontend-driven path for an
    agency that doesn't have a subscription at all (an old account from
    before this feature existed, or one an admin created directly via
    AgencyCreateView/Django admin rather than the normal signup flow).
    Lets the user pick their own plan instead of an operator fixing it
    by hand in a shell (see SubscriptionUsageCard's notFound branch on
    the frontend)."""

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Old Agency")
        self.password = "correct-horse-battery-staple"
        User.objects.create_user(
            email="admin@old.test", password=self.password, agency=self.agency, role=User.Role.ADMIN
        )
        User.objects.create_user(
            email="member@old.test", password=self.password, agency=self.agency, role=User.Role.MEMBER
        )
        self.plan = _make_plan(slug="choose-plan-growth")
        self.api = APIClient()

    def _login(self, email):
        response = self.api.post("/api/v1/auth/token/", {"email": email, "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_agency_admin_can_choose_a_plan_when_none_exists(self):
        self._login("admin@old.test")
        response = self.api.post(
            "/api/v1/subscription/choose-plan/",
            {"plan": self.plan.slug, "billing_interval": "yearly"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["status"], Subscription.Status.PENDING)
        self.assertEqual(response.data["billing_interval"], "yearly")
        self.assertEqual(response.data["plan"]["slug"], self.plan.slug)

        with use_agency(self.agency):
            subscription = Subscription.objects.get(agency=self.agency)
        self.assertEqual(subscription.plan_id, self.plan.id)
        self.assertFalse(subscription.is_usable())

    def test_defaults_to_monthly_billing(self):
        self._login("admin@old.test")
        response = self.api.post("/api/v1/subscription/choose-plan/", {"plan": self.plan.slug}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["billing_interval"], "monthly")

    def test_rejects_when_agency_already_has_a_subscription(self):
        _make_subscription(self.agency, self.plan, status=Subscription.Status.ACTIVE)
        self._login("admin@old.test")
        response = self.api.post(
            "/api/v1/subscription/choose-plan/", {"plan": self.plan.slug}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_plain_member_cannot_choose_a_plan(self):
        self._login("member@old.test")
        response = self.api.post(
            "/api/v1/subscription/choose-plan/", {"plan": self.plan.slug}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        with use_agency(self.agency):
            self.assertFalse(Subscription.objects.filter(agency=self.agency).exists())

    def test_rejects_unknown_plan_slug(self):
        self._login("admin@old.test")
        response = self.api.post(
            "/api/v1/subscription/choose-plan/", {"plan": "not-a-real-plan"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("plan", response.data)

    def test_unauthenticated_request_is_rejected(self):
        response = self.api.post(
            "/api/v1/subscription/choose-plan/", {"plan": self.plan.slug}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class RegistrationCreatesPendingSubscriptionAPITests(APITestCase):
    """End-to-end: POST /auth/register/ -> Subscription(status=PENDING)
    with the chosen plan, admin activates it via Django admin, and only
    then does the metered surface unlock. Covers the manual-payment
    signup-to-activation lifecycle as a single flow, complementing the
    narrower RegisterFlowTests/ManualPaymentGateTests assertions."""

    def setUp(self):
        cache.clear()
        self.plan = _make_plan(slug="lifecycle-plan")
        self.superuser = User.objects.create_superuser(email="platform@avtr.test", password="pw123456789")

    def test_signup_to_manual_activation_lifecycle(self):
        register_response = self.client.post(
            "/api/v1/auth/register/",
            {
                "agency_name": "Lifecycle Agency",
                "email": "owner@lifecycle.test",
                "password": "correct-horse-battery-staple",
                "plan": self.plan.slug,
            },
            format="json",
        )
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email="owner@lifecycle.test")
        user.is_active = True  # normally flipped by the emailed verify-email link
        user.save(update_fields=["is_active"])

        api = APIClient()
        token_response = api.post(
            "/api/v1/auth/token/",
            {"email": "owner@lifecycle.test", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(token_response.status_code, status.HTTP_200_OK)
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")

        blocked = api.get("/api/v1/prompt-schedules/")
        self.assertEqual(blocked.status_code, 402)

        with use_agency(bypass=True):
            subscription = Subscription.objects.get(agency=user.agency)
        self.assertEqual(subscription.status, Subscription.Status.PENDING)

        # Admin confirms payment out of band and activates via the
        # Django admin action -- the real (only, for now) activation path.
        self.client.force_login(self.superuser)
        activate_response = self.client.post(
            "/admin/core/subscription/",
            {"action": "activate_subscriptions", "_selected_action": [str(subscription.pk)]},
        )
        self.assertIn(activate_response.status_code, (200, 302))

        with use_agency(bypass=True):
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, Subscription.Status.ACTIVE)
        self.assertTrue(subscription.is_usable())

        unblocked = api.get("/api/v1/prompt-schedules/")
        self.assertEqual(unblocked.status_code, status.HTTP_200_OK)


class TestimonialListAPITests(APITestCase):
    """GET /testimonials/ -- public marketing content for the homepage
    testimonial wall. Only quotes staff have published may leave the server."""

    def setUp(self):
        cache.clear()
        self.api = APIClient()

    def test_anonymous_visitor_can_list_testimonials(self):
        Testimonial.objects.create(name="Sara Khan", company="Northlane", quote="Real quote.", is_published=True)
        response = self.api.get("/api/v1/testimonials/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([t["name"] for t in response.data], ["Sara Khan"])

    def test_unpublished_testimonials_are_never_returned(self):
        Testimonial.objects.create(name="Draft Person", quote="Not approved yet.", is_published=False)
        response = self.api.get("/api/v1/testimonials/")
        self.assertEqual(response.data, [])

    def test_ordered_by_sort_order(self):
        Testimonial.objects.create(name="Second", quote="b", is_published=True, sort_order=2)
        Testimonial.objects.create(name="First", quote="a", is_published=True, sort_order=1)
        response = self.api.get("/api/v1/testimonials/")
        self.assertEqual([t["name"] for t in response.data], ["First", "Second"])

    def test_response_exposes_only_public_fields(self):
        Testimonial.objects.create(name="Sara Khan", quote="Real quote.", is_published=True)
        response = self.api.get("/api/v1/testimonials/")
        self.assertEqual(
            set(response.data[0]), {"id", "name", "role", "company", "quote", "country_code", "avatar_url"}
        )


class StripeWebhookSecurityTests(APITestCase):
    """POST /billing/webhook/ is public, so every event must be signed by
    Stripe -- an unsigned or forged event must never change a subscription."""

    def setUp(self):
        self.api = APIClient()
        self.forged = {"type": "checkout.session.completed", "data": {"object": {"metadata": {}}}}

    def test_unsigned_event_is_rejected_when_webhooks_are_not_configured(self):
        response = self.api.post("/api/v1/billing/webhook/", self.forged, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_test")
    @patch("core.stripe_service.is_stripe_configured", return_value=True)
    @patch("core.stripe_service.fulfill_checkout_session")
    def test_event_without_signature_header_is_rejected(self, fulfill, _configured):
        response = self.api.post("/api/v1/billing/webhook/", self.forged, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fulfill.assert_not_called()

    @override_settings(STRIPE_WEBHOOK_SECRET="whsec_test")
    @patch("core.stripe_service.is_stripe_configured", return_value=True)
    @patch("core.stripe_service.fulfill_checkout_session")
    def test_event_with_bad_signature_is_rejected(self, fulfill, _configured):
        response = self.api.post(
            "/api/v1/billing/webhook/", self.forged, format="json", HTTP_STRIPE_SIGNATURE="t=1,v1=forged"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fulfill.assert_not_called()


class AgencyBrandingValidationTests(APITestCase):
    """PATCH /agencies/me/ -- white-label values end up in CSS, <img> tags
    and the PDF renderer, so only safe shapes are accepted."""

    PNG = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    def setUp(self):
        cache.clear()
        self.agency = Agency.objects.create(name="Acme")
        self.password = "correct-horse-battery-staple"
        User.objects.create_user(email="admin@acme.test", password=self.password, agency=self.agency, role=User.Role.ADMIN)
        self.api = APIClient()
        token = self.api.post("/api/v1/auth/token/", {"email": "admin@acme.test", "password": self.password}, format="json")
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")

    def patch(self, body):
        return self.api.patch("/api/v1/agencies/me/", body, format="json")

    def test_uploaded_png_logo_is_accepted(self):
        response = self.patch({"logo_url": self.PNG})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["logo_url"], self.PNG)

    def test_unsafe_logo_values_are_rejected(self):
        for value in ["javascript:alert(1)", "http://example.com/logo.png", "data:image/svg+xml;base64,PHN2Zz4="]:
            self.assertEqual(self.patch({"logo_url": value}).status_code, status.HTTP_400_BAD_REQUEST, value)

    def test_brand_colours_must_be_hex(self):
        bad = self.patch({"white_label_config": {"primary_color": "red;}body{display:none"}})
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        ok = self.patch({"white_label_config": {"primary_color": "#6d28d9", "company_name": "Acme Growth"}})
        self.assertEqual(ok.status_code, status.HTTP_200_OK, ok.data)

    def test_pdf_logo_loader_never_fetches_private_addresses(self):
        from .branding import load_logo_bytes

        self.assertIsNone(load_logo_bytes("https://127.0.0.1/logo.png"))
        self.assertIsNone(load_logo_bytes("http://example.com/logo.png"))
        self.assertTrue(load_logo_bytes(self.PNG).startswith(b"\x89PNG"))

