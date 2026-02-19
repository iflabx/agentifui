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
  AGENTIF_ENV_FILE="${ENV_FILE}" "${ENV_WRAPPER}" "$@"
}

WEB_BASE_URL="$(run_with_env bash -lc 'echo "${DEPLOY_WEB_BASE_URL:-http://127.0.0.1:${PORT:-3000}}"' )"
FASTIFY_BASE_URL="$(run_with_env bash -lc 'echo "${DEPLOY_FASTIFY_BASE_URL:-http://127.0.0.1:${FASTIFY_API_PORT:-3010}}"' )"

WEB_BASE_URL="${WEB_BASE_URL%/}"
FASTIFY_BASE_URL="${FASTIFY_BASE_URL%/}"

echo "[smoke-prod] web base: ${WEB_BASE_URL}"
echo "[smoke-prod] fastify base: ${FASTIFY_BASE_URL}"

tmp_home="$(mktemp)"
trap 'rm -f "${tmp_home}"' EXIT

curl -fsS "${WEB_BASE_URL}/" -o "${tmp_home}"

chunk_path="$(rg -o '/_next/static/chunks/[^"]+\.js' "${tmp_home}" | head -n 1 || true)"
if [[ -z "${chunk_path}" ]]; then
  echo "[smoke-prod] failed to discover next chunk path from home page" >&2
  exit 1
fi

chunk_status="$(curl -sS -o /dev/null -w '%{http_code}' "${WEB_BASE_URL}${chunk_path}")"
if [[ "${chunk_status}" != "200" ]]; then
  echo "[smoke-prod] chunk load failed (${chunk_status}): ${WEB_BASE_URL}${chunk_path}" >&2
  exit 1
fi

api_status="$(curl -sS -o /dev/null -w '%{http_code}' "${FASTIFY_BASE_URL}/")"
if [[ "${api_status}" == "000" || "${api_status}" =~ ^5 ]]; then
  echo "[smoke-prod] fastify endpoint unhealthy (${api_status}): ${FASTIFY_BASE_URL}/" >&2
  exit 1
fi

echo "[smoke-prod] ok"
