#!/usr/bin/env bash
set -euo pipefail

detect_require_all() {
  if [[ -n "${M9_GAP_REQUIRE_ALL:-}" ]]; then
    echo "${M9_GAP_REQUIRE_ALL}"
    return 0
  fi

  local profile
  profile="$(printf '%s' "${M9_GAP_PROFILE:-}" | tr '[:upper:]' '[:lower:]')"
  local node_env
  node_env="$(printf '%s' "${NODE_ENV:-}" | tr '[:upper:]' '[:lower:]')"
  local ci_flag
  ci_flag="$(printf '%s' "${CI:-}" | tr '[:upper:]' '[:lower:]')"
  local env_file
  env_file="${AGENTIF_ENV_FILE:-}"

  if [[ "${profile}" == "prod" || "${profile}" == "production" ]]; then
    echo "1"
    return 0
  fi

  if [[ "${node_env}" == "production" ]]; then
    echo "1"
    return 0
  fi

  if [[ "${ci_flag}" == "1" || "${ci_flag}" == "true" ]]; then
    echo "1"
    return 0
  fi

  if [[ "${env_file}" == *".env.prod" ]]; then
    echo "1"
    return 0
  fi

  echo "0"
}

require_all="$(detect_require_all)"

if [[ "${require_all}" != "0" && "${require_all}" != "1" ]]; then
  echo "[m9-gap] invalid M9_GAP_REQUIRE_ALL: ${require_all} (expected 0 or 1)" >&2
  exit 1
fi

# Command hooks (set by CI or local operator)
dify_cmd="${M9_GAP_DIFY_REAL_PROVIDER_COMMAND:-}"
local_state_cmd="${M9_GAP_LOCAL_STATE_COMMAND:-}"
translations_cmd="${M9_GAP_TRANSLATIONS_COMMAND:-}"

ran=0
skipped=0

run_or_skip() {
  local label="$1"
  local cmd="$2"

  if [[ -z "${cmd}" ]]; then
    if [[ "${require_all}" == "1" ]]; then
      echo "[m9-gap] missing required command for ${label}" >&2
      return 1
    fi
    echo "[m9-gap] skip ${label}: command not configured"
    skipped=$((skipped + 1))
    return 0
  fi

  echo "[m9-gap] run ${label}: ${cmd}"
  ran=$((ran + 1))
  bash -lc "${cmd}"
}

echo "[m9-gap] mode: require_all=${require_all}, profile=${M9_GAP_PROFILE:-unset}, node_env=${NODE_ENV:-unset}, ci=${CI:-unset}, env_file=${AGENTIF_ENV_FILE:-unset}"

run_or_skip "dify-real-provider" "${dify_cmd}"
run_or_skip "local-state" "${local_state_cmd}"
run_or_skip "translations-api" "${translations_cmd}"

echo "[m9-gap] done: ran=${ran}, skipped=${skipped}, require_all=${require_all}"

if [[ "${require_all}" == "1" && "${skipped}" -gt 0 ]]; then
  echo "[m9-gap] failed: require_all=1 but some checks were skipped" >&2
  exit 1
fi
