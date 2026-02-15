#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DB_URL="postgresql://agentif:agentif@172.20.0.1:5432/agentifui"

MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${PGURL:-${DATABASE_URL:-${DEFAULT_DB_URL}}}}"
APP_DATABASE_ROLE="${APP_DATABASE_ROLE:-agentif_app}"
APP_DATABASE_PASSWORD="${APP_DATABASE_PASSWORD:-agentif_app}"

if [[ -z "${MIGRATOR_DATABASE_URL}" ]]; then
  echo "[m4:runtime-role:setup] MIGRATOR_DATABASE_URL is required."
  exit 1
fi

echo "[m4:runtime-role:setup] migrator: ${MIGRATOR_DATABASE_URL}"
echo "[m4:runtime-role:setup] runtime role: ${APP_DATABASE_ROLE}"

psql "${MIGRATOR_DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v app_role="${APP_DATABASE_ROLE}" \
  -v app_password="${APP_DATABASE_PASSWORD}" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'app_role',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'app_role'
);
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'app_role',
  :'app_password'
);
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  :'app_role'
);
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role');
\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'app_role'
);
\gexec

SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'app_role'
);
\gexec

SELECT format(
  'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I',
  :'app_role'
);
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'app_role'
);
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'app_role'
);
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I',
  :'app_role'
);
\gexec
SQL

echo "[m4:runtime-role:setup] Runtime role is ready: ${APP_DATABASE_ROLE}"
