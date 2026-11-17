#!/bin/sh
# First-boot setup for the production Postgres container (docker-compose.prod.yml).
# Runs once, when the data volume is empty (postgres image initdb hook).
#
# Two roles, mirroring the old Neon setup:
#   avtr_owner -- owns the database and its tables; runs migrations
#                 (MIGRATE_DATABASE_URL). Not a superuser.
#   avtr_app   -- what the running app connects as (DATABASE_URL).
#                 NOBYPASSRLS + not the table owner, so FORCE ROW LEVEL
#                 SECURITY (core/migrations/0003_row_level_security.py)
#                 always applies to it.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE avtr_owner WITH LOGIN PASSWORD '${AVTR_OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE ROLE avtr_app   WITH LOGIN PASSWORD '${AVTR_APP_PASSWORD}'   NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE DATABASE avtr OWNER avtr_owner;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname avtr <<SQL
ALTER SCHEMA public OWNER TO avtr_owner;
GRANT CONNECT ON DATABASE avtr TO avtr_app;
GRANT USAGE ON SCHEMA public TO avtr_app;
-- Tables/sequences that migrations (run as avtr_owner) create later:
ALTER DEFAULT PRIVILEGES FOR ROLE avtr_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avtr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE avtr_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO avtr_app;
SQL
