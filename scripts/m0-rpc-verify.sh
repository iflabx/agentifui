#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION_FILE="${ROOT_DIR}/database/migrations/20260214010100_add_missing_rpc_functions.sql"
PGURL="${PGURL:-postgresql://agentif:agentif@172.20.0.1:5432/agentifui}"

echo "[M0] Using database: ${PGURL}"
echo "[M0] Applying migration: ${MIGRATION_FILE}"
psql "${PGURL}" -v ON_ERROR_STOP=1 -f "${MIGRATION_FILE}" >/dev/null

echo "[M0] Verifying function existence..."
psql "${PGURL}" -v ON_ERROR_STOP=1 -c "
  SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND proname IN ('increment_api_key_usage', 'update_sso_provider_order')
  ORDER BY proname;
"

echo "[M0] Running function behavior regression in transaction with temp tables..."
psql "${PGURL}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE api_keys (
  id UUID PRIMARY KEY,
  usage_count INTEGER,
  last_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

INSERT INTO api_keys (id, usage_count)
VALUES ('11111111-1111-1111-1111-111111111111', 5);

SELECT * FROM increment_api_key_usage('11111111-1111-1111-1111-111111111111'::UUID);

CREATE TEMP TABLE sso_providers (
  id UUID PRIMARY KEY,
  display_order INTEGER,
  updated_at TIMESTAMPTZ
);

INSERT INTO sso_providers (id, display_order)
VALUES
  ('22222222-2222-2222-2222-222222222222', 10),
  ('33333333-3333-3333-3333-333333333333', 20);

SELECT update_sso_provider_order(
  '[{"id":"22222222-2222-2222-2222-222222222222","display_order":1},{"id":"33333333-3333-3333-3333-333333333333","display_order":2}]'::jsonb
) AS updated_count;

ROLLBACK;
SQL

echo "[M0] RPC verification completed."
