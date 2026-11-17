-- Bootstraps the local db_test container's role for running the
-- backend test suite (core/tests.py, `manage.py test`).
--
-- Deliberately NOT the container's own POSTGRES_USER: the official
-- postgres image always creates that user as a Postgres superuser,
-- and a superuser connection silently bypasses row-level security
-- regardless of policy -- RLSPolicyTests (core/tests.py) issues raw
-- SQL specifically to verify Postgres's RLS enforcement itself (not
-- just AgencyAutoScopedManager's own Python-level filter), so testing
-- against a superuser role would make those assertions meaningless
-- (or outright wrong, e.g. test_no_session_context_sees_nothing would
-- see every agency's rows instead of zero). This role is a normal,
-- unprivileged login -- FORCE ROW LEVEL SECURITY (see core/migrations/
-- 0003_row_level_security.py) then applies to it exactly the way it
-- applies to the real, restricted DATABASE_URL role in production.
CREATE ROLE avtr_test WITH LOGIN PASSWORD 'avtr_test' CREATEDB NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE avtr_test OWNER avtr_test;
