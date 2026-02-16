#!/usr/bin/env bash
set -euo pipefail

DEFAULT_RUNTIME_DATABASE_URL="postgresql://agentif_app:agentif_app@172.20.0.1:5432/agentifui"
DEFAULT_MIGRATOR_DATABASE_URL="postgresql://agentif:agentif@172.20.0.1:5432/agentifui"

export DATABASE_URL="${DATABASE_URL:-${M6_GATE_RUNTIME_DATABASE_URL:-$DEFAULT_RUNTIME_DATABASE_URL}}"
export MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${M6_GATE_MIGRATOR_DATABASE_URL:-$DEFAULT_MIGRATOR_DATABASE_URL}}"
# M6 gate must run against production-like storage path; disable m5 dev fallback.
export M5_STORAGE_SLO_ALLOW_DEV_FALLBACK="${M5_STORAGE_SLO_ALLOW_DEV_FALLBACK:-0}"
export REALTIME_SOURCE_MODE="${REALTIME_SOURCE_MODE:-db-outbox}"
export REALTIME_PUBLISH_ALLOW_LOCAL_FALLBACK="${REALTIME_PUBLISH_ALLOW_LOCAL_FALLBACK:-0}"

pnpm m5:gate:verify
pnpm m6:realtime:verify
pnpm m6:realtime:slo:verify
