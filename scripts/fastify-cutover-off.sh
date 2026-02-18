#!/usr/bin/env bash
set -euo pipefail

NEXT_PM2_APP="${NEXT_PM2_APP:-AgentifUI}"
API_PM2_APP="${API_PM2_APP:-AgentifUI-API}"
NEXT_PORT="${PORT:-3000}"
STOP_FASTIFY_API="${STOP_FASTIFY_API:-0}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[cutover-off] pm2 command not found"
  exit 1
fi

export FASTIFY_PROXY_ENABLED=0

echo "[cutover-off] restarting ${NEXT_PM2_APP} with FASTIFY_PROXY_ENABLED=0"
pm2 startOrRestart ecosystem.config.js --only "${NEXT_PM2_APP}" --update-env >/dev/null

if [[ "${STOP_FASTIFY_API}" == "1" ]]; then
  echo "[cutover-off] stopping ${API_PM2_APP}"
  pm2 stop "${API_PM2_APP}" >/dev/null || true
fi

echo "[cutover-off] smoke check: http://127.0.0.1:${NEXT_PORT}/api/internal/data"
status_code=$(curl -sS -o /tmp/agentifui-cutover-off.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:${NEXT_PORT}/api/internal/data" \
  -H 'content-type: application/json' \
  --data '{}')

if [[ "${status_code}" != "503" ]]; then
  echo "[cutover-off] smoke check failed: status=${status_code}"
  cat /tmp/agentifui-cutover-off.json || true
  exit 1
fi

echo "[cutover-off] done"
