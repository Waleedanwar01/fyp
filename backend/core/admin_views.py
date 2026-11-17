"""Extra admin pages. System Health: one screen showing whether the
database, task queue, AI engines, payments, email and security settings
are actually working (core/health.py does the checking)."""

from django.contrib import admin
from django.contrib.admin.views.decorators import staff_member_required
from django.core.exceptions import PermissionDenied
from django.template.response import TemplateResponse
from django.urls import path

from .health import FAIL, OK, WARN, run_health_checks


@staff_member_required
def system_health_view(request):
    if not request.user.is_superuser:
        raise PermissionDenied
    live = request.GET.get("live") == "1"
    sections = run_health_checks(live=live)
    statuses = [c.status for s in sections for c in s.checks]
    overall = FAIL if FAIL in statuses else WARN if WARN in statuses else OK
    context = {
        **admin.site.each_context(request),
        "title": "System health",
        "sections": sections,
        "overall": overall,
        "counts": {k: statuses.count(k) for k in (OK, WARN, FAIL)},
        "live": live,
    }
    return TemplateResponse(request, "admin/system_health.html", context)


def _with_health_url(get_urls):
    def get_urls_with_health():
        return [
            path("system-health/", admin.site.admin_view(system_health_view), name="system-health")
        ] + get_urls()

    return get_urls_with_health


admin.site.get_urls = _with_health_url(admin.site.get_urls)
