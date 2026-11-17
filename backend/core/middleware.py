from django.db import transaction
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken

from . import tenancy

_jwt_auth = JWTAuthentication()


class AgencyContextMiddleware:
    """Establishes the ambient "current agency" context (core/tenancy.py)
    for the duration of each request, consumed by AgencyAutoScopedManager
    and independently enforced by PostgreSQL row-level security.

    Resolves the user two ways, since this app has two auth paths that
    reach this point differently:
    - API requests authenticate via JWT, which DRF normally resolves
      lazily *inside* view dispatch -- after standard Django middleware
      has already run. So this middleware authenticates the JWT itself,
      independently of (and in addition to) DRF's own per-view check.
    - Django admin authenticates via session, which AuthenticationMiddleware
      (must run before this one) already resolves onto `request.user`.

    Fails closed: any request that isn't a recognized agency member or
    platform superuser gets no agency and no bypass, so a queryset that's
    accidentally left unscoped returns nothing rather than everything.

    Wraps the whole request in one DB transaction, entered *before* the
    agency context sets its `set_config(...)` session variables, so that
    setting and every query the request goes on to run share the same
    transaction. That matters because `set_config(..., is_local=false)`
    is session-scoped in Postgres terms, but under a transaction-pooling
    connection pooler (e.g. Neon's pooled connection string, PgBouncer in
    "transaction" mode) the underlying backend connection can otherwise
    be swapped out between separate autocommit statements within the
    *same* request -- silently dropping the session variable partway
    through and making RLS fail closed on whatever query lands on the
    fresh connection (a real-looking row "doesn't exist" even though an
    earlier query in the same request just returned it). One shared
    transaction keeps the whole request pinned to one backend connection
    regardless of pooling mode.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = self._resolve_user(request)

        if user is not None and user.is_superuser:
            ctx = tenancy.use_agency(bypass=True)
        elif user is not None and user.agency_id:
            ctx = tenancy.use_agency(agency=user.agency_id)
        else:
            ctx = tenancy.use_agency()

        with transaction.atomic(), ctx:
            return self.get_response(request)

    def _resolve_user(self, request):
        try:
            result = _jwt_auth.authenticate(request)
        except (InvalidToken, AuthenticationFailed):
            result = None
        if result is not None:
            # Reused by core.authentication.RequestCachedJWTAuthentication.
            request._avtr_jwt_auth = result
            return result[0]

        session_user = getattr(request, "user", None)
        if session_user is not None and session_user.is_authenticated:
            return session_user
        return None
