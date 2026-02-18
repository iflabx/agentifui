#!/usr/bin/env bash
set -euo pipefail

DEFAULT_RUNTIME_DATABASE_URL="postgresql://agentif_app:agentif_app@172.20.0.1:5432/agentifui"
DEFAULT_MIGRATOR_DATABASE_URL="postgresql://agentif:agentif@172.20.0.1:5432/agentifui"

export DATABASE_URL="${DATABASE_URL:-${M5_GATE_RUNTIME_DATABASE_URL:-$DEFAULT_RUNTIME_DATABASE_URL}}"
export MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${M5_GATE_MIGRATOR_DATABASE_URL:-$DEFAULT_MIGRATOR_DATABASE_URL}}"
export M5_STORAGE_SLO_ALLOW_DEV_FALLBACK="${M5_STORAGE_SLO_ALLOW_DEV_FALLBACK:-0}"

pnpm gate:quality:verify
pnpm m4:runtime-role:setup
pnpm m4:gate:verify
pnpm m5:storage:verify
pnpm m5:storage:slo:verify
