#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"
M7_CI_SOURCE_DB="${M7_CI_SOURCE_DB:-agentifui_source}"
M7_CI_TARGET_DB="${M7_CI_TARGET_DB:-agentifui_target}"

M7_SOURCE_DATABASE_URL="${M7_SOURCE_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/${M7_CI_SOURCE_DB}}"
M7_TARGET_DATABASE_URL="${M7_TARGET_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/${M7_CI_TARGET_DB}}"
M7_STORAGE_DATABASE_URL="${M7_STORAGE_DATABASE_URL:-${M7_TARGET_DATABASE_URL}}"

S3_ENDPOINT="${S3_ENDPOINT:-http://127.0.0.1:9000}"
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-minioadmin}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-minioadmin}"
S3_BUCKET="${S3_BUCKET:-agentifui}"
S3_ENABLE_PATH_STYLE="${S3_ENABLE_PATH_STYLE:-1}"

run_step() {
  local step_name="$1"
  shift

  local log_file
  log_file="$(mktemp)"
  if ! "$@" >"${log_file}" 2>&1; then
    echo "[m7-ci-runtime] ${step_name} failed:"
    cat "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  rm -f "${log_file}"
}

echo "[m7-ci-runtime] waiting for postgres..."
for _ in {1..60}; do
  if psql "${PG_ADMIN_URL}" -At -c "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
psql "${PG_ADMIN_URL}" -At -c "SELECT 1" >/dev/null

echo "[m7-ci-runtime] waiting for minio..."
for _ in {1..60}; do
  if curl -fsS "${S3_ENDPOINT}/minio/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "${S3_ENDPOINT}/minio/health/live" >/dev/null

echo "[m7-ci-runtime] preparing source/target databases..."
psql "${PG_ADMIN_URL}" -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS "${M7_CI_SOURCE_DB}";
DROP DATABASE IF EXISTS "${M7_CI_TARGET_DB}";
CREATE DATABASE "${M7_CI_SOURCE_DB}";
CREATE DATABASE "${M7_CI_TARGET_DB}";
SQL

echo "[m7-ci-runtime] applying migrations..."
for db_url in "${M7_SOURCE_DATABASE_URL}" "${M7_TARGET_DATABASE_URL}"; do
  for migration in "${ROOT_DIR}"/supabase/migrations/202602*.sql; do
    psql "${db_url}" -v ON_ERROR_STOP=1 -f "${migration}" >/dev/null
  done
done

echo "[m7-ci-runtime] seeding source database..."
psql "${M7_SOURCE_DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO profiles (
  id,
  full_name,
  username,
  email,
  auth_source,
  role,
  status
)
VALUES (
  '9d352b56-3d19-4cc6-991f-c1ea8644fd04',
  'M7 CI User',
  'm7_ci_user',
  'm7-ci@example.com',
  'oidc',
  'user',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO providers (
  id,
  name,
  type,
  base_url,
  auth_type,
  is_active,
  is_default
)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'M7 CI Provider',
  'llm',
  'https://example.invalid',
  'api_key',
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_instances (
  id,
  provider_id,
  instance_id,
  api_path,
  display_name,
  description,
  is_default,
  visibility,
  config
)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'default',
  '/v1',
  'M7 CI Instance',
  'CI verification instance',
  TRUE,
  'public',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO conversations (
  id,
  user_id,
  title
)
VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  '9d352b56-3d19-4cc6-991f-c1ea8644fd04',
  'M7 CI Conversation'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (
  id,
  conversation_id,
  user_id,
  role,
  content
)
VALUES (
  'dddddddd-dddd-dddd-dddd-ddddddddddd1',
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  '9d352b56-3d19-4cc6-991f-c1ea8644fd04',
  'user',
  'hello from m7 ci'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_identities (
  id,
  user_id,
  issuer,
  provider,
  subject,
  email,
  email_verified,
  raw_claims
)
VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
  '9d352b56-3d19-4cc6-991f-c1ea8644fd04',
  'https://idp.example.com',
  'oidc',
  'm7-ci-subject',
  'm7-ci@example.com',
  TRUE,
  '{"dept":"engineering"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
SQL

echo "[m7-ci-runtime] ensuring S3 bucket..."
run_step "ensure S3 bucket" env \
  S3_ENDPOINT="${S3_ENDPOINT}" \
  S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}" \
  S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}" \
  S3_BUCKET="${S3_BUCKET}" \
  S3_ENABLE_PATH_STYLE="${S3_ENABLE_PATH_STYLE}" \
  node "${ROOT_DIR}/scripts/m7-s3-bootstrap.mjs"

echo "[m7-ci-runtime] running full + incremental apply..."
run_step "full apply" env \
  M7_SOURCE_DATABASE_URL="${M7_SOURCE_DATABASE_URL}" \
  M7_TARGET_DATABASE_URL="${M7_TARGET_DATABASE_URL}" \
  M7_STORAGE_DATABASE_URL="${M7_STORAGE_DATABASE_URL}" \
  M7_DRY_RUN=0 \
  pnpm -s m7:migrate:run

run_step "incremental apply" env \
  M7_SOURCE_DATABASE_URL="${M7_SOURCE_DATABASE_URL}" \
  M7_TARGET_DATABASE_URL="${M7_TARGET_DATABASE_URL}" \
  M7_STORAGE_DATABASE_URL="${M7_STORAGE_DATABASE_URL}" \
  M7_DRY_RUN=0 \
  pnpm -s m7:migrate:incremental:run

echo "[m7-ci-runtime] running gate..."
run_step "gate verify" env \
  M7_SOURCE_DATABASE_URL="${M7_SOURCE_DATABASE_URL}" \
  M7_TARGET_DATABASE_URL="${M7_TARGET_DATABASE_URL}" \
  M7_STORAGE_DATABASE_URL="${M7_STORAGE_DATABASE_URL}" \
  S3_ENDPOINT="${S3_ENDPOINT}" \
  S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}" \
  S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}" \
  S3_BUCKET="${S3_BUCKET}" \
  S3_ENABLE_PATH_STYLE="${S3_ENABLE_PATH_STYLE}" \
  pnpm -s m7:gate:verify

echo '{"ok":true,"mode":"runtime-smoke","source":"m7-ci-runtime-verify.sh"}'
