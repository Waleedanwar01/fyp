# RankLens

White-label AI-visibility tracking & reporting platform for digital marketing agencies. Tracks how client brands and competitors are mentioned, positioned, and cited in AI-generated responses.

**Stack:** Django + DRF (backend/API), PostgreSQL, Celery + Redis (background jobs), Next.js + TypeScript (frontend).

## Quick start (Docker)

This is the fastest way to get the backend running locally — no local Python/Postgres/Redis install required.

**Requirements:** Docker Desktop (or Docker Engine + Compose) installed and running.

From the repository root (where `docker-compose.yml` lives):

```bash
docker compose up --build
```

That's it. This one command:

- Builds the backend image and starts it with hot-reload (edits under `backend/` are picked up automatically, no rebuild/restart needed)
- Starts PostgreSQL and Redis containers alongside it
- Runs database migrations automatically before the server starts

The API is then available at **<http://localhost:8000>**, with the Django admin at <http://localhost:8000/admin/>.

To also populate a couple of sample agencies with test data (clients, brands, competitors, prompts):

```bash
docker compose exec backend python manage.py seed_dev_data
```

To create your own superuser for the admin panel:

```bash
docker compose exec backend python manage.py createsuperuser
```

Stop the stack with `Ctrl+C`, or `docker compose down` to also remove the containers (add `-v` to also wipe the database volume).

The Docker stack uses its own self-contained dev settings (defined directly in `docker-compose.yml`) — it does **not** read `backend/.env`, so it works out of the box on a fresh clone with no extra setup.

## Running without Docker

For native local development (e.g. against the project's real Neon Postgres instance instead of a local container):

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env         # then fill in real values
python manage.py migrate
python manage.py runserver
```

`DATABASE_URL` should point at a **restricted** DB role (no `BYPASSRLS`/superuser) — that's what makes PostgreSQL row-level security (`core/migrations/0003_row_level_security.py`) actually apply to the app's own traffic. `MIGRATE_DATABASE_URL` is a separate, more privileged owner-role connection used only by `migrate`/`makemigrations`/etc. (`config/settings.py` routes automatically based on which management command is running). See `.env.example` for both.

Frontend (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

## Tests & linting

```bash
cd backend
python manage.py test core   # add --keepdb when testing against Neon (see note below)
ruff check .
```

> Note: use Neon's **direct** (non `-pooler`) host in both `DATABASE_URL` and `MIGRATE_DATABASE_URL`. Its PgBouncer-style pooler doesn't reliably preserve session state (`SET`/`set_config`) across requests, which row-level security depends on — confirmed this empirically, a value set in one connection leaked into an apparently-unrelated later one. The pooler also blocks Django's test-database teardown, so `manage.py test` against Neon needs `--keepdb` regardless.

## Multi-tenant data isolation

Every `Client`/`Brand`/`Competitor`/`Prompt` row carries its own `agency` FK and is protected two independent ways:

1. **ORM-level** (`AgencyAutoScopedManager` in `core/models.py`): querysets on these models filter automatically to the "current agency," tracked per-request via `core/tenancy.py` and set by `AgencyContextMiddleware`. A view that forgets to scope a queryset explicitly still can't leak another agency's rows.
2. **Database-level** (`core/migrations/0003_row_level_security.py`): PostgreSQL row-level security, `FORCE`d so it applies even to the app's own connection — a backstop against anything the ORM layer might miss, including raw SQL.

Outside of a request (management commands, the Django shell, scripts), nothing sets the ambient context automatically — wrap direct access to these tables in `core.tenancy.use_agency(agency)` or `use_agency(bypass=True)` (see `seed_dev_data` for an example), or RLS will reject it.

**Known gap:** this is only genuinely enforced when connecting as a role without `BYPASSRLS`/superuser — true for the dedicated `avtr_app` role on Neon (see above) and for CI (`.github/workflows/backend-ci.yml` creates a restricted `ci_app` role before running tests, specifically so the RLS tests can't silently pass by being bypassed). **Not yet** true for `docker-compose up` locally, where Postgres's official image makes its bootstrap user a superuser — the ORM-level safeguard and `IsAgencyMember` permission still apply there; only the database-level backstop is inert until it gets the same restricted-role treatment.

## CI

Every push runs `.github/workflows/backend-ci.yml`: installs backend dependencies, runs `ruff check`, and runs the Django test suite against a throwaway Postgres service container.

## Project structure

```text
backend/    Django + DRF API (see backend/core/ for models, views, permissions)
frontend/   Next.js + TypeScript app
docs/       Screenshots and other reference material
PROGRESS.md Client-facing development log
```
