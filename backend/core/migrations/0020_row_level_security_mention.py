from django.db import migrations

# Same defense-in-depth backstop as 0008_row_level_security_promptrun --
# Mention carries its own `agency` FK (see AgencyAutoScopedManager) and
# will be queried directly, so it needs the identical FORCE RLS policy,
# not just the ORM-level scoping.
TABLE = "core_mention"

FORWARD_SQL = f"""
ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY;
CREATE POLICY {TABLE}_agency_isolation ON {TABLE}
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

REVERSE_SQL = f"""
DROP POLICY IF EXISTS {TABLE}_agency_isolation ON {TABLE};
ALTER TABLE {TABLE} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0019_mention"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
