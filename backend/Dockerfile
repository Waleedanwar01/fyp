FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Shared by backend, celery_worker, and celery_beat (docker-compose.prod.yml
# all build this same image) -- celery in particular refuses to run as root
# without an explicit, discouraged C_FORCE_ROOT opt-in, so this creates a
# real unprivileged user instead of suppressing that warning. gunicorn's
# control socket and celery beat's schedule file both end up under this
# user's own home/working directory once USER switches, no extra config
# needed.
RUN useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /app/staticfiles \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Django's runserver is single-threaded and explicitly documented as
# unfit for production; gunicorn is what actually serves real traffic.
# $PORT is set by hosts like Render -- 8000 is the local/docker-compose
# fallback (matches EXPOSE above, though compose overrides this CMD
# with its own `command:` for local dev anyway).
# gthread: the dashboard fires several API calls at once; with plain sync
# workers they queued two at a time. Threads keep memory low on a small VPS.
CMD ["sh", "-c", "python manage.py collectstatic --noinput && python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --worker-class gthread --threads ${GUNICORN_THREADS:-4}"]
