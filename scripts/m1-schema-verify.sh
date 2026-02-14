#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGURL="${PGURL:-postgresql://agentif:agentif@172.20.0.1:5432/agentifui}"
MIGRATION_FILES=(
  "${ROOT_DIR}/supabase/migrations/20260214010100_add_missing_rpc_functions.sql"
  "${ROOT_DIR}/supabase/migrations/20260214020100_create_local_pg_baseline_schema.sql"
  "${ROOT_DIR}/supabase/migrations/20260214061000_add_external_identity_profile_tables.sql"
  "${ROOT_DIR}/supabase/migrations/20260214133000_enforce_single_idp_binding.sql"
  "${ROOT_DIR}/supabase/migrations/20260214153000_create_better_auth_tables.sql"
  "${ROOT_DIR}/supabase/migrations/20260214161000_add_local_login_policy_controls.sql"
  "${ROOT_DIR}/supabase/migrations/20260214192000_add_better_auth_phone_fields.sql"
  "${ROOT_DIR}/supabase/migrations/20260214201000_add_fallback_password_profile_metadata.sql"
)

echo "[M1] Using database: ${PGURL}"
for migration in "${MIGRATION_FILES[@]}"; do
  echo "[M1] Applying migration: ${migration}"
  psql "${PGURL}" -v ON_ERROR_STOP=1 -f "${migration}" >/dev/null
done

echo "[M1] Verifying required table existence..."
psql "${PGURL}" -v ON_ERROR_STOP=1 <<'SQL'
WITH required_tables(name) AS (
  VALUES
    ('profiles'),
    ('providers'),
    ('service_instances'),
    ('api_keys'),
    ('sso_providers'),
    ('groups'),
    ('group_members'),
    ('group_app_permissions'),
    ('conversations'),
    ('messages'),
    ('app_executions'),
    ('user_identities'),
    ('profile_external_attributes'),
    ('auth_users'),
    ('auth_sessions'),
    ('auth_accounts'),
    ('auth_verifications'),
    ('auth_local_login_audit_logs')
)
SELECT
  rt.name AS required_table,
  CASE WHEN t.tablename IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_tables rt
LEFT JOIN pg_tables t
  ON t.schemaname = 'public'
 AND t.tablename = rt.name
ORDER BY rt.name;
SQL

echo "[M1] Verifying required function existence..."
psql "${PGURL}" -v ON_ERROR_STOP=1 <<'SQL'
WITH required_functions(name, args) AS (
  VALUES
    ('increment_api_key_usage', 'key_id uuid'),
    ('update_sso_provider_order', 'updates jsonb'),
    ('set_default_service_instance', 'target_instance_id uuid, target_provider_id uuid'),
    ('get_user_accessible_apps', 'p_user_id uuid'),
    ('check_user_app_permission', 'p_user_id uuid, p_service_instance_id uuid'),
    ('increment_app_usage', 'p_user_id uuid, p_service_instance_id uuid, p_increment integer'),
    ('get_admin_users', 'user_ids uuid[]'),
    ('get_user_stats', ''),
    ('get_user_detail_for_admin', 'target_user_id uuid'),
    ('safe_delete_user', 'target_user_id uuid')
)
SELECT
  rf.name || '(' || rf.args || ')' AS required_function,
  CASE WHEN p.oid IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM required_functions rf
LEFT JOIN pg_proc p
  ON p.proname = rf.name
 AND pg_get_function_identity_arguments(p.oid) = rf.args
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
ORDER BY rf.name;
SQL

echo "[M1] Running transactional behavior smoke test..."
psql "${PGURL}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

INSERT INTO providers (id, name, type, base_url, auth_type, is_active, is_default)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Dify', 'llm', 'https://api.example.com', 'api_key', TRUE, TRUE),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'OpenAI', 'llm', 'https://api.openai.com', 'api_key', TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_instances (
  id, provider_id, instance_id, api_path, display_name, description, is_default, visibility, config
)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'default', '/v1', 'Default App', 'Public app', TRUE, 'public', '{}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'group', '/v1', 'Group App', 'Group app', FALSE, 'group_only', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_keys (
  id, provider_id, service_instance_id, user_id, key_value, is_default, usage_count
)
VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  NULL,
  'encrypted-key',
  TRUE,
  3
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sso_providers (id, name, protocol, settings, enabled, display_order)
VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'CAS-A', 'CAS', '{}'::jsonb, TRUE, 10),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', 'OIDC-B', 'OIDC', '{}'::jsonb, TRUE, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (
  id, full_name, username, email, auth_source, role, status
)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'Admin User', 'admin_user', 'admin@example.com', 'password', 'admin', 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'Normal User', 'normal_user', 'user@example.com', 'password', 'user', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO groups (id, name, description, created_by)
VALUES (
  'ffffffff-ffff-ffff-ffff-fffffffffff1',
  'group-one',
  'default group',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO group_members (id, group_id, user_id)
VALUES (
  '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ffffffff-ffff-ffff-ffff-fffffffffff1',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'
)
ON CONFLICT (group_id, user_id) DO NOTHING;

INSERT INTO group_app_permissions (
  id, group_id, service_instance_id, is_enabled, usage_quota, used_count
)
VALUES (
  '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'ffffffff-ffff-ffff-ffff-fffffffffff1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
  TRUE,
  5,
  1
)
ON CONFLICT (group_id, service_instance_id) DO NOTHING;

SELECT * FROM increment_api_key_usage('cccccccc-cccc-cccc-cccc-ccccccccccc1'::UUID);

SELECT update_sso_provider_order(
  '[{"id":"dddddddd-dddd-dddd-dddd-ddddddddddd1","display_order":1},{"id":"dddddddd-dddd-dddd-dddd-ddddddddddd2","display_order":2}]'::jsonb
) AS updated_rows;

SELECT * FROM get_user_accessible_apps('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID);
SELECT * FROM check_user_app_permission('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'::UUID);
SELECT * FROM increment_app_usage('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'::UUID, 1);

SELECT set_default_service_instance(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'::UUID,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::UUID
);

SELECT get_user_stats();
SELECT * FROM get_admin_users(ARRAY['eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'::UUID, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID]);
SELECT * FROM get_user_detail_for_admin('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID);
SELECT safe_delete_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'::UUID) AS deleted_user_ok;

ROLLBACK;
SQL

echo "[M1] Running runtime health checks (Auth/DB/Redis/MinIO)..."
DATABASE_URL="${DATABASE_URL:-${PGURL}}" \
REDIS_URL="${REDIS_URL:-redis://172.20.0.1:6379/0}" \
S3_ENDPOINT="${S3_ENDPOINT:-http://172.20.0.1:9000}" \
S3_BUCKET="${S3_BUCKET:-agentifui}" \
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}" \
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}" \
S3_ENABLE_PATH_STYLE="${S3_ENABLE_PATH_STYLE:-1}" \
AUTH_BACKEND="${AUTH_BACKEND:-better-auth}" \
node "${ROOT_DIR}/scripts/m1-runtime-health-verify.mjs"

echo "[M1] Baseline schema verification completed."
