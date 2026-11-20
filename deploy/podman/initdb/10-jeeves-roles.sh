#!/bin/sh
# Runs once, when the postgres image initialises an empty data directory
# (mounted at /docker-entrypoint-initdb.d). It is the only place the bootstrap
# superuser (POSTGRES_USER) is used: it creates the two roles Jeeves runs as.
#
#   jeeves_owner  owns the schema; used only by the migrate and seed jobs.
#   jeeves_app    owns nothing; the app's runtime role.
#
# A role that owns audit_events can switch its append-only triggers off, so the
# app must not be one (docs/deploy.md, "Database roles"). Passwords arrive as
# psql variables, never spliced into the SQL text.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v owner_pw="${JEEVES_OWNER_PASSWORD:?set JEEVES_OWNER_PASSWORD}" \
  -v app_pw="${JEEVES_APP_PASSWORD:?set JEEVES_APP_PASSWORD}" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE jeeves_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'owner_pw';
CREATE ROLE jeeves_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_pw';
SQL

# The same file docs/deploy.md shows; the tables do not exist yet, so this is
# the first of two passes (`podman compose run --rm grants` is the second).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /opt/jeeves/jeeves-runtime-grants.sql
