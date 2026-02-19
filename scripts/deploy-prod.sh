#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AGENTIF_PROD_ENV_FILE:-${ROOT_DIR}/.env.prod}"
PM2_CONFIG="${AGENTIF_PROD_PM2_CONFIG:-${ROOT_DIR}/ecosystem.prod.config.js}"
ENV_WRAPPER="${ROOT_DIR}/scripts/with-env-local.sh"
SMOKE_SCRIPT="${ROOT_DIR}/scripts/smoke-prod.sh"

RUN_INSTALL="${AGENTIF_DEPLOY_INSTALL:-1}"
RUN_MIGRATE="${AGENTIF_DEPLOY_RUN_MIGRATIONS:-0}"
MIGRATION_COMMAND="${AGENTIF_DEPLOY_MIGRATION_COMMAND:-}"
RUN_SMOKE="${AGENTIF_DEPLOY_SMOKE:-1}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[deploy-prod] missing env file: ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${PM2_CONFIG}" ]]; then
  echo "[deploy-prod] missing pm2 config: ${PM2_CONFIG}" >&2
  exit 1
fi

if [[ ! -x "${ENV_WRAPPER}" ]]; then
  echo "[deploy-prod] env wrapper is not executable: ${ENV_WRAPPER}" >&2
  exit 1
fi

cd "${ROOT_DIR}"
mkdir -p pm2-logs

run_with_env() {
  AGENTIF_ENV_FILE="${ENV_FILE}" "${ENV_WRAPPER}" "$@"
}

if [[ "${RUN_INSTALL}" == "1" ]]; then
  echo "[deploy-prod] pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
fi

echo "[deploy-prod] build shared/api/next"
run_with_env pnpm build:all

if [[ "${RUN_MIGRATE}" == "1" ]]; then
  if [[ -z "${MIGRATION_COMMAND}" ]]; then
    echo "[deploy-prod] AGENTIF_DEPLOY_RUN_MIGRATIONS=1 but AGENTIF_DEPLOY_MIGRATION_COMMAND is empty" >&2
    exit 1
  fi
  echo "[deploy-prod] running migration command"
  run_with_env bash -lc "${MIGRATION_COMMAND}"
fi

echo "[deploy-prod] pm2 startOrRestart ${PM2_CONFIG}"
pm2 startOrRestart "${PM2_CONFIG}" --update-env

if [[ "${RUN_SMOKE}" == "1" ]]; then
  echo "[deploy-prod] smoke check"
  AGENTIF_PROD_ENV_FILE="${ENV_FILE}" bash "${SMOKE_SCRIPT}"
fi

echo "[deploy-prod] done"
