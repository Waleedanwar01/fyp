"""Usage tracking hooks, metering services, and limit enforcement for RankLens.

Provides decoupled tracking hooks for prompt runs and extensible metered features
(future overage tracking, export limits, custom analyses) with atomic DB increments
and real-time usage snapshots.
"""

import logging
from dataclasses import asdict, dataclass
from typing import Any

from django.utils import timezone

from .billing import (
    STATUS_EXCEEDS_LIMIT,
    STATUS_SAFE,
    get_or_create_current_billing_period,
    record_usage,
    usage_status,
)
from .models import Agency, BillingPeriodUsage, Notification, Subscription
from .tenancy import use_agency

logger = logging.getLogger(__name__)


@dataclass
class AgencyUsageSnapshot:
    agency_id: str
    agency_name: str
    plan_name: str
    plan_slug: str
    status: str
    is_usable: bool
    billing_interval: str
    current_period_start: str
    current_period_end: str
    days_remaining: int
    base_allowance: int
    rollover_received: int
    total_available: int
    prompt_runs_used: int
    remaining_runs: int
    usage_percentage: float
    usage_health_status: str
    providers_unlocked: list


def track_prompt_run_usage(
    agency: Agency,
    provider: str,
    prompt_id: str | None = None,
    run_id: str | None = None,
    count: int = 1,
) -> BillingPeriodUsage | None:
    """Primary usage tracking hook: executed whenever one or more prompt runs are dispatched
    or completed for an agency. Updates current billing period usage atomically and evaluates
    threshold alerts."""
    if count <= 0:
        return None

    with use_agency(bypass=True):
        subscription = Subscription.objects.filter(agency_id=agency.id).first()
        if not subscription:
            logger.warning("Attempted to record usage for agency %s with no subscription", agency.id)
            return None

        billing_period = get_or_create_current_billing_period(subscription)
        if not billing_period:
            return None

        # Atomic increment via F() expression
        record_usage(billing_period, count)
        
        # Refresh to inspect updated status
        billing_period.refresh_from_db(fields=["prompt_runs_used"])

        total_avail = billing_period.total_available
        used = billing_period.prompt_runs_used
        (used / total_avail) if total_avail > 0 else 1.0

        return billing_period


def refund_prompt_run_usage(
    agency: Agency,
    count: int = 1,
) -> BillingPeriodUsage | None:
    """Rolls back prompt run usage when an API execution permanently fails."""
    if count <= 0:
        return None

    with use_agency(bypass=True):
        subscription = Subscription.objects.filter(agency_id=agency.id).first()
        if not subscription:
            return None

        billing_period = get_or_create_current_billing_period(subscription)
        if not billing_period:
            return None

        from django.db.models import Case, F, When
        BillingPeriodUsage.objects.filter(pk=billing_period.pk).update(
            prompt_runs_used=Case(
                When(prompt_runs_used__gte=count, then=F("prompt_runs_used") - count),
                default=0,
            )
        )
        billing_period.refresh_from_db(fields=["prompt_runs_used"])
        return billing_period



def track_metered_feature_usage(
    agency: Agency,
    feature_name: str,
    quantity: int = 1,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Extensible hook for future metered feature billing (e.g. PDF report exports,
    deep AI sentiment re-evaluations, bulk prompt uploads). Logs metering event for
    future billing calculations without blocking MVP operations."""
    logger.info(
        "Metered feature event logged: Agency=%s, Feature=%s, Quantity=%s, Meta=%s",
        agency.name,
        feature_name,
        quantity,
        metadata or {},
    )
    return {
        "agency_id": str(agency.id),
        "feature_name": feature_name,
        "quantity": quantity,
        "timestamp": timezone.now().isoformat(),
        "metadata": metadata or {},
    }


def get_agency_usage_snapshot(agency: Agency) -> dict[str, Any]:
    """Returns a comprehensive, dashboard-ready usage snapshot for the agency."""
    subscription = Subscription.objects.filter(agency_id=agency.id).first()
    today = timezone.now().date()

    if not subscription:
        return {
            "agency_id": str(agency.id),
            "agency_name": agency.name,
            "has_subscription": False,
            "status": "no_subscription",
            "is_usable": False,
            "total_available": 0,
            "prompt_runs_used": 0,
            "remaining_runs": 0,
            "usage_percentage": 0.0,
            "usage_health_status": STATUS_SAFE,
        }

    plan = subscription.plan
    period = get_or_create_current_billing_period(subscription)

    base_allowance = period.base_prompt_run_allowance if period else plan.prompt_runs_included
    rollover = period.rollover_received if period else 0
    total_avail = period.total_available if period else base_allowance + rollover
    used = period.prompt_runs_used if period else 0
    remaining = max(0, total_avail - used)
    usage_pct = round((used / total_avail) * 100, 1) if total_avail > 0 else 0.0
    health_status = usage_status(used, total_avail)

    days_remaining = max(0, (subscription.current_period_end - today).days)

    snapshot = AgencyUsageSnapshot(
        agency_id=str(agency.id),
        agency_name=agency.name,
        plan_name=plan.name,
        plan_slug=plan.slug,
        status=subscription.status,
        is_usable=subscription.is_usable(),
        billing_interval=subscription.billing_interval,
        current_period_start=subscription.current_period_start.isoformat(),
        current_period_end=subscription.current_period_end.isoformat(),
        days_remaining=days_remaining,
        base_allowance=base_allowance,
        rollover_received=rollover,
        total_available=total_avail,
        prompt_runs_used=used,
        remaining_runs=remaining,
        usage_percentage=usage_pct,
        usage_health_status=health_status,
        providers_unlocked=plan.providers or [],
    )

    data = asdict(snapshot)
    data["has_subscription"] = True
    return data


def _notify_usage_threshold(agency: Agency, billing_period: BillingPeriodUsage, threshold_status: str) -> None:
    """Dispatches in-app warning notification when an agency hits 80% or 100% of plan allowance."""
    # Prevent duplicate spam: only send once per billing period per threshold
    notif_type = (
        Notification.Type.USAGE_LIMIT_EXCEEDED
        if threshold_status == STATUS_EXCEEDS_LIMIT
        else Notification.Type.USAGE_LIMIT_APPROACHING
    )

    already_sent = Notification.objects.filter(
        agency=agency,
        type=notif_type,
        created_at__date__gte=billing_period.period_start,
    ).exists()

    if already_sent:
        return

    used = billing_period.prompt_runs_used
    total = billing_period.total_available
    pct_val = round((used / total) * 100) if total > 0 else 100

    if threshold_status == STATUS_EXCEEDS_LIMIT:
        msg = f"Your agency has utilized {used} of {total} prompt runs (100% of included allowance). Upgrade your plan or add credits to ensure uninterrupted scheduled monitoring."
    else:
        msg = f"Your agency has reached {pct_val}% of your included prompt runs ({used}/{total} used). Consider upgrading soon."

    try:
        Notification.objects.create(
            agency=agency,
            type=notif_type,
            message=msg,
        )
    except Exception as exc:
        logger.warning("Failed to create usage threshold notification: %s", exc)
