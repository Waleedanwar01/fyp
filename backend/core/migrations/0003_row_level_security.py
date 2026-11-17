from django.db import migrations

# Table-owner connections (which is what our single Neon role is) bypass
# RLS by default -- FORCE is what makes the policy apply even to our own
# app's connection, which is the entire point: a real defense-in-depth
# backstop against an application-level query bug, not just protection
# against some other, lower-privileged database user.
TABLES = ["core_client", "core_brand", "core_competitor", "core_prompt"]

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
        ("core", "0002_client_brand_competitor_prompt"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL.format(table=table), reverse_sql=REVERSE_SQL.format(table=table))
        for table in TABLES
    ]
