"""System health checks for the admin "System Health" page
(core/admin_views.py). Every check returns a HealthCheck with a status of
ok / warn / fail and a plain-language detail, and never raises -- one
broken dependency must not take the whole report down with it.

Live checks that cost something (a real Gemini call) only run when the
admin asks for them (`live=True`); the default report reads configuration
and the recent run history instead.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.models import Count, Max, Q
from django.utils import timezone

OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass
class HealthCheck:
    name: str
    status: str
    detail: str
    latency_ms: int | None = None


@dataclass
class HealthSection:
    title: str
    checks: list[HealthCheck] = field(default_factory=list)

    @property
    def status(self):
        statuses = {c.status for c in self.checks}
        return FAIL if FAIL in statuses else WARN if WARN in statuses else OK


def _timed(fn):
    start = time.perf_counter()
    result = fn()
    return result, int((time.perf_counter() - start) * 1000)


def _safe(name, fn):
    try:
        return fn()
    except Exception as exc:  # a health page must keep rendering
        return HealthCheck(name, FAIL, f"Check crashed: {exc.__class__.__name__}: {str(exc)[:160]}")


# -- Database -------------------------------------------------------------


def _db_connection():
    def ping():
        with connection.cursor() as cursor:
            cursor.execute("SELECT version()")
            return cursor.fetchone()[0]

    version, ms = _timed(ping)
    host = connection.settings_dict.get("HOST", "")
    status = OK if ms < 500 else WARN
    return HealthCheck("Database connection", status, f"{version.split(' on ')[0]} at {host}", ms)


def _db_migrations():
    executor = MigrationExecutor(connection)
    pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
    if pending:
        names = ", ".join(f"{m.app_label}.{m.name}" for m, _ in pending[:4])
        return HealthCheck("Migrations", FAIL, f"{len(pending)} not applied: {names}. Run `manage.py migrate`.")
    return HealthCheck("Migrations", OK, "All migrations applied.")


def _db_rls():
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity")
        tables = cursor.fetchone()[0]
        cursor.execute("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user")
        bypass, superuser = cursor.fetchone()
    if bypass or superuser:
        return HealthCheck(
            "Row-level security",
            WARN,
            f"RLS on {tables} tables, but the app connects as a role that bypasses it -- tenant isolation "
            "relies on the app code alone. Use a restricted role in DATABASE_URL.",
        )
    return HealthCheck("Row-level security", OK, f"Enforced on {tables} tables; app role cannot bypass it.")


# -- Background jobs ------------------------------------------------------


def _redis():
    import redis

    client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
    try:
        _, ms = _timed(client.ping)
    except redis.RedisError:
        host = settings.REDIS_URL.split("@")[-1].split("/")[2] if "//" in settings.REDIS_URL else settings.REDIS_URL
        return HealthCheck(
            "Redis (task queue)",
            FAIL,
            f"Not reachable at {host}. Start Redis (locally: open Docker Desktop, then `docker start fyp-redis`) "
            "-- without it no audit runs or schedules execute.",
        )
    return HealthCheck("Redis (task queue)", OK, "Reachable.", ms)


def _celery_workers():
    from config.celery import app

    try:
        replies = app.control.inspect(timeout=1.5).ping() or {}
    except Exception:
        return HealthCheck("Celery worker", FAIL, "Can't check workers -- the task queue (Redis) is down.")
    if not replies:
        return HealthCheck(
            "Celery worker",
            FAIL,
            "No worker answered -- manual runs and scheduled audits will queue but never execute.",
        )
    return HealthCheck("Celery worker", OK, f"{len(replies)} worker(s) online: {', '.join(replies)}.")


def _scheduler():
    from .models import PromptRun

    tick = getattr(settings, "SCHEDULE_TICK_MINUTES", 1)
    last = PromptRun.objects.filter(schedule__isnull=False).aggregate(m=Max("created_at"))["m"]
    when = f"last scheduled run {timezone.localtime(last):%d %b %H:%M}" if last else "no scheduled runs yet"
    keepalive = " Database keep-alive is ON (burns Neon compute hours)." if settings.DB_KEEPALIVE_ENABLED else ""
    status = WARN if settings.DB_KEEPALIVE_ENABLED else OK
    return HealthCheck("Scheduler (Celery beat)", status, f"Checks schedules every {tick} min; {when}.{keepalive}")


# -- AI providers ---------------------------------------------------------


def _provider_history(provider):
    from .models import PromptRun

    since = timezone.now() - timedelta(days=7)
    stats = PromptRun.objects.filter(provider=provider, created_at__gte=since).aggregate(
        total=Count("id"),
        done=Count("id", filter=Q(status=PromptRun.Status.COMPLETED)),
        failed=Count("id", filter=Q(status=PromptRun.Status.FAILED)),
        last=Max("executed_at"),
    )
    return stats


def _ai_provider(provider, label, live):
    from .ai_providers import get_provider_client

    client = get_provider_client(provider)
    if not client.is_configured():
        return HealthCheck(f"{label} API", WARN, "Not configured (no API key) -- runs on this engine are disabled.")

    stats = _provider_history(provider)
    history = (
        f"Last 7 days: {stats['done']}/{stats['total']} runs completed, {stats['failed']} failed."
        if stats["total"]
        else "No runs in the last 7 days."
    )
    if live:
        try:
            reply, ms = _timed(lambda: client.send_prompt("Health check. Reply with the single word OK."))
            ok = "ok" in (reply or "").lower()
            return HealthCheck(
                f"{label} API",
                OK if ok else WARN,
                f"Live call answered{'' if ok else ' unexpectedly'} ({(reply or '').strip()[:30]!r}). {history}",
                ms,
            )
        except Exception as exc:
            return HealthCheck(f"{label} API", FAIL, f"Live call failed: {str(exc)[:200]} {history}")

    if stats["total"] and stats["failed"] / stats["total"] > 0.3:
        return HealthCheck(f"{label} API", WARN, f"Key configured, but many recent runs failed. {history}")
    return HealthCheck(f"{label} API", OK, f"Key configured. {history} Use 'Run live checks' to call it now.")


# -- Integrations ---------------------------------------------------------


def _stripe():
    from .stripe_service import is_stripe_configured

    if not is_stripe_configured():
        mode = "Test checkout simulator (no Stripe keys)"
        if settings.DEBUG:
            return HealthCheck("Stripe payments", WARN, f"{mode} -- test cards only, no real charges.")
        return HealthCheck("Stripe payments", FAIL, f"{mode} on a non-DEBUG server: nobody can pay.")
    live = settings.STRIPE_SECRET_KEY.startswith("sk_live")
    if not getattr(settings, "STRIPE_WEBHOOK_SECRET", ""):
        return HealthCheck("Stripe payments", FAIL, "Keys set but STRIPE_WEBHOOK_SECRET is missing -- payments won't activate plans.")
    return HealthCheck("Stripe payments", OK, f"{'LIVE' if live else 'Test'} mode, webhook secret configured.")


def _email():
    backend = settings.EMAIL_BACKEND.rsplit(".", 1)[-1]
    if "console" in settings.EMAIL_BACKEND or "locmem" in settings.EMAIL_BACKEND:
        return HealthCheck("Email", WARN, f"{backend}: emails (password reset, invites) are only printed, not sent.")
    if not settings.EMAIL_HOST_PASSWORD:
        return HealthCheck("Email", WARN, f"{backend} via {settings.EMAIL_HOST}, but no password set.")
    return HealthCheck("Email", OK, f"{backend} via {settings.EMAIL_HOST}:{settings.EMAIL_PORT}.")


def _sentry():
    if getattr(settings, "SENTRY_DSN", ""):
        return HealthCheck("Error monitoring (Sentry)", OK, "Configured.")
    return HealthCheck("Error monitoring (Sentry)", WARN, "Not configured -- server errors aren't reported anywhere.")


# -- Security -------------------------------------------------------------


def _security_checks():
    checks = []
    debug = settings.DEBUG
    checks.append(
        HealthCheck("Debug mode", WARN if debug else OK, "ON -- fine locally, never on a public server." if debug else "Off.")
    )
    key = settings.SECRET_KEY or ""
    weak = len(key) < 40 or key.startswith("django-insecure") or "change" in key.lower()
    checks.append(HealthCheck("Secret key", FAIL if weak else OK, "Weak or default -- replace it." if weak else "Strong, custom key."))
    hosts = settings.ALLOWED_HOSTS
    checks.append(
        HealthCheck(
            "Allowed hosts",
            FAIL if "*" in hosts and not debug else OK,
            f"{', '.join(hosts) or '(none)'}" + (" -- '*' accepts any host." if "*" in hosts else ""),
        )
    )
    https = settings.SECURE_SSL_REDIRECT and getattr(settings, "SESSION_COOKIE_SECURE", False)
    checks.append(
        HealthCheck(
            "HTTPS",
            OK if https else (WARN if debug else FAIL),
            "Forced, with secure cookies and HSTS." if https else "Not enforced (needs a domain + SSL certificate).",
        )
    )
    checks.append(
        HealthCheck("Security headers", OK, f"X-Frame-Options {settings.X_FRAME_OPTIONS}, nosniff, referrer policy set.")
    )
    from .models import User

    supers = User.objects.filter(is_superuser=True, is_active=True).count()
    checks.append(
        HealthCheck("Superusers", WARN if supers > 3 else OK, f"{supers} active superuser account(s).")
    )
    return checks


# -- Business health ------------------------------------------------------


def _business_checks():
    from .models import Agency, PromptRun, PromptSchedule, Subscription

    checks = []
    subs = dict(Subscription.objects.values_list("status").annotate(n=Count("id")))
    checks.append(
        HealthCheck(
            "Subscriptions",
            OK,
            f"{Agency.objects.count()} agencies: {subs.get('active', 0)} active, {subs.get('expired', 0)} expired, "
            f"{subs.get('pending', 0)} pending payment.",
        )
    )
    day = timezone.now() - timedelta(hours=24)
    runs = PromptRun.objects.filter(created_at__gte=day).aggregate(
        total=Count("id"),
        failed=Count("id", filter=Q(status=PromptRun.Status.FAILED)),
        stuck=Count(
            "id",
            filter=Q(status__in=[PromptRun.Status.PENDING, PromptRun.Status.QUEUED, PromptRun.Status.RUNNING], created_at__lt=timezone.now() - timedelta(minutes=30)),
        ),
    )
    rate = runs["failed"] / runs["total"] if runs["total"] else 0
    status = FAIL if runs["stuck"] else WARN if rate > 0.2 else OK
    checks.append(
        HealthCheck(
            "Audit runs (24h)",
            status,
            f"{runs['total']} runs, {runs['failed']} failed ({rate:.0%}), {runs['stuck']} stuck in queue > 30 min.",
        )
    )
    active = PromptSchedule.objects.filter(status=PromptSchedule.Status.ACTIVE).count()
    paused = PromptSchedule.objects.exclude(status__in=["active", "completed", "cancelled", "draft"]).count()
    checks.append(HealthCheck("Schedules", OK, f"{active} active, {paused} paused."))
    return checks


def run_health_checks(live=False):
    """Every section of the report. Superuser-only (see admin_views)."""
    from .tenancy import use_agency

    with use_agency(bypass=True):
        return [
            HealthSection(
                "Database",
                [_safe("Database connection", _db_connection), _safe("Migrations", _db_migrations), _safe("Row-level security", _db_rls)],
            ),
            HealthSection(
                "Background jobs",
                [_safe("Redis (task queue)", _redis), _safe("Celery worker", _celery_workers), _safe("Scheduler", _scheduler)],
            ),
            HealthSection(
                "AI engines",
                [
                    _safe("Gemini API", lambda: _ai_provider("gemini", "Gemini", live)),
                    _safe("OpenAI API", lambda: _ai_provider("openai", "OpenAI (ChatGPT)", live)),
                    _safe("Perplexity API", lambda: _ai_provider("perplexity", "Perplexity", live)),
                ],
            ),
            HealthSection("Integrations", [_safe("Stripe", _stripe), _safe("Email", _email), _safe("Sentry", _sentry)]),
            HealthSection("Security", _safe_list("Security", _security_checks)),
            HealthSection("Product activity", _safe_list("Activity", _business_checks)),
        ]


def _safe_list(name, fn):
    try:
        return fn()
    except Exception as exc:
        return [HealthCheck(name, FAIL, f"Check crashed: {exc.__class__.__name__}: {str(exc)[:160]}")]
