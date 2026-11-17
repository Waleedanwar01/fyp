from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenBlacklistView

from .views import (
    AcceptInviteView,
    AgencyCreateView,
    AgencyDetailView,
    BillingConfigView,
    BillingPeriodCurrentInvoicePdfView,
    BillingPeriodHistoryView,
    BillingPeriodInvoicePdfView,
    BrandViewSet,
    ChangePasswordView,
    CitationViewSet,
    ClientViewSet,
    CompetitorViewSet,
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    InviteTeamMemberView,
    MentionViewSet,
    MeView,
    NotificationViewSet,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PromptRunViewSet,
    PromptScheduleViewSet,
    PromptViewSet,
    RegisterView,
    ResendVerificationView,
    StripeCheckoutSessionView,
    StripeCustomerPortalView,
    StripeWebhookView,
    SubscriptionAutoRenewView,
    SubscriptionChoosePlanView,
    SubscriptionDetailView,
    SubscriptionPlanAdminViewSet,
    SubscriptionPlanListView,
    SubscriptionTestActivateView,
    SubscriptionUsageSummaryView,
    TeamMemberDetailView,
    TeamMemberListView,
    TestimonialListView,
    VerifyEmailView,
)

router = DefaultRouter()
router.register("clients", ClientViewSet, basename="client")
router.register("brands", BrandViewSet, basename="brand")
router.register("competitors", CompetitorViewSet, basename="competitor")
router.register("prompts", PromptViewSet, basename="prompt")
router.register("prompt-runs", PromptRunViewSet, basename="promptrun")
router.register("mentions", MentionViewSet, basename="mention")
router.register("citations", CitationViewSet, basename="citation")
router.register("notifications", NotificationViewSet, basename="notification")
router.register("prompt-schedules", PromptScheduleViewSet, basename="promptschedule")
router.register("schedules", PromptScheduleViewSet, basename="schedule")
router.register("admin/plans", SubscriptionPlanAdminViewSet, basename="admin-plan")

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/verify-email/", VerifyEmailView.as_view(), name="verify_email"),
    path("auth/resend-verification/", ResendVerificationView.as_view(), name="resend_verification"),
    path("auth/token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", CustomTokenRefreshView.as_view(), name="token_refresh"),
    path("auth/token/blacklist/", TokenBlacklistView.as_view(), name="token_blacklist"),
    path("auth/password-reset/", PasswordResetRequestView.as_view(), name="password_reset_request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change_password"),
    path("agencies/", AgencyCreateView.as_view(), name="agency_create"),
    path("agencies/me/", AgencyDetailView.as_view(), name="agency_detail"),
    path("team-members/invite/", InviteTeamMemberView.as_view(), name="team_member_invite"),
    path("team-members/accept-invite/", AcceptInviteView.as_view(), name="accept_invite"),
    path("team-members/<uuid:pk>/", TeamMemberDetailView.as_view(), name="team_member_detail"),
    path("team-members/", TeamMemberListView.as_view(), name="team_member_list"),
    path("subscription/", SubscriptionDetailView.as_view(), name="subscription_detail"),
    path("subscription/history/", BillingPeriodHistoryView.as_view(), name="billing_period_history"),
    path("subscription/history/<uuid:pk>/pdf/", BillingPeriodInvoicePdfView.as_view(), name="billing_period_invoice_pdf"),
    path("subscription/history/current/pdf/", BillingPeriodCurrentInvoicePdfView.as_view(), name="billing_period_current_invoice_pdf"),
    path("subscription/choose-plan/", SubscriptionChoosePlanView.as_view(), name="subscription_choose_plan"),
    path("subscription/activate-test/", SubscriptionTestActivateView.as_view(), name="subscription_activate_test"),
    path("subscription/auto-renew/", SubscriptionAutoRenewView.as_view(), name="subscription_auto_renew"),
    path("subscription/usage-summary/", SubscriptionUsageSummaryView.as_view(), name="subscription_usage_summary"),
    path("billing/config/", BillingConfigView.as_view(), name="billing_config"),
    path("billing/checkout-session/", StripeCheckoutSessionView.as_view(), name="stripe_checkout_session"),
    path("billing/portal-session/", StripeCustomerPortalView.as_view(), name="stripe_customer_portal"),
    path("billing/webhook/", StripeWebhookView.as_view(), name="stripe_webhook"),
    path("plans/", SubscriptionPlanListView.as_view(), name="plan_list"),
    path("testimonials/", TestimonialListView.as_view(), name="testimonial_list"),
] + router.urls
