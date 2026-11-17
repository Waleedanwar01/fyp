from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .billing import activate_subscription
from .models import (
    TRACKED_PLAN_FIELDS,
    Agency,
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


@admin.register(Agency)
class AgencyAdmin(admin.ModelAdmin):
    list_display = ("name", "subdomain", "created_at")
    search_fields = ("name", "subdomain")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    model = User
    ordering = ("email",)
    list_display = ("email", "agency", "role", "is_active", "is_staff")
    list_filter = ("role", "is_active", "is_staff", "agency")
    search_fields = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Agency & role", {"fields": ("agency", "role")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2", "agency", "role", "is_staff", "is_superuser"),
            },
        ),
    )
    readonly_fields = ("date_joined",)


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "agency", "industry", "created_at")
    list_filter = ("agency",)
    search_fields = ("name",)


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ("name", "client", "agency", "created_at")
    list_filter = ("agency",)
    search_fields = ("name",)


@admin.register(Competitor)
class CompetitorAdmin(admin.ModelAdmin):
    list_display = ("name", "client", "agency", "created_at")
    list_filter = ("agency",)
    search_fields = ("name",)


@admin.register(Prompt)
class PromptAdmin(admin.ModelAdmin):
    list_display = ("__str__", "client", "agency", "schedule", "is_active", "created_at")
    list_filter = ("agency", "schedule", "is_active")
    search_fields = ("text",)


@admin.register(PromptRun)
class PromptRunAdmin(admin.ModelAdmin):
    list_display = ("__str__", "prompt", "agency", "provider", "schedule", "status", "created_at", "executed_at")
    list_filter = ("agency", "provider", "status")
    search_fields = ("prompt_text",)


@admin.register(Mention)
class MentionAdmin(admin.ModelAdmin):
    list_display = (
        "term",
        "is_primary",
        "mention_order",
        "list_rank",
        "sentiment",
        "sentiment_source",
        "confidence_score",
        "needs_review",
        "client",
        "brand",
        "competitor",
        "prompt_run",
        "created_at",
    )
    list_filter = ("agency", "is_primary", "sentiment", "sentiment_source", "needs_review")
    search_fields = ("term",)
    filter_horizontal = ("citations",)


@admin.register(Citation)
class CitationAdmin(admin.ModelAdmin):
    list_display = ("domain", "url", "title", "prompt_run", "created_at")
    list_filter = ("agency", "domain")
    search_fields = ("url", "domain", "title")


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("__str__", "agency", "type", "schedule", "is_read", "created_at")
    list_filter = ("agency", "type", "is_read")
    search_fields = ("message",)


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    """The RankLens Admin Panel's plan-configuration screen, for now --
    Django admin already gates this to staff (login_required + is_staff,
    same as the DRF SubscriptionPlanAdminViewSet's IsAdminUser), so a
    plan edit made *here* is audited exactly the same way as one made
    through the API (AVTR_SPEC §21): both funnel through
    TRACKED_PLAN_FIELDS."""

    list_display = (
        "name",
        "slug",
        "monthly_price_usd",
        "yearly_price_usd",
        "prompt_runs_included",
        "client_limit",
        "is_active",
    )
    list_filter = ("is_active",)
    search_fields = ("name", "slug")

    def save_model(self, request, obj, form, change):
        old = SubscriptionPlan.objects.filter(pk=obj.pk).first() if change else None
        super().save_model(request, obj, form, change)
        if old is None:
            PlanConfigAuditLog.objects.create(
                admin_user=request.user, plan=obj, field_changed="__created__", old_value="", new_value=obj.slug
            )
            return
        for field in TRACKED_PLAN_FIELDS:
            old_value, new_value = getattr(old, field), getattr(obj, field)
            if old_value != new_value:
                PlanConfigAuditLog.objects.create(
                    admin_user=request.user,
                    plan=obj,
                    field_changed=field,
                    old_value=str(old_value),
                    new_value=str(new_value),
                )


@admin.register(PlanConfigAuditLog)
class PlanConfigAuditLogAdmin(admin.ModelAdmin):
    """Read-only by design (AVTR_SPEC §21: no silent commercial changes
    -- that includes not letting anyone quietly edit the log itself)."""

    list_display = ("timestamp", "plan", "field_changed", "old_value", "new_value", "admin_user")
    list_filter = ("plan", "field_changed")
    search_fields = ("field_changed", "old_value", "new_value")
    readonly_fields = ("id", "admin_user", "plan", "field_changed", "old_value", "new_value", "timestamp")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("agency", "plan", "billing_interval", "status", "current_period_start", "current_period_end")
    list_filter = ("status", "billing_interval", "plan")
    search_fields = ("agency__name",)
    actions = ["activate_subscriptions"]

    @admin.action(description="Activate selected subscriptions (manual payment confirmed)")
    def activate_subscriptions(self, request, queryset):
        # AVTR_SPEC follow-up: real Stripe checkout is ~3 months out --
        # until then this is how a pending (or lapsed) subscription
        # actually turns on, after payment is confirmed out of band.
        activated = 0
        for subscription in queryset:
            activate_subscription(subscription)
            activated += 1
        self.message_user(request, f"Activated {activated} subscription(s).")


@admin.register(BillingPeriodUsage)
class BillingPeriodUsageAdmin(admin.ModelAdmin):
    list_display = (
        "agency",
        "period_start",
        "period_end",
        "base_prompt_run_allowance",
        "rollover_received",
        "prompt_runs_used",
        "rollover_generated",
        "closed_at",
    )
    list_filter = ("agency",)
    search_fields = ("agency__name",)


@admin.register(PromptSchedule)
class PromptScheduleAdmin(admin.ModelAdmin):
    list_display = ("__str__", "agency", "client", "frequency", "status", "start_date", "end_date")
    list_filter = ("agency", "frequency", "status")
    search_fields = ("client__name",)


@admin.register(Testimonial)
class TestimonialAdmin(admin.ModelAdmin):
    """Marketing testimonial wall content. Add real, permission-granted
    customer quotes only; tick "published" to put one on the homepage."""

    list_display = ("name", "company", "role", "country_code", "is_published", "sort_order", "created_at")
    list_editable = ("is_published", "sort_order")
    list_filter = ("is_published",)
    search_fields = ("name", "company", "quote")



# Registers the System Health admin page (/admin/system-health/).
from . import admin_views  # noqa: F401
