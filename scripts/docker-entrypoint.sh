#!/bin/sh
set -eu
cd /app
case "${1:-}" in
  web|api)
    node scripts/check-docker-env.mjs
    node scripts/prepare-runtime-content.mjs --check
    if [ "$1" = web ]; then
      exec node node_modules/next/dist/bin/next start --hostname "${WEB_HOST:-0.0.0.0}" --port "${WEB_LISTEN_PORT:-3000}"
    fi
    exec node apps/api/dist/server.js
    ;;
  content-init) exec node scripts/prepare-runtime-content.mjs --init ;;
  content-upgrade) exec node scripts/prepare-runtime-content.mjs --deploy ;;
  content-check) exec node scripts/prepare-runtime-content.mjs --check ;;
  db-init) exec node scripts/docker-init-db.mjs ;;
  *) echo 'Use web, api, content-init, content-upgrade, content-check or db-init' >&2; exit 1 ;;
esac
