#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AGENTIF_PROD_ENV_FILE:-${ROOT_DIR}/.env.prod}"
ENV_WRAPPER="${ROOT_DIR}/scripts/with-env-local.sh"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[smoke-prod] missing env file: ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -x "${ENV_WRAPPER}" ]]; then
  echo "[smoke-prod] env wrapper is not executable: ${ENV_WRAPPER}" >&2
  exit 1
fi

run_with_env() {
  AGENTIF_ENV_FILE="${ENV_FILE}" bash "${ENV_WRAPPER}" "$@"
}

WEB_BASE_URL="$(run_with_env bash -lc 'echo "${DEPLOY_WEB_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"' )"
FASTIFY_BASE_URL="$(run_with_env bash -lc 'echo "${DEPLOY_FASTIFY_BASE_URL:-http://127.0.0.1:${FASTIFY_API_PORT:-3010}}"' )"

WEB_BASE_URL="${WEB_BASE_URL%/}"
FASTIFY_BASE_URL="${FASTIFY_BASE_URL%/}"

echo "[smoke-prod] web base: ${WEB_BASE_URL}"
echo "[smoke-prod] fastify base: ${FASTIFY_BASE_URL}"

WORK_DIR="$(mktemp -d)"
tmp_home="${WORK_DIR}/home"
trap 'rm -rf "${WORK_DIR}"' EXIT
READY_TIMEOUT="${AGENTIF_SMOKE_READY_TIMEOUT:-60}"
[[ "${READY_TIMEOUT}" =~ ^[1-9][0-9]*$ ]] || { echo '[smoke-prod] invalid readiness timeout' >&2; exit 1; }
deadline=$((SECONDS + READY_TIMEOUT))
until run_with_env curl --max-time 5 --connect-timeout 2 -fsS "${WEB_BASE_URL}/" -o "${tmp_home}" 2>/dev/null &&
  [[ "$(run_with_env curl --max-time 5 --connect-timeout 2 -sS -o "${WORK_DIR}/health" -w '%{http_code}' "${FASTIFY_BASE_URL}/healthz" 2>/dev/null)" == 200 ]] &&
  node -e 'const fs=require("node:fs"); const body=JSON.parse(fs.readFileSync(process.argv[1])); process.exit(body.ok === true && body.service === "agentifui-fastify-api" ? 0 : 1)' "${WORK_DIR}/health" 2>/dev/null; do
  if (( SECONDS >= deadline )); then echo '[smoke-prod] Web/API readiness timed out' >&2; exit 1; fi
  sleep 1
done

chunk_path="$(grep -oE '/_next/static/chunks/[^"<> ]+\.js' "${tmp_home}" | head -n 1 || true)"
if [[ -z "${chunk_path}" ]]; then
  echo "[smoke-prod] failed to discover next chunk path from home page" >&2
  exit 1
fi

chunk_status="$(run_with_env curl --max-time 10 -sS -o /dev/null -w '%{http_code}' "${WEB_BASE_URL}${chunk_path}")"
if [[ "${chunk_status}" != "200" ]]; then
  echo "[smoke-prod] chunk load failed (${chunk_status}): ${WEB_BASE_URL}${chunk_path}" >&2
  exit 1
fi

client_error_status="$(run_with_env curl --max-time 10 -sS -o "${WORK_DIR}/client-error" -w '%{http_code}' \
  -X POST "${WEB_BASE_URL}/api/internal/error-events/client" \
  -H 'content-type: application/json' \
  --data '{}')"
if [[ "${client_error_status}" != "400" ]]; then
  echo "[smoke-prod] client error route check failed (${client_error_status})" >&2
  exit 1
fi

echo '[smoke-prod] ok: Web, chunk, API healthz, client error route'
