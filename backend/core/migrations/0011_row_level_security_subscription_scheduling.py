from django.db import migrations

# Same defense-in-depth backstop as 0003/0008 -- each of these tables
# carries its own `agency` FK (see AgencyAutoScopedManager) and is
# queried directly, so each needs the identical FORCE RLS policy.
# SubscriptionPlan and PlanConfigAuditLog are deliberately excluded:
# they're platform-level (no `agency` column), managed only through
# Django admin by staff, not tenant-scoped data.
TABLES = ["core_subscription", "core_billingperiodusage", "core_promptschedule"]

FORWARD_SQL = """
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
CREATE POLICY {table}_agency_isolation ON {table}
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR agency_id = nullif(current_setting('app.current_agency_id', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR agency_id = nullif(current_setting('app.current_agency_id', true), '')::uuid
    );
"""

REVERSE_SQL = """
DROP POLICY IF EXISTS {table}_agency_isolation ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0010_subscriptionplan_promptrun_provider_promptschedule_and_more"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL.format(table=table), reverse_sql=REVERSE_SQL.format(table=table))
        for table in TABLES
    ]
