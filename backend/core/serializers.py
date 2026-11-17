from datetime import UTC, timedelta

from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)

from .billing import (
    active_schedule_commitments,
    create_pending_subscription,
    estimate_usage,
    get_or_create_current_billing_period,
)
from .branding import validate_logo_value, validate_white_label_config
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
    Prompt,
    PromptRun,
    PromptSchedule,
    Subscription,
    SubscriptionPlan,
    Testimonial,
    User,
)

MAX_SESSION_LIFETIME = timedelta(hours=24)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds email/role/agency_id as custom claims so the frontend doesn't
    need a follow-up request just to know who's logged in. Also stamps
    `session_start` -- see CustomTokenRefreshSerializer for why."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["email"] = user.email
        token["role"] = user.role
        token["agency_id"] = str(user.agency_id) if user.agency_id else None
        token["session_start"] = int(timezone.now().timestamp())
        return token


class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    """Enforces a hard 24-hour session lifetime, independent of activity.

    ROTATE_REFRESH_TOKENS issues a new refresh token on every use, so left
    alone a continuously-active user would never be forced to re-authenticate
    -- each rotation just pushes REFRESH_TOKEN_LIFETIME further out. Simplejwt
    rotation re-serializes the *same* token payload (only jti/iat/exp change),
    so the `session_start` claim stamped at login survives every rotation --
    this checks it directly, rejecting refresh once 24 hours have passed
    since the original login, no matter how active the session was."""

    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        session_start = refresh.payload.get("session_start")
        if session_start is not None:
            started_at = timezone.datetime.fromtimestamp(session_start, tz=UTC)
            if timezone.now() - started_at > MAX_SESSION_LIFETIME:
                raise InvalidToken("Session expired after 24 hours. Please log in again.")
        return super().validate(attrs)


class RegisterSerializer(serializers.Serializer):
    """Public signup: creates a brand-new agency and its first (admin)
    user in one step. There's no invite/approval gate here -- see the
    caveat noted alongside the view.

    Admin, not member: this person is creating the agency, same as
    AgencyCreateSerializer below makes its caller an admin. Only admins
    can invite teammates or manage agency settings (see
    IsAgencyAdmin) -- a fresh agency needs someone able to do both.

    The user is created inactive: they can't log in (Django's
    authenticate() rejects is_active=False accounts) until they follow
    the verification link emailed by the view."""

    agency_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    plan = serializers.SlugRelatedField(slug_field="slug", queryset=SubscriptionPlan.objects.filter(is_active=True))
    billing_interval = serializers.ChoiceField(
        choices=Subscription.BillingInterval.choices,
        default=Subscription.BillingInterval.MONTHLY,
        required=False,
    )

    def validate_email(self, value):
        email = User.objects.normalize_email(value)
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        agency = Agency.objects.create(name=validated_data["agency_name"])
        user = User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            agency=agency,
            role=User.Role.ADMIN,
            is_active=False,
        )
        plan = validated_data.get("plan")
        if plan:
            billing_interval = validated_data.get("billing_interval", Subscription.BillingInterval.MONTHLY)
            create_pending_subscription(agency, plan, billing_interval)
        return user


class VerifyEmailSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class AgencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Agency
        fields = ("id", "name", "subdomain", "logo_url", "white_label_config", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_logo_url(self, value):
        return validate_logo_value(value)

    def validate_white_label_config(self, value):
        return validate_white_label_config(value)

    def validate_subdomain(self, value):
        if not value:
            return value
        qs = Agency.objects.filter(subdomain__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This subdomain is already taken.")
        return value


class AgencyCreateSerializer(serializers.Serializer):
    """Lets an authenticated, agency-less user create a new agency and
    become its admin -- see AgencyCreateView for why that's a narrow
    case (most users get an agency at registration already)."""

    name = serializers.CharField(max_length=255)
    subdomain = serializers.SlugField(max_length=63, required=False, allow_blank=True)

    def validate_subdomain(self, value):
        if value and Agency.objects.filter(subdomain__iexact=value).exists():
            raise serializers.ValidationError("This subdomain is already taken.")
        return value or None

    def create(self, validated_data):
        return Agency.objects.create(**validated_data)


class UserSerializer(serializers.ModelSerializer):
    agency = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "role", "agency", "is_active", "date_joined")

    def get_agency(self, obj):
        if not obj.agency:
            return None
        return AgencySerializer(obj.agency).data


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        validate_password(value)
        return value


class TeamMemberSerializer(serializers.ModelSerializer):
    """Read shape for a teammate, and the write shape for role/is_active
    changes -- everything else about a teammate (email, join date) is
    fixed once the account exists."""

    class Meta:
        model = User
        fields = ("id", "email", "role", "is_active", "date_joined")
        read_only_fields = ("id", "email", "date_joined")


class InviteTeamMemberSerializer(serializers.Serializer):
    """Invite scope is capped at one extra teammate per agency -- see the
    count check in InviteTeamMemberView, not enforced here since it
    depends on the requesting agency, not just field-level input."""

    ROLE_CHOICES = [
        (User.Role.ADMIN, User.Role.ADMIN.label),
        (User.Role.MEMBER, User.Role.MEMBER.label),
    ]

    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=ROLE_CHOICES, default=User.Role.MEMBER)

    def validate_email(self, value):
        email = User.objects.normalize_email(value)
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email


class AcceptInviteSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_password(self, value):
        validate_password(value)
        return value


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ("id", "name", "industry", "target_locations", "services", "created_at")
        read_only_fields = ("id", "created_at")


class ClientMustBelongToRequestersAgencyMixin:
    """Explicit safeguard for any serializer with a `client` field: the
    referenced client must belong to the requesting user's own agency --
    on create *and* on update (e.g. re-pointing an existing brand at a
    different client).

    AgencyAutoScopedManager already scopes the `client`
    PrimaryKeyRelatedField's queryset to the requester's agency, so a
    cross-agency client id normally never resolves and this never actually
    fires. It exists as a second, explicit layer that fails safe on its
    own -- so this invariant doesn't depend entirely on the ambient
    tenancy-scoping mechanism never being weakened or bypassed elsewhere."""

    def validate_client(self, client):
        request = self.context.get("request")
        if request is not None and client.agency_id != request.user.agency_id:
            raise serializers.ValidationError("This client does not belong to your agency.")
        return client


class BrandSerializer(ClientMustBelongToRequestersAgencyMixin, serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = ("id", "client", "name", "aliases", "created_at")
        read_only_fields = ("id", "created_at")


class CompetitorSerializer(ClientMustBelongToRequestersAgencyMixin, serializers.ModelSerializer):
    class Meta:
        model = Competitor
        fields = ("id", "client", "name", "aliases", "created_at")
        read_only_fields = ("id", "created_at")


class PromptSerializer(ClientMustBelongToRequestersAgencyMixin, serializers.ModelSerializer):
    """`locked_until` is the end_date of the ACTIVE PromptSchedule
    currently holding this prompt (see PromptViewSet._locking_schedule),
    or null if it isn't locked -- lets the frontend disable Edit/Delete
    and explain why without a separate lookup. The backend enforces the
    same rule independently (PromptViewSet.perform_update/perform_destroy),
    so this is purely a display hint, never trusted as the real gate."""

    locked_until = serializers.SerializerMethodField()

    class Meta:
        model = Prompt
        fields = (
            "id",
            "client",
            "text",
            "category",
            "service_tags",
            "location_tags",
            "schedule",
            "is_active",
            "locked_until",
            "created_at",
        )
        read_only_fields = ("id", "locked_until", "created_at")

    def get_locked_until(self, obj):
        if hasattr(obj, "active_schedules"):
            return obj.active_schedules[0].end_date if obj.active_schedules else None
        active_schedule = obj.schedules.filter(status=PromptSchedule.Status.ACTIVE).first()
        return active_schedule.end_date if active_schedule else None


class CitationSerializer(serializers.ModelSerializer):
    """Output-only: rows are created by core.citations.store_citations
    (called from execute_prompt_run once a run COMPLETEs), never through
    this serializer directly."""

    class Meta:
        model = Citation
        fields = ("id", "prompt_run", "url", "title", "domain", "created_at")
        read_only_fields = fields


class MentionSerializer(serializers.ModelSerializer):
    """Output-only: rows are created by core.mention_detection.detect_mentions
    (called from execute_prompt_run once a run COMPLETEs), never through
    this serializer directly."""

    class Meta:
        model = Mention
        fields = (
            "id",
            "prompt_run",
            "client",
            "brand",
            "competitor",
            "term",
            "is_primary",
            "start_index",
            "end_index",
            "mention_order",
            "list_rank",
            "sentiment",
            "sentiment_source",
            "confidence_score",
            "needs_review",
            "citations",
            "created_at",
        )
        read_only_fields = fields


class PromptRunSerializer(serializers.ModelSerializer):
    """Output-only: rows are created by PromptViewSet.run() or the
    scheduled dispatch task, never through this serializer directly."""

    client_id = serializers.UUIDField(source="prompt.client_id", read_only=True)
    client_name = serializers.CharField(source="prompt.client.name", read_only=True)
    brand_name = serializers.SerializerMethodField()
    mentions = MentionSerializer(many=True, read_only=True)
    citations = CitationSerializer(many=True, read_only=True)

    class Meta:
        model = PromptRun
        fields = (
            "id",
            "prompt",
            "prompt_text",
            "client_id",
            "client_name",
            "brand_name",
            "provider",
            "schedule",
            "status",
            "response_text",
            "mentions",
            "citations",
            "created_at",
            "executed_at",
        )
        read_only_fields = fields

    def get_brand_name(self, obj):
        try:
            return obj.prompt.client.brand.name
        except Exception:
            return None


class NotificationSerializer(serializers.ModelSerializer):
    """Output-only: rows are created by core.tasks._notify_schedule_started,
    never through this serializer directly -- the API only ever lists and
    marks them read (NotificationViewSet)."""

    class Meta:
        model = Notification
        fields = ("id", "type", "message", "schedule", "is_read", "created_at")
        read_only_fields = fields


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    """Read shape for agency-facing use (plan picker, usage dashboard) --
    every field is display-only here. Admin-only editing goes through
    SubscriptionPlanAdminSerializer instead, never this one (AVTR_SPEC
    §19/§26: normal users must not be able to influence plan config)."""

    class Meta:
        model = SubscriptionPlan
        fields = (
            "id",
            "slug",
            "name",
            "monthly_price_usd",
            "yearly_price_usd",
            "prompt_runs_included",
            "client_limit",
            "stored_prompt_limit",
            "active_schedule_limit",
            "team_member_limit",
            "providers",
            "white_label_level",
            "support_level",
            "rollover_enabled",
            "rollover_percent",
            "rollover_cap_percent",
            "is_active",
        )
        read_only_fields = fields


class SubscriptionPlanAdminSerializer(serializers.ModelSerializer):
    """Full read/write shape, only ever reached through
    SubscriptionPlanAdminViewSet (permission_classes=[IsAdminUser] --
    Django's is_staff flag, the platform-admin distinction, not
    IsAgencyAdmin). Every commercial field an admin can touch per
    AVTR_SPEC §19/§20 is writable; the view records each changed field
    to PlanConfigAuditLog (§21) after save."""

    class Meta:
        model = SubscriptionPlan
        fields = (
            "id",
            "slug",
            "name",
            "monthly_price_usd",
            "yearly_price_usd",
            "prompt_runs_included",
            "client_limit",
            "stored_prompt_limit",
            "active_schedule_limit",
            "team_member_limit",
            "providers",
            "white_label_level",
            "support_level",
            "rollover_enabled",
            "rollover_percent",
            "rollover_cap_percent",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_providers(self, value):
        if not isinstance(value, list) or not all(v in AIProvider.values for v in value):
            raise serializers.ValidationError(f"Must be a list of: {', '.join(AIProvider.values)}.")
        return value


class BillingPeriodUsageSerializer(serializers.ModelSerializer):
    total_available = serializers.IntegerField(read_only=True)
    prompt_runs_remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = BillingPeriodUsage
        fields = (
            "id",
            "plan",
            "billing_interval",
            "period_start",
            "period_end",
            "base_prompt_run_allowance",
            "rollover_received",
            "total_available",
            "prompt_runs_used",
            "prompt_runs_remaining",
            "rollover_generated",
            "created_at",
            "closed_at",
        )
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    """Read-only agency-facing view of the caller's own subscription --
    plan changes/renewals/cancellation aren't part of this task
    (AVTR_SPEC §30: no Stripe yet). Picking a plan for the first time
    goes through RegisterSerializer (at signup) or ChoosePlanSerializer
    (an already-signed-up agency with no subscription yet, see
    SubscriptionChoosePlanView) -- both create a PENDING row, never
    write to an existing one, so this stays read-only."""

    plan = SubscriptionPlanSerializer(read_only=True)
    current_billing_period = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = (
            "id",
            "plan",
            "billing_interval",
            "status",
            "current_period_start",
            "current_period_end",
            "current_billing_period",
            "auto_renew",
            "card_brand",
            "card_last4",
            "card_exp_month",
            "card_exp_year",
            "created_at",
        )
        read_only_fields = fields

    def get_current_billing_period(self, obj):
        if not obj.is_usable():
            return None
        period = get_or_create_current_billing_period(obj)
        return BillingPeriodUsageSerializer(period).data


class ChoosePlanSerializer(serializers.Serializer):
    """Input shape for POST /subscription/choose-plan/ (SubscriptionChoosePlanView)
    -- lets an agency admin pick a plan for an agency that doesn't have a
    subscription at all yet (an old account from before this feature
    existed, or one an admin created directly). Same shape as the plan
    fields on RegisterSerializer; kept separate since this one runs
    against an already-authenticated agency, not signup."""

    plan = serializers.SlugRelatedField(slug_field="slug", queryset=SubscriptionPlan.objects.filter(is_active=True))
    billing_interval = serializers.ChoiceField(
        choices=Subscription.BillingInterval.choices, default=Subscription.BillingInterval.MONTHLY
    )


class PromptScheduleSerializer(serializers.ModelSerializer):
    """CRUD for PromptSchedule (AVTR_SPEC §5/§23). Validation here is
    the backend half of "never trust the frontend" (§6/§26): max
    schedule duration, provider access, and the plan usage limit are
    all re-checked independently of whatever the client already
    validated client-side."""

    prompts = serializers.PrimaryKeyRelatedField(queryset=Prompt.objects.all(), many=True)
    estimate = serializers.SerializerMethodField()

    class Meta:
        model = PromptSchedule
        fields = (
            "id",
            "client",
            "brand",
            "prompts",
            "providers",
            "frequency",
            "custom_interval_days",
            "start_date",
            "end_date",
            "run_time",
            "timezone",
            "status",
            "estimate",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "status", "estimate", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # See the matching comment on ScheduleEstimateRequestSerializer --
        # `prompts` is declared explicitly above, so its queryset would
        # otherwise be frozen onto whichever agency's request first
        # imported this module. `client`/`brand` are left to ModelSerializer's
        # auto-generated fields instead (built fresh per instance already),
        # which is why only `prompts` needs rebuilding here.
        self.fields["prompts"].queryset = Prompt.objects.all()

    def get_estimate(self, obj):
        request = self.context.get("request")
        if request is None:
            return None
        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is None:
            return None
        reserved = sum(
            c["remaining_prompt_runs"]
            for c in active_schedule_commitments(request.user.agency, exclude_schedule_id=obj.id)
        )
        billing_period = get_or_create_current_billing_period(subscription)
        result = estimate_usage(
            billing_period=billing_period,
            prompt_count=obj.prompts.count(),
            provider_count=len(obj.providers or []),
            frequency=obj.frequency,
            start_date=obj.start_date,
            end_date=obj.end_date,
            timezone_name=obj.timezone,
            custom_interval_days=obj.custom_interval_days,
            reserved_by_other_schedules=reserved,
        )
        return serialize_usage_estimate(result)

    def validate_client(self, client):
        request = self.context.get("request")
        if request is not None and client.agency_id != request.user.agency_id:
            raise serializers.ValidationError("This client does not belong to your agency.")
        return client

    def validate_brand(self, brand):
        request = self.context.get("request")
        if request is not None and brand.agency_id != request.user.agency_id:
            raise serializers.ValidationError("This brand does not belong to your agency.")
        return brand

    def validate_prompts(self, prompts):
        request = self.context.get("request")
        if request is not None:
            for prompt in prompts:
                if prompt.agency_id != request.user.agency_id:
                    raise serializers.ValidationError("All prompts must belong to your agency.")
        if not prompts:
            raise serializers.ValidationError("Select at least one prompt.")
        return prompts

    def validate_providers(self, value):
        if not value or not isinstance(value, list):
            raise serializers.ValidationError("Select at least one AI provider.")
        if not all(v in AIProvider.values for v in value):
            raise serializers.ValidationError(f"Must be a list of: {', '.join(AIProvider.values)}.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")

        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError({"end_date": "End date must be on or after the start date."})

        frequency = attrs.get("frequency", getattr(self.instance, "frequency", None))
        custom_days = attrs.get("custom_interval_days", getattr(self.instance, "custom_interval_days", None))
        if frequency == PromptSchedule.Frequency.CUSTOM and not custom_days:
            raise serializers.ValidationError(
                {"custom_interval_days": "Required when frequency is 'custom' (run every N days)."}
            )
        if frequency != PromptSchedule.Frequency.CUSTOM:
            attrs["custom_interval_days"] = None

        if request is None:
            return attrs
        agency = request.user.agency
        subscription = getattr(agency, "subscription", None)
        if subscription is None:
            raise serializers.ValidationError("Your agency has no active subscription.")

        # AVTR_SPEC §6: a schedule may never extend past the CURRENT
        # billing period, independent of anything the frontend enforced.
        if end_date and end_date > subscription.current_period_end:
            raise serializers.ValidationError(
                {
                    "end_date": (
                        f"Your {subscription.get_billing_interval_display().lower()} plan runs until "
                        f"{subscription.current_period_end:%d %b %Y}, so a schedule can end on that date at "
                        "the latest. Renew or switch to a yearly plan to schedule further ahead."
                    )
                }
            )

        providers = attrs.get("providers", getattr(self.instance, "providers", None)) or []
        plan_providers = set(subscription.plan.providers or [])
        not_allowed = [p for p in providers if p not in plan_providers]
        if not_allowed:
            raise serializers.ValidationError(
                {"providers": f"Your plan does not include: {', '.join(not_allowed)}."}
            )

        # AVTR_SPEC §10: EXCEEDS_LIMIT blocks creation/update outright --
        # only "Adjust Schedule" (change the inputs) or "Upgrade Plan"
        # are offered, never a way to save past the included limit.
        # `prompts` is a M2M -- on a partial update that doesn't touch it,
        # it's absent from `attrs` entirely (never in self.instance.__dict__
        # either, M2M relations aren't), so it has to be counted via the
        # instance's own manager, not a plain attribute lookup.
        if "prompts" in attrs:
            prompt_count = len(attrs["prompts"])
        elif self.instance is not None:
            prompt_count = self.instance.prompts.count()
        else:
            prompt_count = 0
        reserved = sum(
            c["remaining_prompt_runs"]
            for c in active_schedule_commitments(
                agency, exclude_schedule_id=self.instance.id if self.instance is not None else None
            )
        )
        billing_period = get_or_create_current_billing_period(subscription)
        estimate_result = estimate_usage(
            billing_period=billing_period,
            prompt_count=prompt_count,
            provider_count=len(providers),
            frequency=frequency,
            start_date=start_date,
            end_date=end_date,
            timezone_name=attrs.get("timezone", getattr(self.instance, "timezone", "UTC")),
            custom_interval_days=attrs.get("custom_interval_days"),
            reserved_by_other_schedules=reserved,
        )
        if estimate_result.status == "EXCEEDS_LIMIT":
            raise serializers.ValidationError(
                {
                    "non_field_errors": ["This schedule exceeds your plan's included Prompt Run usage."],
                    "estimate": serialize_usage_estimate(estimate_result),
                }
            )

        # AVTR_SPEC §2: active_schedule_limit -- only checked on create,
        # and only against schedules that are actually live.
        if self.instance is None:
            active_count = PromptSchedule.objects.filter(
                agency=agency,
                status__in=[PromptSchedule.Status.ACTIVE, PromptSchedule.Status.PAUSED_LIMIT_REACHED],
            ).count()
            if active_count >= subscription.plan.active_schedule_limit:
                raise serializers.ValidationError(
                    f"Your plan allows at most {subscription.plan.active_schedule_limit} active schedules."
                )

        return attrs


def serialize_usage_estimate(result):
    return {
        "prompt_count": result.prompt_count,
        "provider_count": result.provider_count,
        "scheduled_execution_count": result.scheduled_execution_count,
        "estimated_prompt_runs": result.estimated_prompt_runs,
        "current_usage": result.current_usage,
        "base_allowance": result.base_allowance,
        "rollover_received": result.rollover_received,
        "total_available": result.total_available,
        "reserved_by_other_schedules": result.reserved_by_other_schedules,
        "remaining_runs": result.remaining_runs,
        "projected_usage": result.projected_usage,
        "excess_runs": result.excess_runs,
        "usage_percentage": result.usage_percentage,
        "status": result.status,
        "runs_per_execution": result.runs_per_execution,
        "supported_executions": result.supported_executions,
        "forecast_exhaustion_date": result.forecast_exhaustion_date,
        "billing_period_end": result.billing_period_end,
        "first_execution": result.first_execution,
        "last_execution": result.last_execution,
        "forecast_message": result.forecast_message,
    }


class ScheduleEstimateRequestSerializer(serializers.Serializer):
    """Input shape for POST /prompt-schedules/estimate/ -- deliberately
    a plain Serializer, not a ModelSerializer: this endpoint never saves
    anything (AVTR_SPEC §23), it only evaluates a hypothetical shape."""

    client = serializers.PrimaryKeyRelatedField(queryset=Client.objects.all())
    schedule_id = serializers.UUIDField(required=False, allow_null=True)
    prompts = serializers.PrimaryKeyRelatedField(queryset=Prompt.objects.all(), many=True)
    providers = serializers.ListField(child=serializers.CharField(), allow_empty=False)
    frequency = serializers.ChoiceField(choices=PromptSchedule.Frequency.choices)
    custom_interval_days = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    timezone = serializers.CharField(required=False, default="UTC")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # `queryset=Client.objects.all()` above is evaluated once, when this
        # module is first imported -- which Django defers until the first
        # request that resolves a URL, not process startup. AgencyAutoScopedManager
        # filters by whatever agency happens to be ambient *at that moment*,
        # then DRF caches the resulting queryset on the field for the rest of
        # this worker process's life -- so every later request, from every
        # other agency, got silently frozen onto agency #1's queryset (only
        # ever caught where RLS happened to independently backstop it, which
        # it doesn't under a BYPASSRLS database role). Rebuilding the
        # queryset here runs on every request, picking up the correct
        # ambient agency each time instead of whichever one got there first.
        self.fields["client"].queryset = Client.objects.all()
        self.fields["prompts"].child_relation.queryset = Prompt.objects.all()

    def validate_client(self, client):
        request = self.context.get("request")
        if request is not None and client.agency_id != request.user.agency_id:
            raise serializers.ValidationError("This client does not belong to your agency.")
        return client

    def validate_prompts(self, prompts):
        request = self.context.get("request")
        if request is not None:
            for prompt in prompts:
                if prompt.agency_id != request.user.agency_id:
                    raise serializers.ValidationError("All prompts must belong to your agency.")
        return prompts

    def validate_providers(self, value):
        if not all(v in AIProvider.values for v in value):
            raise serializers.ValidationError(f"Must be a list of: {', '.join(AIProvider.values)}.")
        return value

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"end_date": "End date must be on or after the start date."})
        if attrs["frequency"] == PromptSchedule.Frequency.CUSTOM and not attrs.get("custom_interval_days"):
            raise serializers.ValidationError(
                {"custom_interval_days": "Required when frequency is 'custom' (run every N days)."}
            )
        return attrs


class TestimonialSerializer(serializers.ModelSerializer):
    """Public read shape for the marketing testimonial wall."""

    class Meta:
        model = Testimonial
        fields = ("id", "name", "role", "company", "quote", "country_code", "avatar_url")


class TestPaymentSerializer(serializers.Serializer):
    """What the test-mode checkout sends when a payment goes through: the
    auto-renew choice plus display-safe card details. The full card number
    and CVC never leave the browser."""

    auto_renew = serializers.BooleanField(required=False)
    card_brand = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    card_last4 = serializers.RegexField(r"^\d{4}$", required=False, allow_blank=True, default="")
    card_exp_month = serializers.IntegerField(min_value=1, max_value=12, required=False, allow_null=True)
    card_exp_year = serializers.IntegerField(min_value=2000, max_value=2100, required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get("auto_renew") and not (attrs.get("card_last4") and attrs.get("card_exp_month") and attrs.get("card_exp_year")):
            raise serializers.ValidationError({"auto_renew": "Auto-renew needs a card on file."})
        return attrs

