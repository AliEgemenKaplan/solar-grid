#!/bin/sh
# Creates the role a service connects as at runtime.
#
# Mounted into /docker-entrypoint-initdb.d, so PostgreSQL runs it once, when a
# volume is first initialised. It is safe to run again by hand - for instance
# against a volume created before this script existed:
#
#   docker compose -f infrastructure/docker-compose.yml exec postgres-ledger \
#     sh /docker-entrypoint-initdb.d/10-create-app-role.sh
#
# The role gets a login and nothing else: no superuser, no CREATE anywhere, not
# the owner of anything. Which tables it may read and write is decided by each
# service's prisma/runtime-grants.sql, applied by the migration job right after
# the migrations that create those tables.

# No `set -u`: when the file is not executable the image's entrypoint sources
# it into its own shell instead of running it.
set -e

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set to create the runtime role}"

# psql substitutes :'name' as a quoted literal and :"name" as a quoted
# identifier, so the password cannot break out of the statement whatever it
# contains. It is never echoed; PostgreSQL stores only its SCRAM hash.
psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_role=solargrid_app \
  -v app_password="$APP_DB_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
SELECT 'CREATE ROLE solargrid_app LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'solargrid_app')
\gexec

ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'app_password';

-- Only the roles named here may connect, and nobody but the owner may create
-- objects in the schema the tables live in.
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";
SQL

echo "Runtime role solargrid_app is ready in $POSTGRES_DB"
