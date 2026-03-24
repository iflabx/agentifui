#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.dev"
LEGACY_ENV_FILE="${ROOT_DIR}/.env.local"

if [[ -n "${AGENTIF_ENV_FILE:-}" ]]; then
  ENV_FILE="${AGENTIF_ENV_FILE}"
elif [[ -f "${DEFAULT_ENV_FILE}" ]]; then
  ENV_FILE="${DEFAULT_ENV_FILE}"
elif [[ -f "${LEGACY_ENV_FILE}" ]]; then
  ENV_FILE="${LEGACY_ENV_FILE}"
  echo "[with-env-local] warning: falling back to legacy .env.local, please migrate to .env.dev" >&2
else
  echo "[with-env-local] env file not found: ${DEFAULT_ENV_FILE} (or legacy ${LEGACY_ENV_FILE})" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

if [[ -n "${AGENTIF_FORCE_NODE_ENV:-}" ]]; then
  export NODE_ENV="${AGENTIF_FORCE_NODE_ENV}"
fi

exec "$@"
