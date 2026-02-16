#!/usr/bin/env bash
set -euo pipefail

run_step() {
  local step_name="$1"
  shift
  echo "[m8-smoke] ${step_name}"
  "$@"
}

if [[ "${M8_SMOKE_RUN_M2_AUTH_E2E:-1}" == "1" ]]; then
  run_step "m2 auth e2e" pnpm -s m2:auth:e2e:verify
fi

if [[ "${M8_SMOKE_RUN_M5_STORAGE_E2E:-1}" == "1" ]]; then
  run_step "m5 storage e2e" pnpm -s m5:storage:verify
fi

if [[ "${M8_SMOKE_RUN_M6_REALTIME_E2E:-1}" == "1" ]]; then
  run_step "m6 realtime e2e" pnpm -s m6:realtime:verify
fi

echo '{"ok":true,"source":"m8-smoke-verify.sh"}'
