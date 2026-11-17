import uuid
from datetime import time

from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    PermissionsMixin,
)
from django.db import models
from django.utils import timezone

from . import tenancy


class AIProvider(models.TextChoices):
    """Shared by SubscriptionPlan.providers (which providers a plan
    unlocks), PromptSchedule.providers (which ones a schedule targets),
    and PromptRun.provider (which one a specific run was against) --
    one enum, not three ad-hoc string sets."""

    OPENAI = "openai", "OpenAI"
    GEMINI = "gemini", "Gemini"
    PERPLEXITY = "perplexity", "Perplexity"


class Agency(models.Model):
    """A tenant. Every future model (Client, Brand, Prompt, ...) scopes to one
    of these via an `agency` FK — this is the multi-tenant isolation boundary."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    subdomain = models.SlugField(max_length=63, unique=True, null=True, blank=True)
    # An https:// image URL or an uploaded image stored inline as a
    # data:image/... URL (validated in AgencySerializer.validate_logo_url).
    # TextField, not URLField: uploads are data URLs, which URLField rejects.
    logo_url = models.TextField(blank=True, default="")
    white_label_config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Agencies"

    def __str__(self):
        return self.name


class AgencyScopedQuerySet(models.QuerySet):
    """Mixin for querysets of models with an `agency` FK. Scopes rows to the
    requesting user's tenant so a view can't leak data across agencies by
    forgetting to filter explicitly. Superusers bypass the scope since they
    have no agency of their own and may need cross-tenant visibility."""

    def for_user(self, user):
        if user.is_superuser:
            return self
        return self.filter(agency_id=user.agency_id)


class AgencyAutoScopedManager(models.Manager.from_queryset(AgencyScopedQuerySet)):
    """Like AgencyScopedQuerySet, but filters automatically using the
    ambient "current agency" set per-request by AgencyContextMiddleware
    (see core/tenancy.py) -- a safeguard against a view that forgot to
    call `.for_user()` explicitly. `.for_user()` remains available for
    explicit checks regardless of ambient context.

    Outside of a request (scripts, tests, the shell) where no context has
    ever been established, this is a pass-through, identical to plain
    AgencyScopedQuerySet.as_manager() -- use core.tenancy.use_agency(...)
    there if you need the scoping (required anyway once RLS is enabled on
    the underlying table, since it enforces independently of this)."""

    def get_queryset(self):
        qs = super().get_queryset()
        if not tenancy.context_is_set():
            return qs
        if tenancy.is_bypassing():
            return qs
        agency_id = tenancy.current_agency_id()
        if agency_id is None:
            return qs.none()
        return qs.filter(agency_id=agency_id)


class UserManager(BaseUserManager.from_queryset(AgencyScopedQuerySet)):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Custom user, keyed by email. `agency` is nullable so internal/platform
    superusers can exist without belonging to a tenant; every agency-facing
    user (admin/member) is expected to have one assigned at creation."""

    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(
        Agency, on_delete=models.CASCADE, related_name="users", null=True, blank=True
    )
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


class Client(models.Model):
    """An agency's client — the entity whose AI visibility is being tracked."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="clients")
    name = models.CharField(max_length=255)
    industry = models.CharField(max_length=255, blank=True, default="")
    target_locations = models.JSONField(default=list, blank=True)
    services = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return self.name


class Brand(models.Model):
    """A client's own brand profile — one per client. `aliases` holds
    alternate names/spellings used for fuzzy matching in AI responses."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="brands")
    client = models.OneToOneField(Client, on_delete=models.CASCADE, related_name="brand")
    name = models.CharField(max_length=255)
    aliases = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    def __str__(self):
        return self.name


class Competitor(models.Model):
    """A competitor tracked against one of a client's prompts. A client may
    have several."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="competitors")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="competitors")
    name = models.CharField(max_length=255)
    aliases = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)

    objects = AgencyAutoScopedManager()

    def __str__(self):
        return self.name


class Prompt(models.Model):
    """A buyer-intent question run against an AI provider on a schedule, to
    check whether/how the client's brand shows up in the response."""

    class Schedule(models.TextChoices):
        MANUAL = "manual", "Manual"
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        CUSTOM = "custom", "Custom"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="prompts")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="prompts")
    text = models.TextField()
    category = models.CharField(max_length=255, blank=True, default="")
    service_tags = models.JSONField(default=list, blank=True)
    location_tags = models.JSONField(default=list, blank=True)
    schedule = models.CharField(max_length=10, choices=Schedule.choices, default=Schedule.MANUAL)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return self.text[:60]


# Commercial fields tracked for PlanConfigAuditLog (AVTR_SPEC §21) --
# shared by the admin API (core/views.py SubscriptionPlanAdminViewSet)
# and the Django admin (core/admin.py SubscriptionPlanAdmin) so a plan
# edit is audited the same way regardless of which interface made it.
# Deliberately excludes id/slug/created_at/updated_at, which aren't
# commercial configuration.
TRACKED_PLAN_FIELDS = [
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
]


class SubscriptionPlan(models.Model):
    """Admin-configurable commercial plan. Every price/limit a customer
    sees or is bound by lives here, not hard-coded in views/serializers/
    frontend -- see PlanConfigAuditLog for how admin edits to these are
    tracked, and BillingPeriodUsage.base_prompt_run_allowance for why
    editing a plan never rewrites a billing period that already used the
    old numbers.

    `rollover_percent` and `rollover_cap_percent` are separate knobs on
    purpose (both admin-configurable, see AVTR_SPEC §19): the first is
    the rate applied to a period's *unused* allowance, the second is an
    independent ceiling expressed as a percent of the plan's *base*
    allowance. They default to the same 5% in the initial seed data, but
    don't have to move together."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    monthly_price_usd = models.DecimalField(max_digits=10, decimal_places=2)
    yearly_price_usd = models.DecimalField(max_digits=10, decimal_places=2)
    prompt_runs_included = models.PositiveIntegerField(help_text="Prompt Runs included per billing period.")
    client_limit = models.PositiveIntegerField()
    stored_prompt_limit = models.PositiveIntegerField()
    active_schedule_limit = models.PositiveIntegerField()
    team_member_limit = models.PositiveIntegerField()
    providers = models.JSONField(default=list, blank=True, help_text="List of AIProvider values this plan unlocks.")
    white_label_level = models.CharField(max_length=50, blank=True, default="")
    support_level = models.CharField(max_length=50, blank=True, default="")
    rollover_enabled = models.BooleanField(default=True)
    rollover_percent = models.DecimalField(max_digits=5, decimal_places=2, default=5)
    rollover_cap_percent = models.DecimalField(max_digits=5, decimal_places=2, default=5)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("monthly_price_usd",)

    def __str__(self):
        return self.name


class Subscription(models.Model):
    """One agency's current subscription. Stripe fields are nullable and
    unused for now -- payment processing is a later phase (see
    AVTR_SPEC §3/§30); everything here works from admin/seed-assigned
    plans and dates in the meantime."""

    class BillingInterval(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        YEARLY = "yearly", "Yearly"

    class Status(models.TextChoices):
        # Created at signup, before any payment has actually been
        # collected/confirmed -- Stripe checkout isn't wired up yet
        # (see AVTR_SPEC §30), so for now an admin manually activates a
        # subscription (Django admin action) after collecting payment
        # out of band. Not in is_usable(), so login works but every
        # agency-scoped feature stays gated until activation.
        PENDING = "pending", "Pending activation"
        ACTIVE = "active", "Active"
        TRIALING = "trialing", "Trialing"
        PAST_DUE = "past_due", "Past due"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"
        PAUSED = "paused", "Paused"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.OneToOneField(Agency, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    billing_interval = models.CharField(
        max_length=10, choices=BillingInterval.choices, default=BillingInterval.MONTHLY
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    current_period_start = models.DateField()
    current_period_end = models.DateField()
    stripe_customer_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_price_id = models.CharField(max_length=255, blank=True, null=True)
    # Auto-renew (test-mode simulator; with real Stripe, Stripe renews
    # the subscription itself). Only display-safe card details are kept --
    # brand, last 4 digits and expiry -- never the full number or CVC.
    auto_renew = models.BooleanField(default=False)
    card_brand = models.CharField(max_length=20, blank=True, default="")
    card_last4 = models.CharField(max_length=4, blank=True, default="")
    card_exp_month = models.PositiveSmallIntegerField(null=True, blank=True)
    card_exp_year = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def is_usable(self):
        """Whether new PromptRuns are allowed to execute at all under
        this subscription, independent of remaining usage -- an expired/
        cancelled/paused/past-due subscription blocks execution even if
        the billing period technically still has Prompt Runs left."""
        return self.status in (self.Status.ACTIVE, self.Status.TRIALING)

    def has_valid_card(self, on_date=None):
        """A saved card that hasn't expired by `on_date` (default today)."""
        if not (self.card_last4 and self.card_exp_month and self.card_exp_year):
            return False
        on_date = on_date or timezone.now().date()
        return (self.card_exp_year, self.card_exp_month) >= (on_date.year, on_date.month)

    def __str__(self):
        return f"{self.agency.name} — {self.plan.name} ({self.status})"


class BillingPeriodUsage(models.Model):
    """One row per agency per billing period -- the historical usage
    ledger (AVTR_SPEC §16/§17). `base_prompt_run_allowance` is a
    snapshot of the plan's `prompt_runs_included` at the time this
    period started, not a live reference -- an admin later changing the
    plan's price/limits must never rewrite what an already-elapsed
    period shows (§22 plan version safety).

    Immutable once `closed_at` is set, other than through an explicit
    admin correction (not yet implemented as a separate mechanism --
    today that means a Django admin superuser edit, which is itself
    audit-logged the same as any other admin action via Django's own
    admin log)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="billing_period_usages")
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="billing_period_usages")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="billing_period_usages")
    billing_interval = models.CharField(max_length=10, choices=Subscription.BillingInterval.choices)
    period_start = models.DateField()
    period_end = models.DateField()
    base_prompt_run_allowance = models.PositiveIntegerField()
    rollover_received = models.PositiveIntegerField(default=0)
    prompt_runs_used = models.PositiveIntegerField(default=0)
    rollover_generated = models.PositiveIntegerField(
        null=True, blank=True, help_text="Computed when the period closes; null while still open."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("-period_start",)
        constraints = [
            models.UniqueConstraint(fields=["agency", "period_start"], name="unique_agency_billing_period"),
        ]

    @property
    def total_available(self):
        return self.base_prompt_run_allowance + self.rollover_received

    @property
    def prompt_runs_remaining(self):
        return max(0, self.total_available - self.prompt_runs_used)

    def __str__(self):
        return f"{self.agency.name} {self.period_start} – {self.period_end}"


class PromptSchedule(models.Model):
    """A scheduled campaign: run a set of Prompts against a set of AI
    providers, on a recurring cadence, within a bounded date range. This
    is a materially different, richer concept than `Prompt.schedule`
    (a simple recurring-cadence tag on one prompt, left as-is) -- one
    PromptSchedule spans many prompts and providers with its own start/
    end dates, timezone, and status lifecycle, and is what
    dispatch_scheduled_prompt_runs (core/tasks.py) actually drives off
    of. See core/scheduling.py for the date-math and usage-estimation
    services built around this model."""

    class Frequency(models.TextChoices):
        ONCE = "once", "Once"
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        CUSTOM = "custom", "Custom"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        # Distinct from a user-initiated PAUSED: the system paused this
        # one itself because the agency ran out of included Prompt Runs
        # (AVTR_SPEC §12) -- kept separate so the UI can explain *why*
        # rather than showing an indistinguishable "paused".
        PAUSED_LIMIT_REACHED = "paused_limit_reached", "Paused (limit reached)"
        # Paused by the system because the agency's subscription expired;
        # resumes on its own once the subscription is renewed.
        PAUSED_SUBSCRIPTION = "paused_subscription", "Paused (subscription expired)"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="prompt_schedules")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="prompt_schedules")
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name="prompt_schedules")
    prompts = models.ManyToManyField(Prompt, related_name="schedules")
    providers = models.JSONField(default=list, blank=True, help_text="List of AIProvider values this schedule runs.")
    frequency = models.CharField(max_length=10, choices=Frequency.choices)
    custom_interval_days = models.PositiveIntegerField(
        null=True, blank=True, help_text="Only used when frequency=custom: run every N days."
    )
    start_date = models.DateField()
    end_date = models.DateField()
    run_time = models.TimeField(
        default=time(9, 0), help_text="Time of day (in `timezone`) this schedule fires on each due date."
    )
    timezone = models.CharField(max_length=64, default="UTC")
    status = models.CharField(max_length=25, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"Schedule for {self.client.name} ({self.frequency})"


class PlanConfigAuditLog(models.Model):
    """One row per commercial-plan field change (AVTR_SPEC §21) -- no
    silent edits. Written by SubscriptionPlanAdmin.save_model (core/admin.py)
    and by the admin-only plan API, never by agency-facing code."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    admin_user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="plan_config_changes")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.CASCADE, related_name="audit_log")
    field_changed = models.CharField(max_length=100)
    old_value = models.TextField(blank=True, default="")
    new_value = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-timestamp",)

    def __str__(self):
        return f"{self.plan.slug}.{self.field_changed}: {self.old_value!r} -> {self.new_value!r}"


class PromptRun(models.Model):
    """One trigger of a Prompt against an AI provider -- either manual
    ("run now") or scheduled (Celery Beat's dispatch_scheduled_prompt_runs,
    see core/tasks.py). Executed asynchronously through Celery
    (core.tasks.execute_prompt_run, dispatched via `.delay()`) against
    the real provider behind `provider` (core/ai_providers.py) --
    `response_text` holds either the provider's raw answer (COMPLETED)
    or a human-readable failure reason (FAILED, e.g. a provider that
    isn't configured/integrated yet). Still counts against the agency's
    Prompt Run usage the moment it's queued (see PromptViewSet.run),
    regardless of whether the provider call itself later succeeds.

    `prompt_text` snapshots Prompt.text at trigger time rather than
    joining through `prompt` for it, so run history stays accurate --
    for traceability -- even if the prompt is later edited or deleted.

    ONE PromptRun = one prompt executed against one AI provider/model
    (AVTR_SPEC §4) -- `provider` records which one. Manual "run now"
    triggers always target OpenAI for now (the only provider actually
    wired up -- see PromptViewSet.run); scheduled runs (via `schedule`)
    use whichever provider(s) the schedule was configured with.

    `idempotency_key` is set only for scheduled runs (blank for manual
    ones -- a deliberate button click doesn't need de-duplicating). For
    a scheduled run it's `f"schedule:{schedule_id}:{prompt_id}:{provider}:
    {execution_date}"`, so if Celery retries a dispatch (worker restart
    mid-task, task-level retry) for the same schedule/prompt/provider on
    the same calendar execution date, get_or_create on this key makes
    the retry a no-op instead of creating (and billing) a duplicate."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        # A provider call that "succeeded" but returned nothing usable
        # (blank/whitespace-only text) -- not billed the same trust as a
        # real answer, but also not a hard failure worth losing/retrying
        # forever, so it gets its own terminal state instead of being
        # silently reported as COMPLETED. See execute_prompt_run.
        NEEDS_REVIEW = "needs_review", "Needs Review"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="prompt_runs")
    prompt = models.ForeignKey(Prompt, on_delete=models.CASCADE, related_name="runs")
    prompt_text = models.TextField()
    provider = models.CharField(max_length=20, choices=AIProvider.choices, blank=True, default="")
    schedule = models.ForeignKey(
        PromptSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="prompt_runs"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    response_text = models.TextField(
        blank=True, default="", help_text="The provider's raw answer, or a failure reason if the run failed."
    )
    idempotency_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    executed_at = models.DateTimeField(
        null=True, blank=True, help_text="When the provider call finished (success or failure) -- blank until then."
    )

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            # Partial (not table-wide) unique constraint: manual runs
            # leave idempotency_key blank, and there can be many of those
            # -- only non-blank (scheduled) keys need to be unique.
            models.UniqueConstraint(
                fields=["idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_nonblank_promptrun_idempotency_key",
            ),
        ]

    def __str__(self):
        return f"Run of {self.prompt_id} ({self.status})"


class Mention(models.Model):
    """One detected occurrence of a client's own Brand or a tracked
    Competitor inside a PromptRun's response_text (core.matching, Week
    3's exact/alias name-scanning utility) -- AVTR_SPEC's actual "AI
    visibility" signal: not just that a run completed, but whether/how
    the tracked name actually showed up in the answer.

    Stored one row per occurrence (never just a count/boolean), so
    several mentions of the same name in one response, and exactly
    which text matched, are each individually visible -- `term`/
    `is_primary`/`start_index`/`end_index` mirror core.matching.NameMatch
    field for field. Exactly one of `brand`/`competitor` is set,
    enforced below; `client` is denormalized from whichever one that is,
    purely so mentions for a client can be queried without joining
    through two different optional FKs.

    `mention_order` and `list_rank` are two different notions of
    "position" (AVTR_SPEC): `mention_order` is simply this mention's
    1-indexed rank by raw text position among *every* mention (brand and
    all competitors together) found in the same response -- "who got
    named first". `list_rank` is the product-meaningful one: which
    numbered recommendation/list item (e.g. "2. **Some Business**") this
    mention falls under, per core.matching.list_rank_at -- null when the
    response isn't a numbered list, or this mention comes before any
    list marker. A business named 3rd in the raw text can still be list
    item #1 if that's where the AI actually ranked it -- these are not
    interchangeable.

    `sentiment` is how the surrounding text portrays this specific
    mention -- not the response as a whole, and not a general opinion
    of the entity, just the tone of the words right around this one
    occurrence (core.sentiment.classify_sentiment). `sentiment_source`
    records which stage actually produced it: a cheap rule-based keyword
    scan resolves the clear-cut majority of mentions for free, and only
    the genuinely ambiguous ones fall through to a real AI call --
    recorded here so it's visible (and auditable) which is which,
    rather than presenting both as equally "measured".

    `confidence_score` (core.matching.compute_match_confidence) is how
    much this specific occurrence looks like a genuine mention of the
    tracked name, rather than an unrelated word that happened to satisfy
    an exact/whole-word text match -- AI visibility is sampled
    monitoring, not a guaranteed ranking. `needs_review` is that score
    compared against settings.MENTION_CONFIDENCE_REVIEW_THRESHOLD *at
    detection time*: True means this row should be surfaced as
    "uncertain / needs manual review" rather than presented as a
    confirmed detection. Both are still stored even when uncertain --
    RankLens never silently drops a match, it flags it.

    `citations` links this specific occurrence to whichever of the same
    response's Citation rows actually back it (core.mention_citations.
    link_mention_citations) -- a many-to-many, not a single FK, because
    a mention can be backed by zero citations (nothing was cited near
    it), one, or several, and a single citation can likewise back more
    than one mention (e.g. a comparison source cited once that supports
    both a brand and a competitor mention nearby). Plain
    ManyToManyField, no RLS of its own on the join table, matching
    PromptSchedule.prompts' precedent -- both sides are already agency-
    scoped, so a join row can only ever pair two rows from the same
    agency in the first place."""

    class Sentiment(models.TextChoices):
        POSITIVE = "positive", "Positive"
        NEUTRAL = "neutral", "Neutral"
        NEGATIVE = "negative", "Negative"

    class SentimentSource(models.TextChoices):
        RULE = "rule", "Rule-based"
        AI = "ai", "AI-assisted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="mentions")
    prompt_run = models.ForeignKey(PromptRun, on_delete=models.CASCADE, related_name="mentions")
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="mentions")
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, null=True, blank=True, related_name="mentions")
    competitor = models.ForeignKey(
        Competitor, on_delete=models.CASCADE, null=True, blank=True, related_name="mentions"
    )
    term = models.CharField(max_length=255)
    is_primary = models.BooleanField(help_text="True if `term` is the entity's primary name, False for an alias.")
    start_index = models.PositiveIntegerField()
    end_index = models.PositiveIntegerField()
    mention_order = models.PositiveIntegerField(
        help_text="1-indexed rank by raw text position among every mention found in the same response."
    )
    list_rank = models.PositiveIntegerField(
        null=True, blank=True, help_text="Numbered list/recommendation rank, e.g. 1 for a response's \"1. ...\" pick -- null outside of a numbered list."
    )
    sentiment = models.CharField(max_length=10, choices=Sentiment.choices, default=Sentiment.NEUTRAL)
    sentiment_source = models.CharField(max_length=4, choices=SentimentSource.choices, blank=True, default="")
    confidence_score = models.FloatField(
        default=1.0,
        help_text="0.0-1.0, core.matching.compute_match_confidence -- how much this looks like a genuine mention rather than a coincidental text match.",
    )
    needs_review = models.BooleanField(
        default=False,
        help_text="True when confidence_score fell below settings.MENTION_CONFIDENCE_REVIEW_THRESHOLD at detection time.",
    )
    citations = models.ManyToManyField(
        "Citation",
        blank=True,
        related_name="mentions",
        help_text="Citation(s) from the same response that support this specific mention, if any.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("mention_order",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(brand__isnull=False, competitor__isnull=True)
                    | models.Q(brand__isnull=True, competitor__isnull=False)
                ),
                name="mention_exactly_one_of_brand_or_competitor",
            ),
        ]

    def __str__(self):
        return f"{self.term!r} in run {self.prompt_run_id}"


class Citation(models.Model):
    """One source/reference URL found in a PromptRun's raw response --
    either a real citation from provider-side grounding (Gemini Search,
    Month 2 -- see core.ai_providers._append_citations, which renders
    those as markdown links right in the response text) or simply a
    URL the model typed into its own answer. core.citations.
    extract_citations finds these; this table is what "store citations
    linked to the response" (AVTR_SPEC follow-up) means concretely.

    Linked to the PromptRun as a whole, not to a specific Mention --
    a response can cite a source without that source being "about" any
    tracked brand/competitor at all. One row per unique URL per run
    (a URL repeated several times in one answer isn't stored twice).

    `domain` is the normalized host (core.citations.normalize_domain:
    protocol/www stripped, lowercased) so the same source groups
    together across citations and runs regardless of the exact URL or
    www-prefix used."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="citations")
    prompt_run = models.ForeignKey(PromptRun, on_delete=models.CASCADE, related_name="citations")
    url = models.URLField(max_length=2000)
    title = models.CharField(max_length=500, blank=True, default="")
    domain = models.CharField(max_length=255, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("domain", "url")
        constraints = [
            models.UniqueConstraint(fields=["prompt_run", "url"], name="unique_citation_url_per_run"),
        ]

    def __str__(self):
        return f"{self.domain} ({self.url}) in run {self.prompt_run_id}"


class Notification(models.Model):
    """A short, dashboard-facing message for an agency -- currently only
    "your schedule just started running" (created by
    core.tasks._process_schedule_tick the moment a dispatch tick actually
    creates PromptRuns for a schedule, i.e. today's occurrence really did
    start), but the `type` choice leaves room for other kinds later
    without a schema change.

    `schedule` is SET_NULL (not CASCADE) so a notification survives its
    schedule being deleted afterward -- "this ran on <date>" stays true
    and readable in history even once the schedule itself is gone."""

    class Type(models.TextChoices):
        SCHEDULE_STARTED = "schedule_started", "Schedule started"
        USAGE_LIMIT_APPROACHING = "usage_approaching", "Usage limit approaching"
        USAGE_LIMIT_EXCEEDED = "usage_exceeded", "Usage limit exceeded"
        SUBSCRIPTION_RENEWED = "subscription_renewed", "Subscription renewed"
        SUBSCRIPTION_RENEWAL_FAILED = "renewal_failed", "Subscription renewal failed"
        SUBSCRIPTION_EXPIRED = "subscription_expired", "Subscription expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agency = models.ForeignKey(Agency, on_delete=models.CASCADE, related_name="notifications")
    schedule = models.ForeignKey(
        PromptSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications"
    )
    type = models.CharField(max_length=30, choices=Type.choices)
    message = models.CharField(max_length=255)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AgencyAutoScopedManager()

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.type} for {self.agency_id}: {self.message}"


class Testimonial(models.Model):
    """A real customer quote for the public marketing site's testimonial
    wall. Platform-level marketing content, not tenant data -- no agency
    FK and no RLS policy, same as SubscriptionPlan. Managed only by staff
    in Django admin; nothing reaches the public site until `is_published`
    is ticked, so a draft or an unverified quote is never shown."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=100, blank=True, default="", help_text="e.g. Head of SEO")
    company = models.CharField(max_length=120, blank=True, default="")
    quote = models.TextField(max_length=280, help_text="Keep it short -- cards show about two lines.")
    country_code = models.CharField(
        max_length=2, blank=True, default="", help_text="Optional ISO 3166 alpha-2 code, e.g. GB, US, PK."
    )
    avatar_url = models.URLField(blank=True, default="", help_text="Optional https:// link to a square photo.")
    is_published = models.BooleanField(default=False, help_text="Only published quotes appear on the website.")
    sort_order = models.PositiveIntegerField(default=0, help_text="Lower numbers show first.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("sort_order", "-created_at")

    def __str__(self):
        who = f"{self.name}, {self.company}" if self.company else self.name
        return f"{who}: {self.quote[:40]}"

