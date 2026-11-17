import csv
import io
import logging
import math
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.mail import send_mail
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, NotFound, ValidationError
from rest_framework.generics import (
    CreateAPIView,
    ListAPIView,
    RetrieveAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .ai_providers import default_manual_provider, get_provider_client
from .billing import (
    activate_subscription,
    active_schedule_commitments,
    create_pending_subscription,
    estimate_usage,
    get_or_create_current_billing_period,
    today_reserved_prompt_runs,
)
from .matching import find_name_mentions
from .models import (
    TRACKED_PLAN_FIELDS,
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
from .pdf_invoice import generate_invoice_pdf
from .pdf_report import generate_client_pdf_report
from .permissions import IsAgencyAdmin, IsAgencyMember, WritesNeedUsableSubscription
from .serializers import (
    AcceptInviteSerializer,
    AgencyCreateSerializer,
    AgencySerializer,
    BillingPeriodUsageSerializer,
    BrandSerializer,
    ChangePasswordSerializer,
    ChoosePlanSerializer,
    CitationSerializer,
    ClientSerializer,
    CompetitorSerializer,
    CustomTokenObtainPairSerializer,
    CustomTokenRefreshSerializer,
    InviteTeamMemberSerializer,
    MentionSerializer,
    NotificationSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PromptRunSerializer,
    PromptScheduleSerializer,
    PromptSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    ScheduleEstimateRequestSerializer,
    SubscriptionPlanAdminSerializer,
    SubscriptionPlanSerializer,
    SubscriptionSerializer,
    TeamMemberSerializer,
    TestimonialSerializer,
    TestPaymentSerializer,
    UserSerializer,
    VerifyEmailSerializer,
    serialize_usage_estimate,
)
from .tasks import _process_schedule_tick, execute_prompt_run
from .visibility_score import visibility_score_evidence, visibility_score_history

MAX_TEAM_MEMBERS = 2  # admin + 1 invited teammate, per agency
MAX_LOGIN_ATTEMPTS = 3  # wrong passwords in a row before an account is locked out
LOGIN_LOCKOUT_SECONDS = 10 * 60  # how long that lockout lasts

logger = logging.getLogger(__name__)


def _login_attempts_cache_key(email):
    return f"login_attempts:{(email or '').strip().lower()}"


def _login_lockout_cache_key(email):
    return f"login_lockout:{(email or '').strip().lower()}"


def _send_verification_email(user):
    """Best-effort: an email provider outage/rejection shouldn't turn into
    a 500 on registration -- the account is already created either way,
    and the user can always retry via ResendVerificationView once the
    provider issue clears."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    verify_url = f"{settings.FRONTEND_URL}/verify-email?uid={uid}&token={token}"
    try:
        send_mail(
            subject="Verify your RankLens account",
            message=f"Confirm your email to activate your RankLens account:\n\n{verify_url}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception:
        logger.exception("Failed to send verification email to %s", user.email)


def _send_invite_email(inviter, user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    invite_url = f"{settings.FRONTEND_URL}/accept-invite?uid={uid}&token={token}"
    try:
        send_mail(
            subject=f"You've been invited to join {inviter.agency.name} on RankLens",
            message=(
                f"{inviter.email} invited you to join {inviter.agency.name} on RankLens as "
                f"{user.get_role_display()}.\n\nAccept your invite and set a password:\n\n{invite_url}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception:
        logger.exception("Failed to send invite email to %s", user.email)




class CustomTokenObtainPairView(TokenObtainPairView):
    """Login. Throttled two ways: a per-IP rate limit (below) catches a
    credential-stuffing burst, and a per-account failed-attempt counter
    locks that specific account out for LOGIN_LOCKOUT_SECONDS after
    MAX_LOGIN_ATTEMPTS wrong passwords in a row -- slows down a targeted
    guessing attack against one account even if the attacker spreads
    requests across IPs to dodge the per-IP limit.

    Every failure path (wrong password, unknown email, unverified account)
    returns the same generic "Invalid email or password." -- a failed
    login never reveals which of those it actually was.
    """

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        email = request.data.get("email", "")
        attempts_key = _login_attempts_cache_key(email)
        lockout_key = _login_lockout_cache_key(email)

        unlock_at = cache.get(lockout_key)
        if unlock_at:
            remaining_minutes = max(1, math.ceil((unlock_at - timezone.now()).total_seconds() / 60))
            return Response(
                {
                    "detail": (
                        f"Too many failed login attempts. Try again in {remaining_minutes} "
                        f"minute{'s' if remaining_minutes != 1 else ''}."
                    )
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        try:
            response = super().post(request, *args, **kwargs)
        except AuthenticationFailed:
            # simplejwt's own "wrong credentials" exception -- it isn't a
            # TokenError, so TokenObtainPairView.post() doesn't catch it
            # itself; it propagates straight out of the super() call above.
            response = Response(status=status.HTTP_401_UNAUTHORIZED)

        if response.status_code == status.HTTP_200_OK:
            cache.delete(attempts_key)
            return response

        if response.status_code != status.HTTP_401_UNAUTHORIZED:
            return response

        attempts = cache.get(attempts_key, 0) + 1
        if attempts >= MAX_LOGIN_ATTEMPTS:
            cache.set(lockout_key, timezone.now() + timedelta(seconds=LOGIN_LOCKOUT_SECONDS), LOGIN_LOCKOUT_SECONDS)
            cache.delete(attempts_key)
            response.status_code = status.HTTP_429_TOO_MANY_REQUESTS
            response.data = {
                "detail": (
                    "Too many failed login attempts. This account is locked for "
                    f"{LOGIN_LOCKOUT_SECONDS // 60} minutes."
                )
            }
        else:
            cache.set(attempts_key, attempts, LOGIN_LOCKOUT_SECONDS)
            remaining = MAX_LOGIN_ATTEMPTS - attempts
            response.data = {
                "detail": "Invalid email or password.",
                "warning": (
                    f"{remaining} attempt{'s' if remaining != 1 else ''} remaining before this "
                    "account is temporarily locked."
                ),
            }
        return response


class CustomTokenRefreshView(TokenRefreshView):
    """Refresh. Rejects tokens from a session older than 24 hours -- see
    CustomTokenRefreshSerializer for how that's enforced even though
    refresh tokens rotate on every use."""

    serializer_class = CustomTokenRefreshSerializer


class RegisterView(CreateAPIView):
    """Public signup: creates a new agency and its first (admin) user,
    inactive, and emails a verification link -- no tokens are issued
    here, since the account can't authenticate until verified (see
    VerifyEmailView).

    Note: this is fully open, unauthenticated self-service signup --
    the original proposal listed "self-service public onboarding" as a
    later-phase feature, deferred in favor of an invite-only flow for
    Week 2. Flagging here since this endpoint effectively provides that
    already; worth confirming whether it should stay open or get gated
    behind an invite code before any public launch.
    """

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        _send_verification_email(user)
        return Response(
            {"detail": "Account created. Check your email to verify your account before logging in."},
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    """Completes signup: activates the account given the uid/token from
    the emailed verification link, then logs the user in immediately
    (returns tokens) so they land straight in the app."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_verification"

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            uid = force_str(urlsafe_base64_decode(data["uid"]))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response({"detail": "Invalid verification link."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, data["token"]):
            return Response({"detail": "Invalid or expired verification link."}, status=status.HTTP_400_BAD_REQUEST)

        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])

        token = CustomTokenObtainPairSerializer.get_token(user)
        return Response({"access": str(token.access_token), "refresh": str(token)})


class ResendVerificationView(APIView):
    """Re-sends the verification email. Always responds 200 regardless of
    whether the email exists or is already verified, to avoid leaking
    account state (same reasoning as PasswordResetRequestView)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_verification"

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        user = User.objects.filter(email__iexact=email, is_active=False).first()
        if user is not None:
            _send_verification_email(user)

        return Response({"detail": "If that account needs verifying, a new link has been sent."})


class PasswordResetRequestView(APIView):
    """Starts a password reset: if the email matches an account, emails a
    reset link. Always responds 200 regardless of whether the email
    exists or the send succeeds, to avoid leaking which addresses have
    accounts and to avoid a flaky email provider turning into a 500."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            try:
                send_mail(
                    subject="Reset your RankLens password",
                    message=f"Use this link to reset your password:\n\n{reset_url}",
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                )
            except Exception:
                logger.exception("Failed to send password reset email to %s", user.email)

        return Response({"detail": "If an account exists for that email, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    """Completes a password reset given the uid/token from the emailed
    link. The token is self-invalidating once used or once the password
    changes (django's default_token_generator ties it to the current
    password hash)."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            uid = force_str(urlsafe_base64_decode(data["uid"]))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response({"detail": "Invalid reset link."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, data["token"]):
            return Response({"detail": "Invalid or expired reset link."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Password has been reset."})


class MeView(RetrieveAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """Authenticated "change my password" -- distinct from the emailed
    forgot/reset-password flow, which is for a user who's locked out."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "change_password"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if not request.user.check_password(data["old_password"]):
            return Response(
                {"old_password": ["Current password is incorrect."]}, status=status.HTTP_400_BAD_REQUEST
            )

        request.user.set_password(data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Password updated."})


class AgencyCreateView(CreateAPIView):
    """Lets an authenticated user with no agency create one and become its
    admin. Most users already get an agency at registration (see
    RegisterSerializer) -- this covers the narrower case of an
    authenticated, agency-less account (e.g. a platform superuser)
    wanting to spin one up directly."""

    serializer_class = AgencyCreateSerializer
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        if request.user.agency_id is not None:
            return Response({"detail": "You already belong to an agency."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        agency = serializer.save()

        request.user.agency = agency
        request.user.role = User.Role.ADMIN
        request.user.save(update_fields=["agency", "role"])

        return Response(AgencySerializer(agency).data, status=status.HTTP_201_CREATED)


class AgencyDetailView(APIView):
    """View/update the caller's own agency -- no id in the URL, since a
    member only ever has the one agency (same shape as /auth/me/). Any
    member can view; only an admin can edit."""

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAgencyMember()]
        return [IsAgencyAdmin()]

    def get(self, request):
        return Response(AgencySerializer(request.user.agency).data)

    def patch(self, request):
        serializer = AgencySerializer(request.user.agency, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TeamMemberListView(ListAPIView):
    """Any agency member can see their teammates; only an admin can change
    them (see TeamMemberDetailView)."""

    serializer_class = TeamMemberSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        return User.objects.for_user(self.request.user).order_by("email")


class TeamMemberDetailView(RetrieveUpdateDestroyAPIView):
    serializer_class = TeamMemberSerializer
    permission_classes = [IsAgencyAdmin]

    def get_queryset(self):
        # Scoping through for_user() (not a raw agency filter) is what
        # makes a cross-agency id 404 instead of leaking a 403 that'd
        # confirm the id exists -- same isolation guarantee the other
        # tenant-scoped views get from AgencyAutoScopedManager, applied
        # here by hand since User doesn't use that manager.
        return User.objects.for_user(self.request.user)

    # No separate "can't remove the last admin" check needed: only an admin
    # can reach these two methods at all (permission_classes above), and
    # both block acting on yourself -- so the acting admin is always left
    # standing afterward. An agency can shrink to one admin here, never to
    # zero.
    def update(self, request, *args, **kwargs):
        target = self.get_object()
        if target.pk == request.user.pk:
            return Response(
                {"detail": "You cannot change your own membership here."}, status=status.HTTP_400_BAD_REQUEST
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        target = self.get_object()
        if target.pk == request.user.pk:
            return Response({"detail": "You cannot remove yourself here."}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class InviteTeamMemberView(APIView):
    """Admins add a teammate by email invite, not by setting a password for
    them directly -- the invitee sets their own via AcceptInviteView, same
    self-custody principle as registration. Capped at MAX_TEAM_MEMBERS
    total accounts per agency (including pending, not-yet-accepted
    invites, so the cap can't be bypassed by inviting repeatedly)."""

    permission_classes = [IsAgencyAdmin]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "team_invite"

    def post(self, request):
        current_count = User.objects.filter(agency=request.user.agency).count()
        if current_count >= MAX_TEAM_MEMBERS:
            return Response(
                {"detail": f"Your agency already has the maximum of {MAX_TEAM_MEMBERS} team members."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = InviteTeamMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.create_user(
            email=data["email"],
            password=None,  # set_password(None) -> set_unusable_password(): can't log in until accept-invite sets a real one
            agency=request.user.agency,
            role=data["role"],
            is_active=False,
        )
        _send_invite_email(request.user, user)

        return Response(TeamMemberSerializer(user).data, status=status.HTTP_201_CREATED)


class AcceptInviteView(APIView):
    """Completes an invite: sets the invitee's password given the uid/token
    from the emailed link, activates the account, and logs them in."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_verification"

    def post(self, request):
        serializer = AcceptInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            uid = force_str(urlsafe_base64_decode(data["uid"]))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response({"detail": "Invalid invite link."}, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, data["token"]):
            return Response({"detail": "Invalid or expired invite link."}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(data["password"])
        user.is_active = True
        user.save(update_fields=["password", "is_active"])

        token = CustomTokenObtainPairSerializer.get_token(user)
        return Response({"access": str(token.access_token), "refresh": str(token)})


class AgencyScopedModelViewSet(viewsets.ModelViewSet):
    """Base for tenant-scoped CRUD: the queryset relies entirely on
    AgencyAutoScopedManager (no explicit `.for_user()` here on purpose --
    that's the automatic safeguard being exercised for real) and every
    created row is force-assigned to the requester's own agency,
    regardless of anything a client tries to pass in the request body.

    Deliberately uses `get_queryset()` as a method, not a `queryset = ...`
    class attribute -- the latter is evaluated once at import time
    (before any request, and thus before any ambient agency context
    exists), and a plain `.all()` on that cached QuerySet later would
    just clone its already-unfiltered state rather than re-asking the
    manager. A method re-invokes AgencyAutoScopedManager fresh on every
    request, which is what makes the automatic scoping actually work.

    Writes need a usable subscription; reads don't, so a lapsed agency
    keeps seeing its data (WritesNeedUsableSubscription)."""

    permission_classes = [WritesNeedUsableSubscription]
    model = None

    def get_queryset(self):
        return self.model.objects.all()

    def perform_create(self, serializer):
        serializer.save(agency=self.request.user.agency)


class ClientViewSet(AgencyScopedModelViewSet):
    serializer_class = ClientSerializer
    model = Client

    def get_queryset(self):
        return self.model.objects.prefetch_related("brand", "competitors")

    def perform_create(self, serializer):
        agency = self.request.user.agency
        if agency:
            sub = getattr(agency, "subscription", None)
            if sub and sub.plan:
                current_count = Client.objects.filter(agency=agency).count()
                if current_count >= sub.plan.client_limit:
                    raise ValidationError(
                        {"detail": f"Client workspace limit reached ({current_count}/{sub.plan.client_limit} for {sub.plan.name} plan). Please upgrade your subscription to add more clients."}
                    )
        serializer.save(agency=agency)

    @action(detail=True, methods=["get"], url_path="pdf-report")
    def pdf_report(self, request, pk=None):
        client = self.get_object()
        try:
            since = _parse_period_bound(request.query_params.get("since"), end_of_day=False)
            until = _parse_period_bound(request.query_params.get("until"), end_of_day=True)
        except ValueError as exc:
            return Response(
                {"detail": f"'{exc.args[0]}' isn't a valid ISO 8601 date or datetime."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pdf_bytes = generate_client_pdf_report(client, since=since, until=until)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        clean_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in client.name.lower())
        response["Content-Disposition"] = f'attachment; filename="{clean_name}-visibility-report.pdf"'
        return response


MAX_MATCH_TEST_TEXT_LENGTH = 10_000


class NameMatchTestMixin:
    """Adds a `test-match` action to a viewset whose model has `name` and
    `aliases` fields -- runs the same exact-name/alias matching the AI
    response analysis pipeline will use later, against caller-supplied
    text, so a user can sanity-check their aliases before relying on them.
    Shared by Brand and Competitor: the matching logic doesn't care which
    kind of tracked name it's checking."""

    @action(detail=True, methods=["post"], url_path="test-match")
    def test_match(self, request, pk=None):
        instance = self.get_object()
        text = request.data.get("text", "")

        if not isinstance(text, str) or not text.strip():
            return Response({"text": "This field is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(text) > MAX_MATCH_TEST_TEXT_LENGTH:
            return Response(
                {"text": f"Must be at most {MAX_MATCH_TEST_TEXT_LENGTH} characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        matches = find_name_mentions(text, instance.name, instance.aliases)
        return Response(
            {
                "matched": bool(matches),
                "matches": [
                    {"term": m.term, "is_primary": m.is_primary, "start": m.start, "end": m.end} for m in matches
                ],
            }
        )


def _parse_period_bound(raw: str | None, *, end_of_day: bool):
    """Parses a `since`/`until` query param (an ISO 8601 date or
    datetime string) into an aware datetime, or returns None if `raw`
    is empty. A bare date (no time component) is anchored to the start
    of that day for `since` and the end of that day for `until`, so
    "?since=2026-09-01&until=2026-09-13" covers all of both endpoint
    days rather than only their midnights. Raises ValueError on
    anything that parses as neither a date nor a datetime."""
    if not raw:
        return None
    parsed = parse_datetime(raw)
    if parsed is None:
        parsed_date = parse_date(raw)
        if parsed_date is None:
            raise ValueError(raw)
        parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


class VisibilityScoreMixin:
    """Adds a `visibility-score` action to a viewset whose model is a
    Brand or Competitor -- the RankLens Visibility Score (core.
    visibility_score) plus its complete supporting evidence trail:
    every completed PromptRun considered, its full response, and every
    mention found in it with the position/sentiment/citation detail
    that fed the score. Nothing here is a black-box number. Optional
    `?since=`/`?until=` query params (ISO 8601 date or datetime) scope
    it to a period; omitted, the score covers all-time."""

    @action(detail=True, methods=["get"], url_path="visibility-score")
    def visibility_score(self, request, pk=None):
        instance = self.get_object()
        try:
            since = _parse_period_bound(request.query_params.get("since"), end_of_day=False)
            until = _parse_period_bound(request.query_params.get("until"), end_of_day=True)
        except ValueError as exc:
            return Response(
                {"detail": f"'{exc.args[0]}' isn't a valid ISO 8601 date or datetime."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(visibility_score_evidence(instance, since=since, until=until))

    @action(detail=True, methods=["get"], url_path="visibility-history")
    def visibility_history(self, request, pk=None):
        """The same score over time (core.visibility_score.
        visibility_score_history), same `?since=`/`?until=` params."""
        instance = self.get_object()
        try:
            since = _parse_period_bound(request.query_params.get("since"), end_of_day=False)
            until = _parse_period_bound(request.query_params.get("until"), end_of_day=True)
        except ValueError as exc:
            return Response(
                {"detail": f"'{exc.args[0]}' isn't a valid ISO 8601 date or datetime."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(visibility_score_history(instance, since=since, until=until))


class BrandViewSet(NameMatchTestMixin, VisibilityScoreMixin, AgencyScopedModelViewSet):
    serializer_class = BrandSerializer
    model = Brand

    def get_queryset(self):
        return self.model.objects.select_related("client")


class CompetitorViewSet(NameMatchTestMixin, VisibilityScoreMixin, AgencyScopedModelViewSet):
    serializer_class = CompetitorSerializer
    model = Competitor

    def get_queryset(self):
        return self.model.objects.select_related("client")


MAX_BULK_IMPORT_FILE_SIZE = 1024 * 1024  # 1 MB
MAX_BULK_IMPORT_ROWS = 500
FALSE_STRINGS = {"false", "0", "no", "inactive", "n"}
MAX_BULK_RUN_PROMPTS = 50  # each one runs synchronously in-request -- see PromptViewSet.run_bulk


def _split_tags(value):
    """service_tags/location_tags cells use ';' (not ',') as the
    in-cell separator -- ',' is already the CSV column delimiter, and
    requiring quoting for every multi-tag cell would make the template
    error-prone to hand-edit in a plain text editor."""
    if not value:
        return []
    return [item.strip() for item in value.split(";") if item.strip()]


def _parse_bool(value, default=True):
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in FALSE_STRINGS


def _split_comma_list(value):
    """For default_location_tags -- a plain form field, not a CSV cell,
    so there's no column-delimiter clash and ',' (the convention every
    other tag input in this app already uses, see prompts-dialog.tsx's
    toList()) reads naturally."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


class PromptViewSet(AgencyScopedModelViewSet):
    serializer_class = PromptSerializer
    model = Prompt

    def get_queryset(self):
        from django.db.models import Prefetch
        return self.model.objects.select_related("client").prefetch_related(
            Prefetch(
                "schedules",
                queryset=PromptSchedule.objects.filter(status=PromptSchedule.Status.ACTIVE),
                to_attr="active_schedules",
            )
        )

    def _locking_schedule(self, prompt):
        """The ACTIVE PromptSchedule (if any) currently holding `prompt`
        locked against edits/deletes. A schedule auto-completes
        (PromptSchedule.Status.COMPLETED, see _complete_if_last_execution
        in core/tasks.py) once its last execution date passes, so ACTIVE
        here already means "still within its run window" -- exactly the
        "until the schedule's deadline is reached" rule this is meant to
        enforce, without needing a separate date comparison."""
        return prompt.schedules.filter(status=PromptSchedule.Status.ACTIVE).first()

    def perform_update(self, serializer):
        locking_schedule = self._locking_schedule(serializer.instance)
        if locking_schedule is not None:
            raise ValidationError(
                {
                    "detail": (
                        "This prompt is part of an active schedule (running through "
                        f"{locking_schedule.end_date}) and can't be edited until it finishes."
                    )
                }
            )
        serializer.save()

    def perform_destroy(self, instance):
        locking_schedule = self._locking_schedule(instance)
        if locking_schedule is not None:
            raise ValidationError(
                {
                    "detail": (
                        "This prompt is part of an active schedule (running through "
                        f"{locking_schedule.end_date}) and can't be deleted until it finishes."
                    )
                }
            )
        instance.delete()

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request):
        """CSV bulk-import: one prompt per data row, columns `text`
        (required), `category`, `service_tags`, `location_tags`,
        `schedule`, `is_active`. Every row is validated independently
        through the same PromptSerializer normal create() uses, so a
        handful of bad rows don't block the rest of an otherwise-good
        file -- the response reports what was created and what wasn't,
        per row, rather than all-or-nothing.

        `default_category`/`default_location_tags` are optional form
        fields (not CSV columns) -- most prompts for one client share
        the same category/location, so filling those in once here beats
        repeating them on every row. A row's own `category`/
        `location_tags` cell, when present, still overrides the
        default -- this only fills in what a row left blank."""
        client_id = request.data.get("client")
        if not client_id:
            return Response({"client": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)

        client = Client.objects.for_user(request.user).filter(pk=client_id).first()
        if client is None:
            return Response({"client": ["Invalid client."]}, status=status.HTTP_400_BAD_REQUEST)

        default_category = (request.data.get("default_category") or "").strip()
        default_location_tags = _split_comma_list(request.data.get("default_location_tags"))

        upload = request.FILES.get("file")
        if upload is None:
            return Response({"file": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_BULK_IMPORT_FILE_SIZE:
            return Response(
                {"file": [f"Must be at most {MAX_BULK_IMPORT_FILE_SIZE // 1024} KB."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            decoded = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"file": ["Must be a UTF-8 encoded CSV file."]}, status=status.HTTP_400_BAD_REQUEST)

        reader = csv.DictReader(io.StringIO(decoded))
        fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]
        reader.fieldnames = fieldnames
        if "text" not in fieldnames:
            return Response({"file": ["CSV must include a 'text' column."]}, status=status.HTTP_400_BAD_REQUEST)

        rows = list(reader)
        if not rows:
            return Response({"file": ["CSV file has no data rows."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > MAX_BULK_IMPORT_ROWS:
            return Response(
                {"file": [f"Must be at most {MAX_BULK_IMPORT_ROWS} rows."]}, status=status.HTTP_400_BAD_REQUEST
            )

        created = []
        errors = []
        for index, row in enumerate(rows, start=2):  # row 1 is the header
            payload = {
                "client": str(client.id),
                "text": (row.get("text") or "").strip(),
                "category": (row.get("category") or "").strip() or default_category,
                "service_tags": _split_tags(row.get("service_tags")),
                "location_tags": _split_tags(row.get("location_tags")) or default_location_tags,
                "schedule": (row.get("schedule") or "").strip().lower() or Prompt.Schedule.MANUAL,
                "is_active": _parse_bool(row.get("is_active")),
            }
            serializer = PromptSerializer(data=payload, context={"request": request})
            if serializer.is_valid():
                serializer.save(agency=request.user.agency)
                created.append(serializer.data)
            else:
                errors.append({"row": index, "errors": serializer.errors})

        return Response(
            {"created": len(created), "prompts": created, "errors": errors},
            status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST,
        )

    def _check_run_budget(self, agency, needed):
        """Shared by run() and run_bulk(): the same "usable subscription,
        enough Prompt Runs left" gate scheduled dispatch enforces (see
        _process_schedule_tick), checked for `needed` runs at once so a
        bulk request is all-or-nothing -- never runs the first few
        prompts in a batch and then fails partway through.

        Also reserves today's still-pending obligation from every ACTIVE
        schedule (today_reserved_prompt_runs) out of what's available,
        so a manual/bulk run can't spend credits a schedule already due
        today is counting on -- only today's reservation, never the
        schedule's whole remaining lifetime, since tomorrow's occurrence
        reserves itself tomorrow. Without this, a same-day manual run
        could exhaust the period's remaining Prompt Runs first, and the
        schedule would silently pause itself (PAUSED_LIMIT_REACHED) once
        its own tick ran later.

        Returns (billing_period, None) if the run(s) may proceed, or
        (None, error_response) to return immediately -- never both, so
        the caller can just `if error: return error`."""
        subscription = getattr(agency, "subscription", None)
        if subscription is None or not subscription.is_usable():
            return None, Response(
                {"detail": "Your agency's subscription is pending activation."},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        billing_period = get_or_create_current_billing_period(subscription)
        reserved = today_reserved_prompt_runs(agency)
        available = max(0, billing_period.prompt_runs_remaining - reserved)
        if available < needed:
            if reserved > 0:
                detail = (
                    f"Your active schedules need {reserved} Prompt Run(s) today, leaving {available} "
                    "available -- not enough for this run."
                    if needed == 1
                    else (
                        f"This would use {needed} Prompt Runs, but your active schedules need {reserved} "
                        f"today, leaving only {available} available."
                    )
                )
            else:
                detail = (
                    "You've used all of your plan's included Prompt Runs for this billing period."
                    if needed == 1
                    else (
                        f"This would use {needed} Prompt Runs, but only {available} remain this billing period."
                    )
                )
            return None, Response(
                {
                    "detail": detail,
                    "needed": needed,
                    "remaining": available,
                    "reserved_for_schedules": reserved,
                },
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        return billing_period, None

    @action(detail=True, methods=["post"], url_path="run")
    def run(self, request, pk=None):
        """Manual "run now" trigger -- creates a PromptRun and hands it to
        Celery via `.delay()` for real, asynchronous execution: blocked the
        same way scheduled runs are (no usable subscription, or no Prompt
        Runs left this billing period), and counted against usage the
        moment it's queued, same as before.

        Takes an optional `provider` (one of AIProvider's values) so the
        frontend's provider picker controls which one actually runs,
        instead of always silently going with default_manual_provider()'s
        best guess. When `provider` is given explicitly, it's checked
        against the agency's plan *and* whether that provider actually has
        an API key configured before queuing -- so a choice the user
        actually made fails immediately with a clear message instead of
        queuing a PromptRun that's only discovered to be dead on arrival
        once Celery picks it up. Omitting `provider` keeps the old
        best-effort fallback behavior as-is (queues against whatever
        default_manual_provider() picks, even if that turns out to be
        unconfigured) for any caller that doesn't send one.

        Returns the PromptRun right away in "queued" status -- it's a
        real background job now, not a synchronous mock, so the caller
        (the frontend) polls /prompt-runs/ to watch it progress through
        running -> completed/failed rather than getting the final answer
        back in this response."""
        prompt = self.get_object()
        agency = request.user.agency
        subscription = getattr(agency, "subscription", None)
        plan_providers = list(subscription.plan.providers or []) if subscription else [AIProvider.GEMINI]

        explicit_provider = request.data.get("provider")
        provider = explicit_provider or default_manual_provider()
        if explicit_provider:
            if provider not in AIProvider.values:
                return Response(
                    {"provider": [f"Unknown AI provider: {provider!r}."]}, status=status.HTTP_400_BAD_REQUEST
                )
            if provider not in set(plan_providers):
                return Response(
                    {"provider": [f"Your plan does not include {provider}."]}, status=status.HTTP_400_BAD_REQUEST
                )
            if not get_provider_client(provider).is_configured():
                return Response(
                    {"provider": [f"{provider} isn't configured yet -- add its API key to the environment."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        _billing_period, blocked = self._check_run_budget(agency, 1)
        if blocked is not None:
            return blocked

        run = PromptRun.objects.create(
            agency=agency,
            prompt=prompt,
            prompt_text=prompt.text,
            provider=provider,
            status=PromptRun.Status.QUEUED,
        )
        # One charge per run (track_prompt_run_usage records it); a run that
        # later fails is refunded by execute_prompt_run.
        track_prompt_run_usage(agency, provider, prompt_id=str(prompt.id), run_id=str(run.id), count=1)
        if settings.DEBUG or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
            execute_prompt_run.apply(args=[str(run.id)])
        else:
            try:
                execute_prompt_run.delay(str(run.id))
            except Exception:
                execute_prompt_run.apply(args=[str(run.id)])
        run.refresh_from_db()
        return Response(PromptRunSerializer(run).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="run-bulk")
    def run_bulk(self, request):
        """Run several prompts in one request -- e.g. "run all of this
        client's prompts" -- instead of one call per prompt. Same
        billing as run(): exactly one Prompt Run per prompt (AVTR_SPEC
        §4's per-prompt unit doesn't change just because several are
        triggered together), and the same all-or-nothing budget check
        (_check_run_budget) so a batch that can't fully fit the
        remaining allowance runs none of it rather than stopping
        partway through with some prompts billed and others not."""
        prompt_ids = request.data.get("prompts")
        if not prompt_ids or not isinstance(prompt_ids, list):
            return Response({"prompts": ["Select at least one prompt."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(prompt_ids) > MAX_BULK_RUN_PROMPTS:
            return Response(
                {"prompts": [f"Run at most {MAX_BULK_RUN_PROMPTS} prompts at once."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agency = request.user.agency
        subscription = getattr(agency, "subscription", None)
        plan_providers = list(subscription.plan.providers or []) if subscription else [AIProvider.GEMINI]

        explicit_provider = request.data.get("provider")
        provider = explicit_provider or default_manual_provider()

        if explicit_provider:
            if provider not in AIProvider.values:
                return Response(
                    {"provider": [f"Unknown AI provider: {provider!r}."]}, status=status.HTTP_400_BAD_REQUEST
                )
            if provider not in set(plan_providers):
                return Response(
                    {"provider": [f"Your plan does not include {provider}."]}, status=status.HTTP_400_BAD_REQUEST
                )
            if not get_provider_client(provider).is_configured():
                return Response(
                    {"provider": [f"{provider} isn't configured yet -- add its API key to the environment."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        prompts = list(Prompt.objects.filter(id__in=prompt_ids))
        found_ids = {str(p.id) for p in prompts}
        unknown_ids = [str(pid) for pid in prompt_ids if str(pid) not in found_ids]
        if unknown_ids:
            return Response(
                {"prompts": [f"Unknown prompt id(s): {', '.join(unknown_ids)}."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        needed = len(prompts)
        _billing_period, blocked = self._check_run_budget(agency, needed)
        if blocked is not None:
            return blocked

        # Charge the whole batch before executing, so a run that fails inline
        # (eager/DEBUG execution) is refunded against a charge that exists.
        track_prompt_run_usage(agency, provider, count=needed)

        runs = []
        for prompt in prompts:
            run = PromptRun.objects.create(
                agency=agency,
                prompt=prompt,
                prompt_text=prompt.text,
                provider=provider,
                status=PromptRun.Status.QUEUED,
            )
            if settings.DEBUG or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
                execute_prompt_run.apply(args=[str(run.id)])
            else:
                try:
                    execute_prompt_run.delay(str(run.id))
                except Exception:
                    execute_prompt_run.apply(args=[str(run.id)])
            run.refresh_from_db()
            runs.append(run)

        return Response(
            {"created": needed, "prompt_runs": PromptRunSerializer(runs, many=True).data},
            status=status.HTTP_201_CREATED,
        )


class PromptRunViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only run history -- rows only ever come from
    PromptViewSet.run()/run_bulk(), never created directly through this
    endpoint. Supports optional ?prompt=<id>, ?client=<id>, ?provider=<name>,
    and ?status=<status> filters."""

    serializer_class = PromptRunSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        queryset = PromptRun.objects.select_related(
            "prompt", "schedule", "prompt__client", "prompt__client__brand"
        ).prefetch_related(
            "mentions",
            "citations",
            "mentions__brand",
            "mentions__competitor",
            "mentions__citations",
        )
        prompt_id = self.request.query_params.get("prompt")
        if prompt_id:
            queryset = queryset.filter(prompt_id=prompt_id)
        client_id = self.request.query_params.get("client")
        if client_id:
            queryset = queryset.filter(prompt__client_id=client_id)
        provider = self.request.query_params.get("provider")
        if provider:
            queryset = queryset.filter(provider=provider)
        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset


class MentionViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only -- rows only ever come from
    core.mention_detection.detect_mentions, never created directly
    through this endpoint. Supports optional `?prompt_run=<id>` and
    `?client=<id>` filters."""

    serializer_class = MentionSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        queryset = Mention.objects.select_related("prompt_run", "client", "brand", "competitor").prefetch_related("citations")
        prompt_run_id = self.request.query_params.get("prompt_run")
        if prompt_run_id:
            queryset = queryset.filter(prompt_run_id=prompt_run_id)
        client_id = self.request.query_params.get("client")
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        return queryset


class CitationViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only -- rows only ever come from
    core.citations.store_citations, never created directly through
    this endpoint. Supports an optional `?prompt_run=<id>` filter."""

    serializer_class = CitationSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        queryset = Citation.objects.select_related("prompt_run")
        prompt_run_id = self.request.query_params.get("prompt_run")
        if prompt_run_id:
            queryset = queryset.filter(prompt_run_id=prompt_run_id)
        return queryset


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """Dashboard-facing notifications -- currently just "your schedule
    started running" (core.tasks._notify_schedule_started); rows are
    never created through this endpoint. Supports an optional
    `?is_read=false` filter so the dashboard can ask for just the unread
    ones without fetching (and re-rendering) the whole history."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        queryset = Notification.objects.select_related("schedule")
        is_read = self.request.query_params.get("is_read")
        if is_read is not None:
            queryset = queryset.filter(is_read=is_read.lower() == "true")
        return queryset

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        updated = Notification.objects.filter(is_read=False).update(is_read=True)
        return Response({"updated": updated})

    @action(detail=False, methods=["post"], url_path="test")
    def test_notification(self, request):
        agency = request.user.agency
        first_client = agency.clients.first() if agency else None
        client_name = first_client.name if first_client else "your client"
        msg = request.data.get(
            "message",
            f"Test Alert: AI search visibility benchmark completed for {client_name} (All 15 prompts verified)."
        )
        notif = Notification.objects.create(
            agency=agency,
            type="audit_completed",
            message=msg,
            is_read=False
        )
        return Response(NotificationSerializer(notif).data, status=status.HTTP_201_CREATED)


class SubscriptionDetailView(RetrieveAPIView):
    """The caller's own agency's subscription, including its current
    billing period's usage (created on first read if this is the first
    time this period has been touched -- see
    get_or_create_current_billing_period)."""

    serializer_class = SubscriptionSerializer
    permission_classes = [IsAgencyMember]

    def get_object(self):
        subscription = getattr(self.request.user.agency, "subscription", None)
        if subscription is None:
            raise NotFound("Your agency has no subscription.")
        return subscription


class SubscriptionTestActivateView(APIView):
    """Local/dev-only convenience so a tester can self-serve past the
    /subscribe gate without touching Django admin -- NOT a payment
    endpoint, and NOT how a real activation happens (that's
    SubscriptionAdmin.activate_subscriptions, an admin confirming a real
    payment out of band). Refuses to run unless settings.DEBUG is on, so
    it can never accidentally ship as a free-activation hole in a real
    deployment; wired to Stripe checkout in the AVTR_SPEC follow-up."""

    permission_classes = [IsAgencyAdmin]

    def post(self, request):
        if not settings.DEBUG:
            raise NotFound("Not available.")
        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is None:
            return Response({"detail": "Your agency has no subscription."}, status=status.HTTP_400_BAD_REQUEST)
        payment = TestPaymentSerializer(data=request.data or {})
        payment.is_valid(raise_exception=True)
        data = payment.validated_data
        if data.get("card_last4"):
            subscription.card_brand = data.get("card_brand") or "card"
            subscription.card_last4 = data["card_last4"]
            subscription.card_exp_month = data.get("card_exp_month")
            subscription.card_exp_year = data.get("card_exp_year")
        if "auto_renew" in data:
            subscription.auto_renew = data["auto_renew"]
        subscription.save(
            update_fields=["card_brand", "card_last4", "card_exp_month", "card_exp_year", "auto_renew"]
        )
        activate_subscription(subscription)
        return Response(SubscriptionSerializer(subscription).data)


class SubscriptionAutoRenewView(APIView):
    """Turns auto-renew on or off from the Billing page. Turning it on
    needs a still-valid card on file (saved at checkout)."""

    permission_classes = [IsAgencyAdmin]

    def patch(self, request):
        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is None:
            return Response({"detail": "Your agency has no subscription."}, status=status.HTTP_400_BAD_REQUEST)
        enabled = request.data.get("auto_renew")
        if not isinstance(enabled, bool):
            return Response({"auto_renew": "Must be true or false."}, status=status.HTTP_400_BAD_REQUEST)
        if enabled and not subscription.has_valid_card():
            return Response(
                {"detail": "Add a valid card by renewing or checking out once before turning on auto-renew."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        subscription.auto_renew = enabled
        subscription.save(update_fields=["auto_renew"])
        return Response(SubscriptionSerializer(subscription).data)


class SubscriptionChoosePlanView(APIView):
    """Lets an agency admin pick a plan when their agency doesn't have a
    subscription at all -- an account from before this feature existed,
    or one created directly (e.g. AgencyCreateView, or a Django admin
    superuser adding an Agency by hand) rather than through
    RegisterSerializer's normal signup path -- or when its subscription
    has lapsed (expired at period end, cancelled, past due, unpaid) and it
    is subscribing again (reset to PENDING until payment), or when it
    switches plan from Billing while active (plan changed in place)."""

    permission_classes = [IsAgencyAdmin]

    def post(self, request):
        agency = request.user.agency
        existing = getattr(agency, "subscription", None)
        serializer = ChoosePlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = serializer.validated_data["plan"]
        interval = serializer.validated_data["billing_interval"]
        if existing is not None and existing.is_usable():
            # Plan change from Billing while active: switch the plan; the
            # payment step (activate) then starts the new plan's period.
            existing.plan = plan
            existing.billing_interval = interval
            existing.save(update_fields=["plan", "billing_interval"])
            return Response(SubscriptionSerializer(existing).data, status=status.HTTP_200_OK)
        if existing is not None:
            # Renewal: the old subscription expired / was cancelled / never
            # got paid. Reuse that row (one subscription per agency) on the
            # newly chosen plan, back to PENDING until payment activates it
            # -- activate_subscription then starts a fresh period from today.
            existing.plan = plan
            existing.billing_interval = interval
            existing.status = Subscription.Status.PENDING
            existing.save(update_fields=["plan", "billing_interval", "status"])
            return Response(SubscriptionSerializer(existing).data, status=status.HTTP_200_OK)
        subscription = create_pending_subscription(agency, plan, interval)
        return Response(SubscriptionSerializer(subscription).data, status=status.HTTP_201_CREATED)


class BillingPeriodHistoryView(ListAPIView):
    """Historical billing periods for the caller's agency (AVTR_SPEC
    §18), newest first -- includes the still-open current period."""

    serializer_class = BillingPeriodUsageSerializer
    permission_classes = [IsAgencyMember]

    def get_queryset(self):
        return BillingPeriodUsage.objects.for_user(self.request.user).select_related("plan")


class BillingPeriodInvoicePdfView(APIView):
    """Generates a downloadable/viewable PDF invoice receipt for a specific billing period."""

    permission_classes = [IsAgencyMember]

    def get(self, request, pk=None):
        period = get_object_or_404(
            BillingPeriodUsage.objects.for_user(request.user).select_related("plan", "agency"),
            pk=pk,
        )
        pdf_bytes = generate_invoice_pdf(period, request.user.agency, request.user)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"RankLens-Invoice-{period.period_start.strftime('%Y-%m')}.pdf"
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response


class BillingPeriodCurrentInvoicePdfView(APIView):
    """Generates a downloadable/viewable PDF invoice receipt for the agency's current billing period."""

    permission_classes = [IsAgencyMember]

    def get(self, request):
        period = (
            BillingPeriodUsage.objects.for_user(request.user)
            .select_related("plan", "agency")
            .order_by("-period_start")
            .first()
        )
        if not period:
            return Response({"error": "No billing period recorded yet."}, status=status.HTTP_404_NOT_FOUND)

        pdf_bytes = generate_invoice_pdf(period, request.user.agency, request.user)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        filename = f"RankLens-Invoice-{period.period_start.strftime('%Y-%m')}.pdf"
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response


class TestimonialListView(ListAPIView):
    """Published customer quotes for the public homepage. AllowAny for the
    same reason as SubscriptionPlanListView: it's marketing content shown
    to signed-out visitors. Unpublished rows never leave the server."""

    serializer_class = TestimonialSerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self):
        return Testimonial.objects.filter(is_published=True)


class SubscriptionPlanListView(ListAPIView):
    """Active plans -- for the registration plan picker (signed-out) and
    a future upgrade-plan screen (signed-in, AVTR_SPEC §10). Public on
    purpose: plan names/prices/limits are marketing information, not
    tenant data, and a prospective signup needs to see them before they
    have any credentials at all. Editing only ever happens through
    SubscriptionPlanAdminViewSet, gated to platform staff."""

    serializer_class = SubscriptionPlanSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        plans = list(SubscriptionPlan.objects.filter(is_active=True))
        order = {"starter": 0, "growth": 1, "agency": 2}
        canonical = [p for p in plans if p.slug in order]
        others = [p for p in plans if p.slug not in order]
        if canonical:
            return sorted(canonical, key=lambda p: order.get(p.slug, 99)) + others
        return plans


class PromptScheduleViewSet(AgencyScopedModelViewSet):
    """CRUD for scheduled prompt-run campaigns (AVTR_SPEC §5/§23). All
    the usage/limit/duration validation lives in PromptScheduleSerializer
    -- this wires the standard endpoints plus the two actions the spec
    calls for: `estimate` (never saves anything) and `resume` (the only
    way a paused schedule becomes active again, AVTR_SPEC §14).

    Writes need a usable subscription (WritesNeedUsableSubscription), like the base CRM resources
    (clients/brands/competitors/prompts) -- a pending agency can still
    set up its account while waiting on manual activation, but scheduled
    campaigns are the actual metered/billable surface, so they stay
    locked until there's a usable subscription to bill against."""

    serializer_class = PromptScheduleSerializer
    model = PromptSchedule
    permission_classes = [WritesNeedUsableSubscription]

    def get_queryset(self):
        return PromptSchedule.objects.all().select_related("client", "brand").prefetch_related("prompts")

    def perform_create(self, serializer):
        # New schedules go live immediately, not into `draft` -- the
        # estimate has already gated SAFE/WARNING-only at this point
        # (PromptScheduleSerializer.validate), so there's nothing left
        # to review before it's allowed to run.
        serializer.save(agency=self.request.user.agency, status=PromptSchedule.Status.ACTIVE)

    @action(detail=False, methods=["post"])
    def estimate(self, request):
        """AVTR_SPEC §23: evaluates a hypothetical schedule shape and
        returns the full usage estimate. Must NOT save anything -- and
        doesn't; no PromptSchedule is constructed here at all.

        Also folds in every OTHER already-active schedule's own
        remaining draw through its end_date (reserved_by_other_schedules)
        and lists each one individually under other_active_schedules --
        the frontend uses this to warn "you already have a schedule
        running that still needs N credits by <date>" while the user is
        setting up a new one, with a way to pause that schedule right
        there (see the pause action) if they'd rather free up its
        budget instead."""
        serializer = ScheduleEstimateRequestSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        agency = request.user.agency
        subscription = getattr(agency, "subscription", None)
        if subscription is None:
            return Response({"detail": "Your agency has no subscription."}, status=status.HTTP_400_BAD_REQUEST)

        billing_period = get_or_create_current_billing_period(subscription)
        exclude_id = data.get("schedule_id")
        commitments = active_schedule_commitments(agency, exclude_schedule_id=exclude_id)
        reserved = sum(c["remaining_prompt_runs"] for c in commitments)
        result = estimate_usage(
            billing_period=billing_period,
            prompt_count=len(data["prompts"]),
            provider_count=len(data["providers"]),
            frequency=data["frequency"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            timezone_name=data.get("timezone") or "UTC",
            custom_interval_days=data.get("custom_interval_days"),
            reserved_by_other_schedules=reserved,
        )
        return Response({**serialize_usage_estimate(result), "other_active_schedules": commitments})

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        """AVTR_SPEC §14: a paused schedule (user-paused or
        limit-paused) only ever resumes on an explicit user action --
        never automatically, e.g. on subscription renewal. Re-validates
        usage exactly like creation does, since time (and other
        schedules' usage) may have passed since it was paused."""
        schedule = self.get_object()
        if schedule.status not in (PromptSchedule.Status.PAUSED, PromptSchedule.Status.PAUSED_LIMIT_REACHED):
            return Response({"detail": "Only a paused schedule can be resumed."}, status=status.HTTP_400_BAD_REQUEST)

        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is None or not subscription.is_usable():
            return Response(
                {"detail": "Your agency has no active subscription."}, status=status.HTTP_400_BAD_REQUEST
            )

        agency = request.user.agency
        reserved = sum(
            c["remaining_prompt_runs"]
            for c in active_schedule_commitments(agency, exclude_schedule_id=schedule.id)
        )
        billing_period = get_or_create_current_billing_period(subscription)
        result = estimate_usage(
            billing_period=billing_period,
            prompt_count=schedule.prompts.count(),
            provider_count=len(schedule.providers or []),
            frequency=schedule.frequency,
            start_date=schedule.start_date,
            end_date=schedule.end_date,
            timezone_name=schedule.timezone,
            custom_interval_days=schedule.custom_interval_days,
            reserved_by_other_schedules=reserved,
        )
        if result.status == "EXCEEDS_LIMIT":
            return Response(
                {
                    "detail": "Resuming would exceed your plan's included Prompt Run usage.",
                    "estimate": serialize_usage_estimate(result),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.status = PromptSchedule.Status.ACTIVE
        schedule.save(update_fields=["status"])
        return Response(PromptScheduleSerializer(schedule, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        """The reverse of resume: lets an agency deliberately stop an
        ACTIVE (or system-paused PAUSED_LIMIT_REACHED) schedule from
        drawing any more of the plan's Prompt Run allowance, without
        deleting its history -- e.g. to free up budget for a new
        schedule it's about to create instead (see the estimate action's
        other_active_schedules). A schedule already PAUSED, COMPLETED,
        or CANCELLED can't be paused again."""
        schedule = self.get_object()
        if schedule.status not in (PromptSchedule.Status.ACTIVE, PromptSchedule.Status.PAUSED_LIMIT_REACHED):
            return Response({"detail": "Only an active schedule can be paused."}, status=status.HTTP_400_BAD_REQUEST)

        schedule.status = PromptSchedule.Status.PAUSED
        schedule.save(update_fields=["status"])
        return Response(PromptScheduleSerializer(schedule, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def run_now(self, request, pk=None):
        """Immediately trigger this schedule on-demand for rapid audit testing.
        Bypasses scheduled run_time and executes all configured prompts immediately."""
        schedule = self.get_object()
        if schedule.status not in (PromptSchedule.Status.ACTIVE, PromptSchedule.Status.PAUSED):
            return Response(
                {"detail": "Only active or paused schedules can be triggered."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = _process_schedule_tick(schedule, force_run=True)
            schedule.refresh_from_db()
            return Response(
                {
                    "detail": "Schedule executed successfully.",
                    "result": result,
                    "schedule": PromptScheduleSerializer(schedule, context={"request": request}).data,
                }
            )
        except Exception as exc:
            logger.exception("Manual run_now failed for schedule %s", schedule.id)
            return Response({"detail": f"Execution failed: {exc}"}, status=status.HTTP_400_BAD_REQUEST)


class SubscriptionPlanAdminViewSet(viewsets.ModelViewSet):
    """Admin-only CRUD for commercial plan configuration (AVTR_SPEC
    §19/§20). IsAdminUser checks Django's platform-staff flag (is_staff)
    -- a deliberately different, higher gate than IsAgencyAdmin, which
    only governs one agency's own team/settings and must never reach
    plan configuration (§20: "Normal agency users MUST NOT be able to
    modify plan configuration").

    Every changed field is written to PlanConfigAuditLog (§21) -- no
    silent edits. Editing a plan never touches any BillingPeriodUsage
    already recorded (§22); those keep the allowance snapshotted when
    they were created."""

    queryset = SubscriptionPlan.objects.all()
    serializer_class = SubscriptionPlanAdminSerializer
    permission_classes = [IsAdminUser]

    def perform_create(self, serializer):
        plan = serializer.save()
        PlanConfigAuditLog.objects.create(
            admin_user=self.request.user,
            plan=plan,
            field_changed="__created__",
            old_value="",
            new_value=plan.slug,
        )

    def perform_update(self, serializer):
        old = SubscriptionPlan.objects.get(pk=serializer.instance.pk)
        plan = serializer.save()
        for field in TRACKED_PLAN_FIELDS:
            old_value = getattr(old, field)
            new_value = getattr(plan, field)
            if old_value != new_value:
                PlanConfigAuditLog.objects.create(
                    admin_user=self.request.user,
                    plan=plan,
                    field_changed=field,
                    old_value=str(old_value),
                    new_value=str(new_value),
                )


# =========================================================================
# STRIPE & USAGE TRACKING API VIEWS
# =========================================================================

from .stripe_service import (
    create_checkout_session,
    create_customer_portal_session,
    get_stripe_publishable_key,
    handle_stripe_webhook_event,
    is_stripe_configured,
)
from .usage_tracking import (
    get_agency_usage_snapshot,
    track_prompt_run_usage,
)


class BillingConfigView(APIView):
    """Returns public billing & Stripe publishable configuration for the frontend."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            "publishable_key": get_stripe_publishable_key(),
            "is_test_mode": True,
            "stripe_configured": is_stripe_configured(),
        })


class StripeCheckoutSessionView(APIView):
    """Creates a Stripe Checkout Session in test mode for plan purchases and upgrades."""

    permission_classes = [IsAgencyAdmin]

    def post(self, request):
        agency = request.user.agency
        plan_slug = request.data.get("plan_slug") or request.data.get("plan")
        billing_interval = request.data.get("billing_interval", Subscription.BillingInterval.MONTHLY)
        success_url = request.data.get("success_url")
        cancel_url = request.data.get("cancel_url")

        if not plan_slug:
            return Response({"detail": "plan_slug is required."}, status=status.HTTP_400_BAD_REQUEST)

        plan = SubscriptionPlan.objects.filter(slug=plan_slug, is_active=True).first()
        if not plan:
            return Response({"detail": f"Plan '{plan_slug}' not found."}, status=status.HTTP_404_NOT_FOUND)

        if billing_interval not in (Subscription.BillingInterval.MONTHLY, Subscription.BillingInterval.YEARLY):
            billing_interval = Subscription.BillingInterval.MONTHLY

        checkout_data = create_checkout_session(
            agency=agency,
            user=request.user,
            plan=plan,
            billing_interval=billing_interval,
            success_url=success_url,
            cancel_url=cancel_url,
        )

        return Response(checkout_data, status=status.HTTP_200_OK)


class StripeCustomerPortalView(APIView):
    """Creates a Stripe Customer Portal session for managing cards and subscriptions."""

    permission_classes = [IsAgencyAdmin]

    def post(self, request):
        agency = request.user.agency
        return_url = request.data.get("return_url")
        portal_data = create_customer_portal_session(agency, return_url=return_url)
        return Response(portal_data, status=status.HTTP_200_OK)


class StripeWebhookView(APIView):
    """Public webhook endpoint receiving asynchronous lifecycle events from Stripe."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        sig_header = request.headers.get("Stripe-Signature")
        payload = request.body

        try:
            result = handle_stripe_webhook_event(payload, sig_header)
            return Response(result, status=status.HTTP_200_OK)
        except ValueError as exc:
            logger.warning("Stripe webhook rejected: %s", exc)
            return Response({"error": "Webhook rejected."}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Unexpected error processing Stripe webhook")
            return Response({"error": "Internal webhook error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SubscriptionUsageSummaryView(APIView):
    """Returns a real-time, comprehensive usage snapshot and limit analysis for the caller's agency."""

    permission_classes = [IsAgencyMember]

    def get(self, request):
        agency = request.user.agency
        if not agency:
            raise NotFound("User has no associated agency.")
        snapshot = get_agency_usage_snapshot(agency)
        return Response(snapshot, status=status.HTTP_200_OK)

