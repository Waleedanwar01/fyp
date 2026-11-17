"""Usage estimation, billing-period bookkeeping, and rollover (AVTR_SPEC
§8-§17). Everything here reads limits from SubscriptionPlan/Subscription
-- never a hard-coded number -- so a plan/pricing change only ever
requires an admin edit, not a code change (§19/§26).
"""

import math
from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import F
from django.utils import timezone

from .scheduling import calculate_schedule_dates
from .tenancy import use_agency

STATUS_SAFE = "SAFE"
STATUS_WARNING = "WARNING"
STATUS_EXCEEDS_LIMIT = "EXCEEDS_LIMIT"

# AVTR_SPEC §9: SAFE <= 80%, WARNING (80%, 100%], EXCEEDS_LIMIT > 100%.
SAFE_THRESHOLD = 0.80


def usage_status(projected_usage, total_available):
    if total_available <= 0:
        return STATUS_EXCEEDS_LIMIT if projected_usage > 0 else STATUS_SAFE
    ratio = projected_usage / total_available
    if ratio <= SAFE_THRESHOLD:
        return STATUS_SAFE
    if ratio <= 1.0:
        return STATUS_WARNING
    return STATUS_EXCEEDS_LIMIT


@dataclass
class UsageEstimate:
    prompt_count: int
    provider_count: int
    scheduled_execution_count: int
    estimated_prompt_runs: int
    current_usage: int
    base_allowance: int
    rollover_received: int
    total_available: int
    reserved_by_other_schedules: int
    remaining_runs: int
    projected_usage: int
    excess_runs: int
    usage_percentage: float
    status: str
    runs_per_execution: int
    supported_executions: int
    forecast_exhaustion_date: date | None
    billing_period_end: date
    execution_dates: list[date]
    first_execution: date | None
    last_execution: date | None
    forecast_message: str | None


def _forecast_message(frequency, supported_executions, total_executions):
    """AVTR_SPEC §11: daily schedules are described in "full days"; every
    other frequency in "scheduled executions" -- and no message at all
    once the plan already covers the whole schedule."""
    if total_executions == 0 or supported_executions >= total_executions:
        return None
    if frequency == "daily":
        unit = "full day" if supported_executions == 1 else "full days"
        return f"Your included usage can support this schedule for {supported_executions} {unit}."
    unit = "scheduled execution" if supported_executions == 1 else "scheduled executions"
    return f"Your included usage supports {supported_executions} {unit}."


def estimate_usage(
    *,
    billing_period,
    prompt_count,
    provider_count,
    frequency,
    start_date,
    end_date,
    timezone_name="UTC",
    custom_interval_days=None,
    reserved_by_other_schedules=0,
):
    """The UsageEstimator (AVTR_SPEC §8): pure function over a billing
    period snapshot + a proposed schedule shape -- doesn't touch the DB
    itself (the caller resolves `billing_period` and, if relevant,
    `reserved_by_other_schedules` via active_schedule_commitments), so
    it's exactly as usable for the estimate-only endpoint (nothing
    saved) as for validating a schedule at creation/execution time.

    `reserved_by_other_schedules` is what every OTHER already-active
    schedule for this agency still owes from today through its own
    end_date (see schedule_remaining_commitment) -- folded into both
    `remaining_runs` and `projected_usage`/`status` so a brand new
    schedule that would look SAFE in isolation is correctly flagged
    WARNING/EXCEEDS_LIMIT once stacked on top of what's already
    committed, instead of the two schedules silently competing for the
    same credits later."""
    schedule_dates = calculate_schedule_dates(
        frequency=frequency,
        start_date=start_date,
        end_date=end_date,
        timezone=timezone_name,
        custom_interval_days=custom_interval_days,
    )
    runs_per_execution = prompt_count * provider_count
    estimated_prompt_runs = runs_per_execution * schedule_dates.execution_count

    base_allowance = billing_period.base_prompt_run_allowance
    rollover_received = billing_period.rollover_received
    total_available = billing_period.total_available
    current_usage = billing_period.prompt_runs_used
    remaining_runs = max(0, total_available - current_usage - reserved_by_other_schedules)

    projected_usage = current_usage + reserved_by_other_schedules + estimated_prompt_runs
    excess_runs = max(0, projected_usage - total_available)
    usage_percentage = round((projected_usage / total_available) * 100, 2) if total_available > 0 else 0.0
    status_value = usage_status(projected_usage, total_available)

    supported_executions = (remaining_runs // runs_per_execution) if runs_per_execution > 0 else 0
    supported_executions = min(supported_executions, schedule_dates.execution_count)
    forecast_exhaustion_date = (
        schedule_dates.execution_dates[supported_executions - 1]
        if supported_executions >= 1 and schedule_dates.execution_dates
        else None
    )

    return UsageEstimate(
        prompt_count=prompt_count,
        provider_count=provider_count,
        scheduled_execution_count=schedule_dates.execution_count,
        estimated_prompt_runs=estimated_prompt_runs,
        current_usage=current_usage,
        base_allowance=base_allowance,
        rollover_received=rollover_received,
        total_available=total_available,
        reserved_by_other_schedules=reserved_by_other_schedules,
        remaining_runs=remaining_runs,
        projected_usage=projected_usage,
        excess_runs=excess_runs,
        usage_percentage=usage_percentage,
        status=status_value,
        runs_per_execution=runs_per_execution,
        supported_executions=supported_executions,
        forecast_exhaustion_date=forecast_exhaustion_date,
        billing_period_end=billing_period.period_end,
        execution_dates=schedule_dates.execution_dates,
        first_execution=schedule_dates.first_execution,
        last_execution=schedule_dates.last_execution,
        forecast_message=_forecast_message(frequency, supported_executions, schedule_dates.execution_count),
    )


def create_pending_subscription(agency, plan, billing_interval):
    """The other half of "no Stripe yet" (AVTR_SPEC follow-up): records
    which plan an agency picked as a PENDING subscription -- not
    is_usable() (see HasUsableSubscription) until an admin activates it
    after confirming payment out of band, or (locally only) the tester
    self-activates via SubscriptionTestActivateView. Shared by
    RegisterSerializer.create() (plan chosen at signup) and
    SubscriptionChoosePlanView (an already-signed-up agency that
    doesn't have one yet -- see that view for why that can happen).
    Dates here are a placeholder; activate_subscription recomputes the
    real period start once payment is actually confirmed."""
    from .models import Subscription

    period_days = 365 if billing_interval == Subscription.BillingInterval.YEARLY else 30
    today = timezone.now().date()
    with use_agency(agency=agency.id):
        return Subscription.objects.create(
            agency=agency,
            plan=plan,
            billing_interval=billing_interval,
            status=Subscription.Status.PENDING,
            current_period_start=today,
            current_period_end=today + timedelta(days=period_days),
        )


def activate_subscription(subscription):
    """Turns a PENDING (or lapsed) subscription on -- the one real
    "payment received" transition, until Stripe checkout replaces it
    (AVTR_SPEC follow-up, ~3 months out). Always starts the period fresh
    from today, not from whatever placeholder dates signup guessed at.
    Shared by SubscriptionAdmin.activate_subscriptions (real usage, an
    admin confirming payment out of band) and
    SubscriptionTestActivateView (local/dev-only self-service, see that
    view's DEBUG gate -- never a substitute for the admin path)."""
    from .models import Subscription

    period_days = 365 if subscription.billing_interval == Subscription.BillingInterval.YEARLY else 30
    today = timezone.now().date()
    subscription.status = Subscription.Status.ACTIVE
    subscription.current_period_start = today
    subscription.current_period_end = today + timedelta(days=period_days)
    subscription.save(update_fields=["status", "current_period_start", "current_period_end"])
    resume_schedules_after_renewal(subscription)
    return subscription


def resume_schedules_after_renewal(subscription):
    """Schedules the system paused because the subscription lapsed come
    back on renewal -- but never past the new period's end (a schedule
    can't outlive the subscription), and not ones already finished.
    User-paused and limit-paused schedules are left alone."""
    from .models import PromptSchedule

    today = timezone.now().date()
    with use_agency(agency=subscription.agency_id):
        for schedule in PromptSchedule.objects.filter(
            agency_id=subscription.agency_id, status=PromptSchedule.Status.PAUSED_SUBSCRIPTION
        ):
            if schedule.end_date < today:
                schedule.status = PromptSchedule.Status.COMPLETED
                schedule.save(update_fields=["status"])
                continue
            fields = ["status"]
            if schedule.end_date > subscription.current_period_end:
                schedule.end_date = subscription.current_period_end
                fields.append("end_date")
            schedule.status = PromptSchedule.Status.ACTIVE
            schedule.save(update_fields=fields)


def get_or_create_current_billing_period(subscription):
    """The BillingPeriodUsage row for `subscription`'s current period,
    creating it on first touch. `base_prompt_run_allowance` is snapshotted
    from the plan *now* (AVTR_SPEC §22 plan version safety) -- a later
    admin price/limit change never rewrites an already-started period.
    `rollover_received` comes from the immediately preceding *closed*
    period's `rollover_generated` -- never further back, so rollover
    can't compound across periods (§15)."""
    from .models import BillingPeriodUsage

    existing = BillingPeriodUsage.objects.filter(
        agency_id=subscription.agency_id, period_start=subscription.current_period_start
    ).first()
    if existing is not None:
        return existing

    previous = (
        BillingPeriodUsage.objects.filter(agency_id=subscription.agency_id, closed_at__isnull=False)
        .order_by("-period_end")
        .first()
    )
    rollover_received = previous.rollover_generated or 0 if previous else 0

    return BillingPeriodUsage.objects.create(
        agency=subscription.agency,
        subscription=subscription,
        plan=subscription.plan,
        billing_interval=subscription.billing_interval,
        period_start=subscription.current_period_start,
        period_end=subscription.current_period_end,
        base_prompt_run_allowance=subscription.plan.prompt_runs_included,
        rollover_received=rollover_received,
    )


def close_billing_period(billing_period):
    """AVTR_SPEC §15/§16: run once a period has ended. Computes
    `rollover_generated` deterministically from this period's own
    numbers only, then marks it closed (immutable from here on except
    through an explicit admin correction). Idempotent -- closing an
    already-closed period just returns it unchanged."""
    if billing_period.closed_at is not None:
        return billing_period

    plan = billing_period.plan
    unused = max(0, billing_period.base_prompt_run_allowance - billing_period.prompt_runs_used)
    if plan.rollover_enabled:
        raw_rollover = math.floor(unused * (float(plan.rollover_percent) / 100))
        cap = math.floor(billing_period.base_prompt_run_allowance * (float(plan.rollover_cap_percent) / 100))
        rollover_generated = max(0, min(raw_rollover, cap))
    else:
        rollover_generated = 0

    billing_period.rollover_generated = rollover_generated
    billing_period.closed_at = timezone.now()
    billing_period.save(update_fields=["rollover_generated", "closed_at"])
    return billing_period


def schedule_due_today_pending(schedule, *, now=None):
    """(prompt, provider) pairs `schedule` still needs to execute for
    today's due date, in the schedule's own timezone -- excluding
    whatever's already been created for today (idempotency key already
    exists). Independent of whether `run_time` has actually arrived yet:
    a still-pending schedule's Prompt Runs are owed today from the
    moment its due date starts, not just once its run_time hits -- see
    today_reserved_prompt_runs. Returns [] for a schedule that isn't due
    today, has nothing left to run today, or has an unrecognized
    timezone. Mirrors the Celery dispatch tick's own due-today
    computation exactly (core/tasks.py's _process_schedule_tick, which
    calls this too), so "what's still owed today" is calculated exactly
    one way."""
    try:
        tz = ZoneInfo(schedule.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return []

    now_local = (now or timezone.now()).astimezone(tz)
    return schedule_pending_for_date(schedule, now_local.date())


def schedule_pending_for_date(schedule, day):
    """(prompt, provider) pairs `schedule` still owes for the execution
    date `day` (a date in the schedule's own timezone): [] if `day` isn't
    one of its execution dates or everything for it was already created.
    Same idempotency keys as the dispatch tick, so checking a past date
    (the late-occurrence catch-up in core/tasks.py) can't double-count."""
    from .models import PromptRun

    dates = calculate_schedule_dates(
        frequency=schedule.frequency,
        start_date=schedule.start_date,
        end_date=schedule.end_date,
        timezone=schedule.timezone,
        custom_interval_days=schedule.custom_interval_days,
    )
    if day not in dates.execution_dates:
        return []

    prompts = list(schedule.prompts.all())
    providers = schedule.providers or []
    if not prompts or not providers:
        return []

    pairs = [(p, provider) for p in prompts for provider in providers]
    expected_keys = {
        (p.id, provider): f"schedule:{schedule.id}:{day.isoformat()}:{p.id}:{provider}"
        for p, provider in pairs
    }
    existing_keys = set(
        PromptRun.objects.filter(idempotency_key__in=expected_keys.values()).values_list(
            "idempotency_key", flat=True
        )
    )
    return [pair for pair in pairs if expected_keys[(pair[0].id, pair[1])] not in existing_keys]


def today_reserved_prompt_runs(agency, *, exclude_schedule_id=None, now=None):
    """Total Prompt Runs today's ACTIVE schedules still owe for their own
    due-today occurrence -- reserved against a manual/bulk "Run Now" so
    it can't spend credits an already-committed schedule needs today.
    Deliberately only today's obligation, never the schedule's whole
    remaining lifetime at once: tomorrow's occurrence reserves itself
    tomorrow, the day it's actually due. `exclude_schedule_id` lets a
    schedule's own dispatch tick check what the *other* schedules have
    already claimed of today's budget without double-counting itself."""
    from .models import PromptSchedule

    schedules = PromptSchedule.objects.filter(agency=agency, status=PromptSchedule.Status.ACTIVE)
    if exclude_schedule_id is not None:
        schedules = schedules.exclude(id=exclude_schedule_id)
    return sum(len(schedule_due_today_pending(s, now=now)) for s in schedules.prefetch_related("prompts"))


def schedule_remaining_commitment(schedule, *, as_of=None):
    """Total Prompt Runs `schedule` will still draw from today (inclusive)
    through its own end_date: today's still-pending occurrence (see
    schedule_due_today_pending) plus every future due date's full
    prompt x provider count. Unlike today_reserved_prompt_runs (which
    only counts today, for gating a one-off manual run), this is the
    schedule's *whole remaining lifetime* draw -- what a brand new
    schedule needs to be weighed against so two recurring campaigns
    don't silently compete for the same plan allowance later."""
    try:
        tz = ZoneInfo(schedule.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return 0

    now_local = (as_of or timezone.now()).astimezone(tz)
    today_local = now_local.date()

    dates = calculate_schedule_dates(
        frequency=schedule.frequency,
        start_date=schedule.start_date,
        end_date=schedule.end_date,
        timezone=schedule.timezone,
        custom_interval_days=schedule.custom_interval_days,
    )
    runs_per_execution = schedule.prompts.count() * len(schedule.providers or [])
    if runs_per_execution == 0:
        return 0

    future_executions = len([d for d in dates.execution_dates if d > today_local])
    return len(schedule_due_today_pending(schedule, now=as_of)) + future_executions * runs_per_execution


def active_schedule_commitments(agency, *, exclude_schedule_id=None, as_of=None):
    """One entry per OTHER active schedule for `agency`: how many more
    Prompt Runs it still owes through its own end_date, how many it's
    already executed, and when it ends -- surfaced to the user when
    they're about to create a new schedule that would draw on the same
    plan allowance, so "you already have a schedule running that needs
    N more credits by <date>" is never a surprise discovered later when
    it (or the new schedule) gets paused for lack of budget."""
    from .models import PromptRun, PromptSchedule

    schedules = PromptSchedule.objects.filter(agency=agency, status=PromptSchedule.Status.ACTIVE)
    if exclude_schedule_id is not None:
        schedules = schedules.exclude(id=exclude_schedule_id)

    commitments = []
    for schedule in schedules.prefetch_related("prompts"):
        commitments.append(
            {
                "schedule_id": str(schedule.id),
                "client_id": str(schedule.client_id),
                "end_date": schedule.end_date,
                "executed_so_far": PromptRun.objects.filter(schedule=schedule).count(),
                "remaining_prompt_runs": schedule_remaining_commitment(schedule, as_of=as_of),
            }
        )
    return commitments


def record_usage(billing_period, count):
    """Atomic increment (F() expression, not read-modify-write) so
    concurrent dispatches for the same agency can't race each other into
    under-counting usage."""
    from .models import BillingPeriodUsage

    if count <= 0:
        return
    BillingPeriodUsage.objects.filter(pk=billing_period.pk).update(prompt_runs_used=F("prompt_runs_used") + count)
