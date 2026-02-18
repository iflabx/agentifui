#!/usr/bin/env bash
set -euo pipefail

pnpm -s type-check
pnpm -s lint:eslint --quiet
pnpm -s guard:client-db-imports
pnpm -s guard:rls-strict-consistency
pnpm -s guard:single-path-internal-data
pnpm -s guard:route-contract-parity
pnpm -s guard:fastify-proxy-prefixes
pnpm -s guard:no-raw-pg-in-api
