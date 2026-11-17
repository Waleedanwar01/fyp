"""
Django settings for config project.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

from celery.schedules import crontab
from dotenv import load_dotenv

load_dotenv()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# -----------------------------------------------------------------------
# SECURITY / CORE
# -----------------------------------------------------------------------

SECRET_KEY = os.environ.get('SECRET_KEY')

DEBUG = os.environ.get('DEBUG', 'False') == 'True'

ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',') if h.strip()
]


# -----------------------------------------------------------------------
# APPLICATION DEFINITION
# -----------------------------------------------------------------------

INSTALLED_APPS = [
    # Django defaults
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',

    # Local apps
    'core',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',   # must be first (or near top)
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # serves static/admin assets under gunicorn -- runserver's DEBUG-only auto-serving doesn't apply in production
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'core.middleware.AgencyContextMiddleware',  # after auth: needs request.user resolved for the admin/session path
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# -----------------------------------------------------------------------
# DATABASE (Neon PostgreSQL, via DATABASE_URL in .env)
#
# Two roles, two URLs: DATABASE_URL is a restricted app role (no
# BYPASSRLS) used for everything at runtime, so PostgreSQL row-level
# security (see core/migrations/0003_row_level_security.py) genuinely
# applies to our own traffic instead of being silently bypassed by an
# elevated "owner" role. MIGRATE_DATABASE_URL is that more privileged
# owner role, used only for schema changes (migrate/makemigrations/etc,
# which need DDL rights the restricted role intentionally doesn't have).
# Falls back to DATABASE_URL if MIGRATE_DATABASE_URL isn't set, so this
# is backward-compatible with environments (Docker/CI) that haven't been
# split into two roles yet.
# -----------------------------------------------------------------------

_MIGRATION_COMMANDS = {"migrate", "makemigrations", "sqlmigrate", "showmigrations"}
_is_migration_command = len(sys.argv) > 1 and sys.argv[1] in _MIGRATION_COMMANDS
_is_test_command = len(sys.argv) > 1 and sys.argv[1] == 'test'

# `manage.py test` runs the ~500-test suite against a local Postgres
# container (docker-compose's postgres-test service) instead of the
# real Neon database whenever TEST_DATABASE_URL is set -- dozens of
# full-suite runs a week against a remote serverless Postgres burns
# real compute-hours for no benefit (a local container is also just
# faster, no network round-trip per query). Opt-in and backward-
# compatible: falls back to the real DATABASE_URL/MIGRATE_DATABASE_URL
# when TEST_DATABASE_URL isn't configured.
if _is_test_command and os.getenv("TEST_DATABASE_URL"):
    _database_url = os.getenv("TEST_DATABASE_URL")
else:
    _database_url = os.getenv("MIGRATE_DATABASE_URL") if _is_migration_command else None
    _database_url = _database_url or os.getenv("DATABASE_URL")

tmpPostgres = urlparse(_database_url)

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': tmpPostgres.path.replace('/', ''),
        'USER': tmpPostgres.username,
        'PASSWORD': tmpPostgres.password,
        'HOST': tmpPostgres.hostname,
        'PORT': tmpPostgres.port or 5432,
        'OPTIONS': dict(parse_qsl(tmpPostgres.query)),
        # Seconds to keep a connection open for reuse between requests
        # (0 = new connection per request). Reuse saves the TLS handshake,
        # but an idle open connection can stop Neon from suspending and
        # burn compute hours, so it's opt-in: set DB_CONN_MAX_AGE=60 with
        # the self-hosted database. Safe with row-level security -- every
        # request sets its own agency context (core/middleware.py).
        'CONN_MAX_AGE': int(os.environ.get('DB_CONN_MAX_AGE', '0')),
        'CONN_HEALTH_CHECKS': True,
    }
}


# -----------------------------------------------------------------------
# PASSWORD VALIDATION
# -----------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# -----------------------------------------------------------------------
# INTERNATIONALIZATION
# -----------------------------------------------------------------------

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


# -----------------------------------------------------------------------
# STATIC & MEDIA FILES
# -----------------------------------------------------------------------

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'          # collectstatic target (production)
STATICFILES_DIRS = [BASE_DIR / 'static']        # your own static source files (dev)

# WhiteNoise serves STATIC_ROOT directly from the app process -- no
# separate static file host/CDN needed for a project this size yet.
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'                 # uploaded files (logos, report PDFs, etc.)

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'core.User'


# -----------------------------------------------------------------------
# HTTPS / BROWSER HARDENING (production)
#
# Cookies are only used by Django admin (the API itself uses bearer
# tokens), but they must never travel over plain HTTP in production.
# HSTS and the HTTPS redirect are opt-in via env because TLS may be
# terminated upstream (e.g. Cloudflare Tunnel -> nginx on :80), where a
# blanket redirect inside Django would loop.
# -----------------------------------------------------------------------

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', '0'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get('SECURE_HSTS_INCLUDE_SUBDOMAINS', 'False') == 'True'
SECURE_SSL_REDIRECT = os.environ.get('SECURE_SSL_REDIRECT', 'False') == 'True'
if os.environ.get('TRUST_X_FORWARDED_PROTO', 'False') == 'True':
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',') if o.strip()
]


# -----------------------------------------------------------------------
# CORS (Next.js frontend access)
# -----------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get('CORS_ALLOWED_ORIGINS', 'http://localhost:3000').split(',') if o.strip()
]

CORS_ALLOW_CREDENTIALS = True


# -----------------------------------------------------------------------
# EMAIL (password reset links)
#
# Defaults to the console backend (reset emails print to the server log)
# so local dev works with zero setup. Set EMAIL_BACKEND to the SMTP
# backend in .env to send through a real provider (Resend, etc.) -- same
# EMAIL_HOST_PASSWORD env var holds the provider's API key regardless of
# provider, since Resend/SendGrid/etc. all authenticate their SMTP relay
# with "the API key as the password".
# -----------------------------------------------------------------------

EMAIL_BACKEND = os.environ.get('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.resend.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', 'resend')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'no-reply@avtr.local')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')


# -----------------------------------------------------------------------
# DJANGO REST FRAMEWORK + JWT
# -----------------------------------------------------------------------

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'core.authentication.RequestCachedJWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'login': '5/min',
        'register': '5/min',
        'password_reset': '3/min',
        'email_verification': '3/min',
        'change_password': '5/min',
        'team_invite': '10/min',
    },
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=60),
    # Backstop only: a rotated refresh token still can't outlive 24h from its
    # own reissue. The real 24-hour-since-login cap (which this alone can't
    # enforce, since rotation keeps pushing this window out) is
    # core.serializers.CustomTokenRefreshSerializer, keyed off the
    # `session_start` claim stamped at login.
    'REFRESH_TOKEN_LIFETIME': timedelta(hours=24),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}


# -----------------------------------------------------------------------
# CELERY + REDIS
#
# Broker and result backend are the same Redis instance -- fine at this
# scale, and one fewer moving part than running a separate result store.
# CELERY_BEAT_SCHEDULE is a skeleton: dispatch_scheduled_prompt_runs
# doesn't do real dispatching yet (see core/tasks.py), so the tick
# interval here only needs to be often enough to prove Beat is alive in
# dev, not tuned for a real workload yet.
# -----------------------------------------------------------------------

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

# Broker/result backend default to REDIS_URL (the common case: one Redis
# for everything) but can be pointed elsewhere independently if needed --
# e.g. a separate result-backend instance -- without touching REDIS_URL
# itself, which other code may still read directly.
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', REDIS_URL)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Without an explicit socket timeout, a broker that's unreachable (down,
# or just never started in local dev) can leave a connection attempt
# hanging far longer than kombu's own broker_connection_timeout intends
# to allow (observed: 30s+ against a silently-dropping port on Windows,
# instead of failing fast with connection-refused). This bounds every
# broker socket op -- worker/beat's own reconnect loop included -- to a
# few seconds, so nothing making a `.delay()` call in-request (see
# PromptViewSet.run) can ever be stuck waiting on it for long.
CELERY_BROKER_TRANSPORT_OPTIONS = {'socket_connect_timeout': 1, 'socket_timeout': 1}

# How often Beat checks for due schedules. Every query wakes a serverless
# database (Neon bills compute for every hour it's awake), so on Neon set
# this to 10-15; on a self-hosted Postgres every minute costs nothing.
SCHEDULE_TICK_MINUTES = max(1, int(os.environ.get('SCHEDULE_TICK_MINUTES', '1')))

# Opt-in keep-alive (core.tasks.ping_database). It stops Neon from ever
# suspending -- which avoids cold starts but burns ~6 compute-hours a day,
# i.e. the whole free-tier allowance in about two weeks. Off by default.
DB_KEEPALIVE_ENABLED = os.environ.get('DB_KEEPALIVE_ENABLED', 'False') == 'True'

CELERY_BEAT_SCHEDULE = {
    'dispatch-scheduled-prompt-runs': {
        'task': 'core.tasks.dispatch_scheduled_prompt_runs',
        'schedule': crontab(minute='*' if SCHEDULE_TICK_MINUTES == 1 else f'*/{SCHEDULE_TICK_MINUTES}'),
    },
    # Both of these are date-based (not time-of-day sensitive), so once
    # a day is plenty -- deliberately staggered a few minutes apart so
    # a subscription that expires today is marked EXPIRED (and its
    # schedules paused) before its now-stale billing period gets closed.
    'expire-overdue-subscriptions': {
        'task': 'core.tasks.expire_overdue_subscriptions',
        'schedule': crontab(hour=0, minute=10),
    },
    'close-expired-billing-periods': {
        'task': 'core.tasks.close_expired_billing_periods',
        'schedule': crontab(hour=0, minute=15),
    },
}
if DB_KEEPALIVE_ENABLED:
    CELERY_BEAT_SCHEDULE['ping-database'] = {
        'task': 'core.tasks.ping_database',
        'schedule': crontab(minute='*/2'),
    }

# `manage.py test` has no broker to talk to (and shouldn't need one just
# to exercise a view that happens to call .delay()) -- eager mode runs
# the task body inline instead of round-tripping it through Redis, same
# as calling the task function directly. (_is_test_command is defined
# above, alongside the test-database switch, since both need it.)
CELERY_TASK_ALWAYS_EAGER = _is_test_command


# -----------------------------------------------------------------------
# THIRD-PARTY API KEYS (read in code via os.environ, kept here for reference)
# -----------------------------------------------------------------------

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
# Optional comma-separated model override, e.g. 'gemini-3.8-flash,gemini-flash-latest'.
GEMINI_MODELS = os.environ.get('GEMINI_MODELS', '')
# Off by default -- see GeminiProviderClient's docstring (core/ai_providers.py):
# requesting search grounding on a key without billing enabled makes the
# *entire* Gemini call 429, not just skip citations. Flip to true once
# billing is confirmed enabled on the Google Cloud project in use.
GEMINI_SEARCH_GROUNDING_ENABLED = os.environ.get('GEMINI_SEARCH_GROUNDING_ENABLED', 'false').lower() == 'true'

# AI visibility is sampled monitoring, not a guaranteed ranking -- a name
# match below this confidence (core.matching.compute_match_confidence) is
# stored as a Mention like any other, but with needs_review=True, so it's
# surfaced as "uncertain" rather than presented as a confirmed detection.
# 0.0-1.0; configurable per deployment without a code change.
MENTION_CONFIDENCE_REVIEW_THRESHOLD = float(os.environ.get('MENTION_CONFIDENCE_REVIEW_THRESHOLD', '0.5'))

# A developer's local .env may have real provider keys (needed to test
# against them by hand) -- those must never leak into the test suite as
# an ambient "provider is configured", since that would make tests that
# assume otherwise flaky (or start making real, unmocked network calls).
# Individual tests opt back in explicitly via
# @override_settings(OPENAI_API_KEY=...)/(GEMINI_API_KEY=...).
if _is_test_command:
    OPENAI_API_KEY = ''
    GEMINI_API_KEY = ''

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY')
STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET')

SENTRY_DSN = os.environ.get('SENTRY_DSN')