#!/usr/bin/env bash
set -euo pipefail

NEXT_PM2_APP="${NEXT_PM2_APP:-AgentifUI}"
API_PM2_APP="${API_PM2_APP:-AgentifUI-API}"
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

export FASTIFY_API_HOST
export FASTIFY_API_PORT
export FASTIFY_LOG_LEVEL
export FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS
export NEXT_UPSTREAM_BASE_URL
export FASTIFY_PROXY_BASE_URL
export FASTIFY_PROXY_ENABLED=1

echo "[cutover-on] starting ${API_PM2_APP}"
pm2 startOrRestart ecosystem.config.js --only "${API_PM2_APP}" --update-env >/dev/null

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
pm2 startOrRestart ecosystem.config.js --only "${NEXT_PM2_APP}" --update-env >/dev/null

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
