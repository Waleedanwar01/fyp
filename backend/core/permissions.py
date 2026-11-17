from rest_framework.exceptions import APIException
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import User


class SubscriptionRequired(APIException):
    """Raised (not just returned as a bare 403) so the frontend can tell
    "you're not even a member" apart from "you're a member but your
    agency hasn't been activated yet" -- 402 Payment Required is the
    semantically correct code for the latter."""

    status_code = 402
    default_detail = (
        "Your agency's subscription is pending activation. We'll unlock this once payment is confirmed."
    )
    default_code = "subscription_required"


class IsAgencyMember(BasePermission):
    """Authenticated users who belong to an agency. Excludes anonymous users
    and platform superusers with no agency — those operate through /admin,
    not the tenant-facing API. Full read/write access to clients, brands,
    competitors, and prompts regardless of role -- the admin/member split
    only matters for agency settings and the team roster (see
    IsAgencyAdmin)."""

    message = "You must belong to an agency to access this resource."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.agency_id is not None)

    def has_object_permission(self, request, view, obj):
        return getattr(obj, "agency_id", None) == request.user.agency_id


class IsAgencyAdmin(IsAgencyMember):
    """Required for agency-wide changes: editing agency settings and
    managing the team roster (inviting, changing a teammate's role,
    deactivating/removing them). Plain members can still view both."""

    message = "Only an agency admin can perform this action."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.role == User.Role.ADMIN


class HasUsableSubscription(IsAgencyMember):
    """Gates the core metered product surface (clients/brands/
    competitors/prompts/prompt runs/prompt schedules) behind an actually
    usable subscription -- login itself still works without one (see
    CustomTokenObtainPairView), and account/agency-settings/team-roster
    endpoints are deliberately left ungated so a pending agency can still
    see its own subscription status and manage its account while it
    waits on manual activation."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is None or not subscription.is_usable():
            raise SubscriptionRequired
        return True


class SubscriptionInactive(APIException):
    """402 for a write attempted while the agency's subscription has lapsed
    -- the frontend turns this into its "renew to continue" prompt."""

    status_code = 402
    default_detail = (
        "Your subscription has expired, so your workspace is read-only. "
        "Renew your plan to run audits and make changes again."
    )
    default_code = "subscription_inactive"


class WritesNeedUsableSubscription(IsAgencyMember):
    """Read-only lock for a lapsed subscription (expired, cancelled, past
    due, paused, or never paid): the agency can still *see* everything --
    clients, scores, runs, reports -- but every create/edit/delete/run is
    refused until it renews. Agencies with no subscription record at all
    (legacy accounts, created before plans existed) are left as they were."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.method in SAFE_METHODS:
            return True
        subscription = getattr(request.user.agency, "subscription", None)
        if subscription is not None and not subscription.is_usable():
            if subscription.status == subscription.Status.PENDING:
                raise SubscriptionRequired
            raise SubscriptionInactive
        return True

