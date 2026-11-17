from rest_framework_simplejwt.authentication import JWTAuthentication


class RequestCachedJWTAuthentication(JWTAuthentication):
    """JWT auth that reuses the user AgencyContextMiddleware already
    resolved from the same token, instead of loading it from the database
    a second time (one round trip saved on every API call -- ~200ms
    against Neon). Anything the middleware couldn't authenticate falls
    through to the normal check, so invalid tokens still get a 401."""

    def authenticate(self, request):
        cached = getattr(request._request, "_avtr_jwt_auth", None)
        if cached is not None:
            return cached
        return super().authenticate(request)
