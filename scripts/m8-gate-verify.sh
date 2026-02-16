#!/usr/bin/env bash
set -euo pipefail

export M8_DRY_RUN="${M8_DRY_RUN:-1}"
export M8_ENFORCE_WAIT="${M8_ENFORCE_WAIT:-0}"
export M8_GATE_ROLLOUT_DRY_RUN="${M8_GATE_ROLLOUT_DRY_RUN:-$M8_DRY_RUN}"
export M8_GATE_ROLLBACK_DRY_RUN="${M8_GATE_ROLLBACK_DRY_RUN:-$M8_DRY_RUN}"

node scripts/m8-gate-verify.mjs
