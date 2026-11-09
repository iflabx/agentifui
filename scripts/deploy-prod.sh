#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${AGENTIF_PROD_ENV_FILE:-${ROOT_DIR}/.env.prod}"
PM2_CONFIG="${AGENTIF_PROD_PM2_CONFIG:-${ROOT_DIR}/ecosystem.prod.config.js}"
ENV_WRAPPER="${ROOT_DIR}/scripts/with-env-local.sh"
STATE_SCRIPT="${ROOT_DIR}/scripts/lib/deploy-state.mjs"

RUN_INSTALL="${AGENTIF_DEPLOY_INSTALL:-1}"
RUN_MIGRATE="${AGENTIF_DEPLOY_RUN_MIGRATIONS:-0}"
MIGRATION_COMMAND="${AGENTIF_DEPLOY_MIGRATION_COMMAND:-}"
RUN_SMOKE="${AGENTIF_DEPLOY_SMOKE:-1}"
ROLLBACK="${AGENTIF_DEPLOY_ROLLBACK:-0}"
PREVIOUS_DIR="${AGENTIF_DEPLOY_PREVIOUS_DIR:-}"
LOCK_FILE="${AGENTIF_DEPLOY_LOCK_FILE:-${ROOT_DIR}/../.agentifui-deploy.lock}"

fail() { echo "[deploy-prod] $*" >&2; exit 1; }
for value in "${RUN_INSTALL}" "${RUN_MIGRATE}" "${RUN_SMOKE}" "${ROLLBACK}"; do
  [[ "${value}" == 0 || "${value}" == 1 ]] || fail 'switches must be 0 or 1'
done
[[ -f "${ENV_FILE}" && -f "${ROOT_DIR}/.env.prod" ]] || fail 'missing .env.prod configuration'
[[ "$(realpath "${ENV_FILE}")" == "$(realpath "${ROOT_DIR}/.env.prod")" ]] || fail 'build and start must use the same .env.prod file'
[[ -f "${PM2_CONFIG}" ]] || fail 'missing PM2 config'
[[ "${RUN_MIGRATE}" == 0 || -n "${MIGRATION_COMMAND}" ]] || fail 'migration command is required before building'
for command in node pnpm pm2 flock; do command -v "${command}" >/dev/null || fail "missing ${command}"; done
if [[ "${ROLLBACK}" == 1 ]]; then
  [[ -n "${PREVIOUS_DIR}" ]] || fail 'rollback requires AGENTIF_DEPLOY_PREVIOUS_DIR and compatible database/content'
  PREVIOUS_DIR="$(realpath "${PREVIOUS_DIR}")"
  [[ "${PREVIOUS_DIR}" != "${ROOT_DIR}" ]] || fail 'rollback directory must differ from target'
  [[ -f "${PREVIOUS_DIR}/ecosystem.prod.config.js" && -f "${PREVIOUS_DIR}/.env.prod" && -f "${PREVIOUS_DIR}/scripts/smoke-prod.sh" ]] || fail 'previous version is incomplete'
fi

exec 9>"${LOCK_FILE}"
flock -n 9 || fail 'another deployment holds this lock'
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
chmod 700 "${WORK_DIR}"
cd "${ROOT_DIR}"
node "${STATE_SCRIPT}" config "${ROOT_DIR}" "${PM2_CONFIG}"
pm2 ping >/dev/null
pm2 jlist > "${WORK_DIR}/processes.json"
node "${STATE_SCRIPT}" inactive "${ROOT_DIR}" "${WORK_DIR}/processes.json"
node "${STATE_SCRIPT}" source "${ROOT_DIR}" > "${WORK_DIR}/source.json"
mkdir -p pm2-logs

run_with_env() {
  AGENTIF_ENV_FILE="${ROOT_DIR}/.env.prod" AGENTIF_FORCE_NODE_ENV=production bash "${ENV_WRAPPER}" "$@"
}

if [[ "${RUN_INSTALL}" == 1 ]]; then pnpm install --frozen-lockfile --prod=false; fi
run_with_env node "${ROOT_DIR}/scripts/prepare-runtime-content.mjs" --deploy
run_with_env pnpm build:all
node "${STATE_SCRIPT}" record "${ROOT_DIR}" "${WORK_DIR}/source.json"
if [[ "${RUN_MIGRATE}" == 1 ]]; then run_with_env bash -c "${MIGRATION_COMMAND}"; fi

recover() {
  local status=$?
  trap - ERR
  echo '[deploy-prod] switch failed; deployment is not successful' >&2
  if [[ "${ROLLBACK}" == 1 ]]; then
    echo "[deploy-prod] recovering ${PREVIOUS_DIR}" >&2
    if (
      cd "${PREVIOUS_DIR}" || exit 1
      pm2 delete AgentifUI-Prod AgentifUI-API-Prod >/dev/null 2>&1 || true
      pm2 start "${PREVIOUS_DIR}/ecosystem.prod.config.js" --only AgentifUI-Prod,AgentifUI-API-Prod || exit 1
      pm2 jlist > "${WORK_DIR}/restored.json" || exit 1
      node "${STATE_SCRIPT}" running "${PREVIOUS_DIR}" "${WORK_DIR}/restored.json" || exit 1
      AGENTIF_PROD_ENV_FILE="${PREVIOUS_DIR}/.env.prod" bash "${PREVIOUS_DIR}/scripts/smoke-prod.sh" || exit 1
      pm2 save || exit 1
    ); then
      echo '[deploy-prod] previous application restored; verify business and auxiliary tasks' >&2
    else
      echo '[deploy-prod] recovery failed; inspect target processes and follow the runbook' >&2
    fi
  else
    echo '[deploy-prod] automatic recovery was not configured; follow the recorded recovery plan' >&2
  fi
  exit "${status}"
}

trap recover ERR
pm2 delete AgentifUI-Prod AgentifUI-API-Prod >/dev/null 2>&1 || true
pm2 start "${PM2_CONFIG}" --only AgentifUI-Prod,AgentifUI-API-Prod
pm2 jlist > "${WORK_DIR}/running.json"
node "${STATE_SCRIPT}" running "${ROOT_DIR}" "${WORK_DIR}/running.json"
if [[ "${RUN_SMOKE}" == 1 ]]; then
  AGENTIF_PROD_ENV_FILE="${ROOT_DIR}/.env.prod" bash "${ROOT_DIR}/scripts/smoke-prod.sh"
fi
trap - ERR
echo '[deploy-prod] application switched; complete business checks, auxiliary tasks, then pm2 save'
