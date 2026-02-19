#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AGENTIF_ENV_FILE:-${ROOT_DIR}/.env.local}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[with-env-local] env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${ENV_FILE}"
set +a

exec "$@"
