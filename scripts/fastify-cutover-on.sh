#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM2_CONFIG="${PM2_CONFIG:-ecosystem.prod.config.js}"

if [[ "${PM2_CONFIG}" != /* ]]; then
  PM2_CONFIG="${ROOT_DIR}/${PM2_CONFIG}"
fi

NEXT_PM2_APP="${NEXT_PM2_APP:-AgentifUI-Prod}"
API_PM2_APP="${API_PM2_APP:-AgentifUI-API-Prod}"
NEXT_PORT="${PORT:-3000}"
FASTIFY_API_HOST="${FASTIFY_API_HOST:-0.0.0.0}"
FASTIFY_API_PORT="${FASTIFY_API_PORT:-3010}"
FASTIFY_LOG_LEVEL="${FASTIFY_LOG_LEVEL:-info}"
FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS="${FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS:-30000}"
FASTIFY_PROXY_BASE_URL="${FASTIFY_PROXY_BASE_URL:-http://127.0.0.1:${FASTIFY_API_PORT}}"
NEXT_UPSTREAM_BASE_URL="${NEXT_UPSTREAM_BASE_URL:-http://127.0.0.1:${NEXT_PORT}}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[cutover-on] pm2 command not found"
  exit 1
fi

if [[ ! -f "${PM2_CONFIG}" ]]; then
  echo "[cutover-on] pm2 config not found: ${PM2_CONFIG}"
  exit 1
fi

export FASTIFY_API_HOST
export FASTIFY_API_PORT
export FASTIFY_LOG_LEVEL
export FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS
export NEXT_UPSTREAM_BASE_URL
export FASTIFY_PROXY_BASE_URL
export FASTIFY_PROXY_ENABLED=1

verify_rewrite_manifest() {
  local expected_base
  expected_base="${FASTIFY_PROXY_BASE_URL%/}"
  local manifest_path="${ROOT_DIR}/.next/routes-manifest.json"

  if [[ ! -f "${manifest_path}" ]]; then
    echo "[cutover-on] missing ${manifest_path}"
    echo "[cutover-on] rebuild Next with:"
    echo "  FASTIFY_PROXY_ENABLED=1 FASTIFY_PROXY_BASE_URL=${expected_base} pnpm build"
    return 1
  fi

  if ! EXPECTED_FASTIFY_PROXY_BASE="${expected_base}" node - "${manifest_path}" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const expectedBase = (process.env.EXPECTED_FASTIFY_PROXY_BASE || '').replace(/\/+$/, '');
const expectedDestination = `${expectedBase}/api/internal/data`;

const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
const rewrites = manifest?.rewrites || {};
const rules = [
  ...(Array.isArray(rewrites.beforeFiles) ? rewrites.beforeFiles : []),
  ...(Array.isArray(rewrites.afterFiles) ? rewrites.afterFiles : []),
  ...(Array.isArray(rewrites.fallback) ? rewrites.fallback : []),
];

const matched = rules.some(rule =>
  rule &&
  rule.source === '/api/internal/data' &&
  typeof rule.destination === 'string' &&
  rule.destination.replace(/\/+$/, '') === expectedDestination
);

if (!matched) {
  console.error('[cutover-on] Next build does not contain expected Fastify rewrite rule');
  console.error(`[cutover-on] expected destination: ${expectedDestination}`);
  process.exit(1);
}
NODE
  then
    echo "[cutover-on] rewrite manifest validation failed"
    echo "[cutover-on] rebuild Next with:"
    echo "  FASTIFY_PROXY_ENABLED=1 FASTIFY_PROXY_BASE_URL=${expected_base} pnpm build"
    return 1
  fi
}

echo "[cutover-on] validating Next rewrite build artifact"
verify_rewrite_manifest

echo "[cutover-on] using PM2 config: ${PM2_CONFIG}"
echo "[cutover-on] starting ${API_PM2_APP}"
pm2 startOrRestart "${PM2_CONFIG}" --only "${API_PM2_APP}" --update-env >/dev/null

echo "[cutover-on] waiting fastify health: http://127.0.0.1:${FASTIFY_API_PORT}/healthz"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${FASTIFY_API_PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS "http://127.0.0.1:${FASTIFY_API_PORT}/healthz" >/dev/null 2>&1; then
  echo "[cutover-on] fastify health check failed"
  exit 1
fi

echo "[cutover-on] restarting ${NEXT_PM2_APP} with FASTIFY_PROXY_ENABLED=1"
pm2 startOrRestart "${PM2_CONFIG}" --only "${NEXT_PM2_APP}" --update-env >/dev/null

echo "[cutover-on] smoke check: http://127.0.0.1:${NEXT_PORT}/api/internal/fastify-health"
fastify_health_status=$(curl -sS -o /tmp/agentifui-cutover-on-fastify-health.json -w "%{http_code}" \
  "http://127.0.0.1:${NEXT_PORT}/api/internal/fastify-health")

if [[ "${fastify_health_status}" != "200" ]]; then
  echo "[cutover-on] fastify health proxy smoke check failed: status=${fastify_health_status}"
  cat /tmp/agentifui-cutover-on-fastify-health.json || true
  exit 1
fi

echo "[cutover-on] smoke check: http://127.0.0.1:${NEXT_PORT}/api/internal/data"
status_code=$(curl -sS -o /tmp/agentifui-cutover-on.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:${NEXT_PORT}/api/internal/data" \
  -H 'content-type: application/json' \
  --data '{}')

if [[ "${status_code}" != "400" ]]; then
  echo "[cutover-on] smoke check failed: status=${status_code}"
  cat /tmp/agentifui-cutover-on.json || true
  exit 1
fi

echo "[cutover-on] done"
