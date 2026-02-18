#!/usr/bin/env bash
set -euo pipefail

DEFAULT_RUNTIME_DATABASE_URL="postgresql://agentif_app:agentif_app@172.20.0.1:5432/agentifui"
DEFAULT_MIGRATOR_DATABASE_URL="postgresql://agentif:agentif@172.20.0.1:5432/agentifui"

export DATABASE_URL="${DATABASE_URL:-${STRICT_GATE_RUNTIME_DATABASE_URL:-$DEFAULT_RUNTIME_DATABASE_URL}}"
export MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${STRICT_GATE_MIGRATOR_DATABASE_URL:-$DEFAULT_MIGRATOR_DATABASE_URL}}"
export APP_RLS_STRICT_MODE="${APP_RLS_STRICT_MODE:-1}"

pnpm -s guard:rls-strict-consistency
pnpm -s m4:runtime-role:setup
pnpm -s m4:gate:verify
