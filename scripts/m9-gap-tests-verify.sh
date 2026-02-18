#!/usr/bin/env bash
set -euo pipefail

require_all="${M9_GAP_REQUIRE_ALL:-0}"

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

run_or_skip "dify-real-provider" "${dify_cmd}"
run_or_skip "local-state" "${local_state_cmd}"
run_or_skip "translations-api" "${translations_cmd}"

echo "[m9-gap] done: ran=${ran}, skipped=${skipped}, require_all=${require_all}"

if [[ "${require_all}" == "1" && "${skipped}" -gt 0 ]]; then
  echo "[m9-gap] failed: require_all=1 but some checks were skipped" >&2
  exit 1
fi
