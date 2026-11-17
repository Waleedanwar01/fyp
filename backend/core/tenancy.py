"""Ambient "current agency" context, shared by two independent safeguards:

1. `AgencyAutoScopedManager` (core/models.py) reads it in Python to
   automatically filter querysets, catching a view that forgot to scope
   a queryset explicitly.
2. PostgreSQL row-level-security policies (see the 0003 migration) read
   the *same* value via a session variable, enforced by the database
   itself even against the app's own connection -- catching everything
   the ORM layer might miss, including raw SQL.

`AgencyContextMiddleware` sets this automatically for every real HTTP
request. Outside of a request -- management commands, the Django shell,
scripts -- nothing sets it by default, so the ORM-level filter is a
no-op (existing code keeps working) but PostgreSQL's RLS still enforces
fail-closed on Client/Brand/Competitor/Prompt, since those tables use
FORCE ROW LEVEL SECURITY. Anything writing to those tables outside a
request must opt in explicitly with `use_agency(...)`.
"""

import contextvars

from django.db import connection

_UNSET = object()

_current_agency_id = contextvars.ContextVar("current_agency_id", default=_UNSET)
_bypass = contextvars.ContextVar("bypass_agency_scope", default=False)


def context_is_set():
    """True once something (middleware, or an explicit use_agency block)
    has established a context in this async task / thread."""
    return _current_agency_id.get() is not _UNSET


def current_agency_id():
    """The active agency's id, or None if the context is unset OR was
    explicitly established with no agency (fail-closed case). Callers
    that need to tell those two apart should check context_is_set()
    first."""
    value = _current_agency_id.get()
    return None if value is _UNSET else value


def is_bypassing():
    return _bypass.get()


class use_agency:
    """Scopes both the ORM's automatic filtering and PostgreSQL's RLS
    policies to `agency` for the duration of the `with` block.

    - `use_agency(some_agency)` -- restrict to that agency only.
    - `use_agency(bypass=True)` -- trusted cross-tenant context (used by
      AgencyContextMiddleware for platform superusers, and by scripts
      like seed_dev_data that intentionally touch multiple agencies).
    - `use_agency()` -- no agency, no bypass: fail closed. Used by the
      middleware for unauthenticated/non-agency requests.

    Required around any *direct* ORM or raw-SQL access to Client/Brand/
    Competitor/Prompt from outside an HTTP request -- those tables
    reject unscoped writes/reads at the database level once RLS is on.
    """

    def __init__(self, agency=None, *, bypass=False):
        self.agency_id = getattr(agency, "id", agency)
        self.bypass = bypass
        self._agency_token = None
        self._bypass_token = None
        self._previous_session_vars = None

    def __enter__(self):
        self._agency_token = _current_agency_id.set(self.agency_id)
        self._bypass_token = _bypass.set(self.bypass)
        # Captured so __exit__ can *restore* rather than blindly blank the
        # session vars -- a nested use_agency (e.g. a Celery task body
        # called directly, in-process, from inside an already agency-
        # scoped request) must hand control back to whatever the outer
        # block had set, not wipe it out from under the still-active
        # Python contextvar. Only the outermost block's exit actually
        # blanks things, since there's nothing to restore to there.
        self._previous_session_vars = self._read_session_vars()
        self._apply_session_vars()
        return self

    def __exit__(self, exc_type, exc, tb):
        _current_agency_id.reset(self._agency_token)
        _bypass.reset(self._bypass_token)
        # If the block raised a DB error (e.g. an expected IntegrityError
        # from a test), the transaction is left in a broken state until
        # the enclosing atomic block rolls back -- any further query,
        # including our own cleanup, would just raise
        # TransactionManagementError on top of the original exception.
        # Nothing to clean up in that case; the rollback resets it.
        if connection.in_atomic_block and connection.needs_rollback:
            return
        previous_bypass, previous_agency_id = self._previous_session_vars
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.bypass_rls', %s, false), set_config('app.current_agency_id', %s, false)",
                [previous_bypass, previous_agency_id],
            )

    def _read_session_vars(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_setting('app.bypass_rls', true), current_setting('app.current_agency_id', true)"
            )
            bypass_value, agency_value = cursor.fetchone()
        return (bypass_value or "off", agency_value or "")

    def _apply_session_vars(self):
        # One statement, one round trip (each costs ~200ms against Neon).
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.bypass_rls', %s, false), set_config('app.current_agency_id', %s, false)",
                ["on" if self.bypass else "off", str(self.agency_id) if self.agency_id else ""],
            )
