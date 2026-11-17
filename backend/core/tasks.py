"""Celery tasks for prompt execution and subscription/billing upkeep.

`execute_prompt_run` sends a PromptRun's prompt to its real AI provider
(core/ai_providers.py) and carries it through queued -> running ->
completed/failed. `dispatch_scheduled_prompt_runs` does the scheduling
side: find PromptSchedules due today, validate the agency's
subscription and remaining Prompt Run usage, and create PromptRuns
(with idempotency protection) only if that's actually permitted --
pausing the schedule instead of ever allowing usage to go negative or
"overage".
"""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from celery import shared_task
from celery.utils.time import get_exponential_backoff_interval
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .ai_providers import AIProviderError, TransientAIProviderError, get_provider_client
from .billing import (
    close_billing_period,
    get_or_create_current_billing_period,
    schedule_due_today_pending,
    schedule_pending_for_date,
)
from .citations import store_citations
from .mention_citations import link_mention_citations
from .mention_detection import detect_mentions
from .models import (
    BillingPeriodUsage,
    Notification,
    PromptRun,
    PromptSchedule,
    Subscription,
)
from .prompt_building import build_effective_prompt
from .scheduling import calculate_schedule_dates
from .tenancy import use_agency
from .usage_tracking import refund_prompt_run_usage, track_prompt_run_usage

logger = logging.getLogger(__name__)


# Must match CELERY_BEAT_SCHEDULE's crontab(minute='*/5') in settings.py --
# this is the width of the idempotency bucket debug/manual dispatch keys
# itself into (unused by the schedule-driven path below, which keys off
# the calendar execution date instead -- see _process_schedule_tick).
DISPATCH_BUCKET_MINUTES = 5


@shared_task
def debug_task():
    """Zero-side-effect connectivity check: enqueue it, and if it comes
    back, Django -> Redis -> Celery worker is wired correctly end to end.
    Dev-only; not used by any real RankLens flow."""
    logger.info("debug_task ran -- Celery is wired up correctly.")
    return "debug_task ok"


MAX_PROMPT_RUN_RETRIES = 3
RETRY_BACKOFF_BASE_SECONDS = 1
RETRY_BACKOFF_MAX_SECONDS = 60


@shared_task(bind=True, max_retries=MAX_PROMPT_RUN_RETRIES)
def execute_prompt_run(self, prompt_run_id):
    """Runs one PromptRun end to end: QUEUED -> RUNNING -> a terminal
    state, sending its prompt to the real provider behind `provider`
    (core/ai_providers.py). Always dispatched via `.delay()` -- both
    from PromptViewSet.run()/run_bulk() for manual triggers and from
    _process_schedule_tick below for scheduled ones -- so this genuinely
    runs on a Celery worker in production; CELERY_TASK_ALWAYS_EAGER
    (settings.py) runs it inline instead only under `manage.py test`,
    where there's no broker.

    Three terminal states, chosen so a rough run is never lost silently:
    - COMPLETED: the provider returned real, non-blank text.
    - NEEDS_REVIEW: the provider call "succeeded" but the text back was
      blank/whitespace-only -- not trustworthy enough to call a real
      answer, but not worth losing either, so it's flagged rather than
      reported as a clean success.
    - FAILED: the provider call itself never produced a response, either
      because the failure was permanent (bad/missing credentials, an
      unrecognized provider, a malformed response -- AIProviderError) or
      because it was transient (timeout, 429, 5xx --
      TransientAIProviderError) and retrying it MAX_PROMPT_RUN_RETRIES
      times with exponential backoff (self.retry, below) still never
      got a usable response.

    `executed_at` is stamped once the run reaches a terminal state,
    marking when the provider call actually finished (as distinct from
    `created_at`, when it was queued) -- it's left blank while retries
    are still in flight, since execution hasn't actually finished yet.

    Idempotent: a PromptRun that's already COMPLETED (e.g. this ran once
    and a retried delivery picks up the same id) is left untouched
    rather than re-run and overwritten."""

    with use_agency(bypass=True):
        try:
            run = PromptRun.objects.get(id=prompt_run_id)
        except PromptRun.DoesNotExist:
            logger.warning("execute_prompt_run: PromptRun %s not found -- skipping.", prompt_run_id)
            return
        if run.status == PromptRun.Status.COMPLETED:
            return

        run.status = PromptRun.Status.RUNNING
        run.save(update_fields=["status"])

        try:
            client = get_provider_client(run.provider)
            # Never substitute a generated answer: a run either holds the
            # provider's real response or fails visibly (and is refunded).
            if not client.is_configured():
                raise AIProviderError(
                    f"{run.provider or 'No provider'} isn't configured -- add its API key to the environment."
                )
            response_text = client.send_prompt(build_effective_prompt(run.prompt_text, run.prompt))
        except TransientAIProviderError as exc:
            attempt = self.request.retries + 1
            if self.request.retries >= self.max_retries:
                logger.exception(
                    "execute_prompt_run: PromptRun %s failed permanently after %d attempt(s).", run.id, attempt
                )
                run.response_text = f"Failed after {attempt} attempts: {exc}"
                run.status = PromptRun.Status.FAILED
                run.executed_at = timezone.now()
                run.save(update_fields=["response_text", "status", "executed_at"])
                refund_prompt_run_usage(run.agency, count=1)
                return
            else:
                logger.warning(
                    "execute_prompt_run: transient failure for PromptRun %s (attempt %d/%d) -- retrying: %s",
                    run.id,
                    attempt,
                    self.max_retries + 1,
                    exc,
                )
                run.response_text = f"Attempt {attempt} failed ({exc}) -- retrying…"
                run.save(update_fields=["response_text"])
                countdown = get_exponential_backoff_interval(
                    factor=RETRY_BACKOFF_BASE_SECONDS,
                    retries=self.request.retries,
                    maximum=RETRY_BACKOFF_MAX_SECONDS,
                    full_jitter=True,
                )
                raise self.retry(exc=exc, countdown=countdown) from exc
        except AIProviderError as exc:
            logger.exception("execute_prompt_run: PromptRun %s failed.", run.id)
            run.response_text = str(exc)
            run.status = PromptRun.Status.FAILED
            run.executed_at = timezone.now()
            run.save(update_fields=["response_text", "status", "executed_at"])
            refund_prompt_run_usage(run.agency, count=1)
            return


        if response_text and response_text.strip():
            run.response_text = response_text
            run.status = PromptRun.Status.COMPLETED
        else:
            run.response_text = "The provider returned an empty response -- flagged for review, not marked complete."
            run.status = PromptRun.Status.NEEDS_REVIEW

        run.executed_at = timezone.now()
        run.save(update_fields=["response_text", "status", "executed_at"])

        if run.status == PromptRun.Status.COMPLETED:
            # Only a genuine, non-blank answer is worth scanning for
            # brand/competitor mentions or citations -- FAILED holds
            # our own error text (which can itself contain a URL, e.g.
            # a rate-limit docs link -- never a real citation), and
            # NEEDS_REVIEW's blank response has nothing to find either
            # way. `client` (the same provider that just answered the
            # prompt) is reused for sentiment classification's
            # AI-assisted stage. link_mention_citations runs last since
            # it needs both the Mention and Citation rows to already
            # exist.
            #
            # The run itself already succeeded and is saved as COMPLETED
            # above -- a bug or transient error in this analysis stage
            # (mention/citation detection) is a secondary, best-effort
            # layer on top of that real answer, not a reason to lose it
            # or leave the whole task in an unhandled-exception state.
            # Left unguarded, an exception here would otherwise propagate
            # out of an already-COMPLETED run, and a later retry of this
            # same task would just no-op straight past the early
            # COMPLETED check above -- silently leaving that run's
            # mentions/citations partially populated forever.
            try:
                detect_mentions(run, client)
                store_citations(run)
                link_mention_citations(run)
            except Exception:
                logger.exception(
                    "execute_prompt_run: mention/citation analysis failed for PromptRun %s -- "
                    "the run is still COMPLETED with a real response, but its mention/citation "
                    "data may be incomplete.",
                    run.id,
                )


def _process_schedule_tick(schedule, force_run=False):
    """One ACTIVE PromptSchedule, one tick. Returns a short reason string
    for logging/testing -- never raises for an expected "nothing to do
    here" case, only for a genuine bug.
    If force_run=True, bypasses run_time checks and dispatches immediately."""
    try:
        tz = ZoneInfo(schedule.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Schedule %s has an invalid timezone %r -- skipping.", schedule.id, schedule.timezone)
        return "invalid_timezone"

    now_local = timezone.now().astimezone(tz)
    today_local = now_local.date()

    dates = calculate_schedule_dates(
        frequency=schedule.frequency,
        start_date=schedule.start_date,
        end_date=schedule.end_date,
        timezone=schedule.timezone,
        custom_interval_days=schedule.custom_interval_days,
    )

    # A run due shortly before midnight can fall between the last tick of
    # its day and the first tick of the next (SCHEDULE_TICK_MINUTES=60
    # ticks on the hour, so 23:30 would never be seen). Pick it up on the
    # first tick after midnight; same idempotency key, so never doubled.
    late_result = None
    if not force_run:
        late_day = _late_occurrence(schedule, dates, now_local, tz)
        if late_day is not None:
            late_missing = schedule_pending_for_date(schedule, late_day)
            if late_missing:
                late_result = _dispatch_occurrence(schedule, dates, late_day, late_missing, today_local)
                if late_result.startswith("paused"):
                    return late_result

    if not force_run and today_local not in dates.execution_dates:
        if dates.last_execution and today_local > dates.last_execution:
            _complete_if_last_execution(schedule, dates, today_local)
            return late_result or "completed_past_end"
        return late_result or "not_due_today"

    prompts = list(schedule.prompts.all())
    providers = schedule.providers or []
    if not prompts or not providers:
        logger.warning("Schedule %s is due today but has no prompts/providers -- skipping.", schedule.id)
        return "nothing_to_run"

    missing = schedule_due_today_pending(schedule, now=now_local)

    if not missing:
        if force_run:
            missing = [(p, provider) for p in prompts for provider in providers]
        else:
            _complete_if_last_execution(schedule, dates, today_local)
            return late_result or "already_executed_today"

    if not force_run and now_local.time() < schedule.run_time:
        # Due today, but its run_time hasn't arrived yet in the
        # schedule's own timezone -- picked up again on a later tick
        # once it has. Never marks the schedule complete here even if
        # today is the last execution date -- that only happens once
        # this date's run has actually fired.
        return late_result or "not_yet_time"

    return _dispatch_occurrence(schedule, dates, today_local, missing, today_local, force_run=force_run)


def _late_occurrence(schedule, dates, now_local, tz):
    """Yesterday's execution date, if its run_time was recent enough that
    no tick could have fired between it and midnight -- i.e. within one
    tick interval (plus slack) of now. Older misses (e.g. the server was
    down for days) are deliberately not caught up: replaying them would
    spend Prompt Runs the agency never saw happen."""
    yesterday = now_local.date() - timedelta(days=1)
    if yesterday not in dates.execution_dates:
        return None
    due_at = datetime.combine(yesterday, schedule.run_time, tzinfo=tz)
    grace = timedelta(minutes=getattr(settings, "SCHEDULE_TICK_MINUTES", 1) + 5)
    if not (due_at <= now_local <= due_at + grace):
        return None
    return yesterday


def _dispatch_occurrence(schedule, dates, exec_date, missing, today_local, *, force_run=False):
    """Create (and bill) the PromptRuns for one execution date of a
    schedule, after checking the subscription and remaining allowance."""
    try:
        subscription = schedule.agency.subscription
    except Subscription.DoesNotExist:
        logger.warning("Schedule %s has no subscription for agency %s -- pausing.", schedule.id, schedule.agency_id)
        schedule.status = PromptSchedule.Status.PAUSED
        schedule.save(update_fields=["status"])
        return "paused_no_subscription"

    if not subscription.is_usable():
        logger.info("Schedule %s paused: subscription status is %s.", schedule.id, subscription.status)
        schedule.status = PromptSchedule.Status.PAUSED
        schedule.save(update_fields=["status"])
        return "paused_subscription_inactive"

    billing_period = get_or_create_current_billing_period(subscription)
    if billing_period.prompt_runs_remaining < len(missing):
        logger.info(
            "Schedule %s paused: needs %d Prompt Run(s), only %d remaining this billing period.",
            schedule.id,
            len(missing),
            billing_period.prompt_runs_remaining,
        )
        schedule.status = PromptSchedule.Status.PAUSED_LIMIT_REACHED
        schedule.save(update_fields=["status"])
        return "paused_limit_reached"

    created_count = 0
    now_ts = int(timezone.now().timestamp())
    for prompt, provider in missing:
        if force_run:
            key = f"schedule:{schedule.id}:{exec_date.isoformat()}:{now_ts}:{prompt.id}:{provider}"
        else:
            key = f"schedule:{schedule.id}:{exec_date.isoformat()}:{prompt.id}:{provider}"
        try:
            with transaction.atomic():
                run, created = PromptRun.objects.get_or_create(
                    idempotency_key=key,
                    defaults={
                        "agency": schedule.agency,
                        "prompt": prompt,
                        "prompt_text": prompt.text,
                        "provider": provider,
                        "schedule": schedule,
                        "status": PromptRun.Status.QUEUED,
                    },
                )
        except IntegrityError:
            # Lost a race with another worker handling the same retried
            # tick -- the row it created is the one that matters.
            run = PromptRun.objects.get(idempotency_key=key)
            created = False

        if created:
            created_count += 1
            if settings.DEBUG or getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
                execute_prompt_run.apply(args=[str(run.id)])
            else:
                try:
                    execute_prompt_run.delay(str(run.id))
                except Exception:
                    execute_prompt_run.apply(args=[str(run.id)])

    if created_count:
        track_prompt_run_usage(schedule.agency, "schedule", count=created_count)
        _notify_schedule_started(schedule, created_count)

    _complete_if_last_execution(schedule, dates, today_local)
    return f"dispatched_{created_count}"


def _notify_schedule_started(schedule, created_count):
    """One dashboard-facing Notification per dispatch that actually
    created something (AVTR_SPEC follow-up) -- lets a user watching the
    dashboard see, in plain language, that a schedule they set up really
    did fire today, without having to know Celery/Redis exist. Never
    raises: a notification failing to save is a nice-to-have miss, not a
    reason to fail (and re-bill, on retry) an otherwise-successful
    dispatch."""
    run_word = "Prompt Run" if created_count == 1 else "Prompt Runs"
    try:
        Notification.objects.create(
            agency=schedule.agency,
            schedule=schedule,
            type=Notification.Type.SCHEDULE_STARTED,
            message=(
                f"Your schedule for {schedule.client.name} just started running "
                f"-- {created_count} {run_word} created."
            ),
        )
    except Exception:
        logger.exception("Failed to create a start notification for schedule %s.", schedule.id)


def _complete_if_last_execution(schedule, dates, today_local):
    if dates.last_execution and today_local >= dates.last_execution and schedule.status == PromptSchedule.Status.ACTIVE:
        schedule.status = PromptSchedule.Status.COMPLETED
        schedule.save(update_fields=["status"])


@shared_task
def dispatch_scheduled_prompt_runs():
    """Celery Beat periodic task (see CELERY_BEAT_SCHEDULE in settings).
    Finds every ACTIVE PromptSchedule and, for each one that's actually
    due today (in its own timezone, per calculate_schedule_dates), tries
    to create the PromptRuns for that execution -- one per prompt x
    provider (AVTR_SPEC §28) -- but only if the agency's subscription is
    usable and enough included Prompt Runs remain; otherwise the
    schedule is paused (never partially billed/executed) and nothing new
    is created.

    Idempotency (AVTR_SPEC §27/§29): each (schedule, prompt, provider,
    calendar execution date) tuple maps to exactly one deterministic key,
    so a retried tick (worker restart mid-task, Celery's own retry) can
    never create -- or bill -- a duplicate PromptRun for the same due
    execution, no matter how many times it's retried."""
    processed = 0
    with use_agency(bypass=True):
        schedules = list(PromptSchedule.objects.filter(status=PromptSchedule.Status.ACTIVE).select_related("agency"))
        for schedule in schedules:
            _process_schedule_tick(schedule)
            processed += 1
    logger.info("dispatch_scheduled_prompt_runs: processed %d active schedule(s).", processed)
    return processed


@shared_task
def expire_overdue_subscriptions():
    """AVTR_SPEC §13: a subscription whose current_period_end has passed
    without being renewed moves to EXPIRED and its live schedules pause
    (PAUSED_SUBSCRIPTION, so renewal can bring them back). No data is
    ever deleted -- the dashboard stays readable, just locked for changes.

    Auto-renew first: an agency that opted in with a still-valid card on
    file is charged (test-mode simulator) and starts a fresh period
    instead. With real Stripe, Stripe renews and the webhook updates it."""
    from .billing import activate_subscription

    expired = 0
    renewed = 0
    paused_schedules = 0
    today = timezone.now().date()

    with use_agency(bypass=True):
        overdue = Subscription.objects.filter(
            status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIALING],
            current_period_end__lt=today,
        ).select_related("plan", "agency")
        for subscription in overdue:
            price = (
                subscription.plan.yearly_price_usd
                if subscription.billing_interval == Subscription.BillingInterval.YEARLY
                else subscription.plan.monthly_price_usd
            )
            card = f"{(subscription.card_brand or 'card').title()} ending {subscription.card_last4}"
            if subscription.auto_renew and subscription.has_valid_card(today):
                activate_subscription(subscription)
                renewed += 1
                _notify_billing(
                    subscription,
                    Notification.Type.SUBSCRIPTION_RENEWED,
                    f"Your {subscription.plan.name} plan renewed automatically -- ${price} charged to your {card}. "
                    f"Next renewal on {subscription.current_period_end:%d %b %Y}.",
                )
                continue

            subscription.status = Subscription.Status.EXPIRED
            subscription.save(update_fields=["status"])
            expired += 1

            live_schedules = PromptSchedule.objects.filter(
                agency_id=subscription.agency_id,
                status__in=[PromptSchedule.Status.ACTIVE, PromptSchedule.Status.PAUSED_LIMIT_REACHED],
            )
            paused_schedules += live_schedules.update(status=PromptSchedule.Status.PAUSED_SUBSCRIPTION)

            if subscription.auto_renew:
                _notify_billing(
                    subscription,
                    Notification.Type.SUBSCRIPTION_RENEWAL_FAILED,
                    f"Auto-renew failed: your {card} has expired. Your dashboard is read-only until you renew "
                    "with a new card.",
                )
            else:
                _notify_billing(
                    subscription,
                    Notification.Type.SUBSCRIPTION_EXPIRED,
                    f"Your {subscription.plan.name} plan has expired. Your data is safe and still visible -- "
                    "renew to run audits and make changes again.",
                )

    logger.info(
        "expire_overdue_subscriptions: renewed %d, expired %d subscription(s), paused %d schedule(s).",
        renewed,
        expired,
        paused_schedules,
    )
    return expired


def _notify_billing(subscription, type_, message):
    """Never raises: a missing notification must not undo a renewal."""
    try:
        Notification.objects.create(agency=subscription.agency, type=type_, message=message)
    except Exception:
        logger.exception("Failed to create a billing notification for agency %s.", subscription.agency_id)


@shared_task
def close_expired_billing_periods():
    """AVTR_SPEC §15/§16: closes every BillingPeriodUsage whose
    period_end has passed, computing and storing its rollover_generated
    deterministically (see core.billing.close_billing_period). Idempotent
    -- an already-closed period is left untouched."""
    closed = 0
    today = timezone.now().date()

    with use_agency(bypass=True):
        due = BillingPeriodUsage.objects.filter(closed_at__isnull=True, period_end__lt=today)
        for period in due:
            close_billing_period(period)
            closed += 1

    logger.info("close_expired_billing_periods: closed %d period(s).", closed)
    return closed


@shared_task
def ping_database():
    """Keeps the database compute from auto-suspending due to inactivity
    (Neon's serverless Postgres scales to zero after a few minutes idle
    on the free tier -- see CELERY_BEAT_SCHEDULE). Deliberately ticks
    more often than that idle timeout so there's never a gap long enough
    to trigger it; a suspended compute waking back up mid-request was
    causing intermittent, hard-to-reproduce failures elsewhere in the
    app. Cheapest possible real query -- no writes, no side effects."""
    from .models import Agency

    with use_agency(bypass=True):
        Agency.objects.exists()
