#!/usr/bin/env bash
set -euo pipefail

pnpm -s type-check
pnpm -s lint:eslint --quiet
pnpm -s guard:client-db-imports
pnpm -s guard:no-raw-pg-in-api
