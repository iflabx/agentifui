#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.test-stack.yml"
ENV_TEMPLATE="${ROOT_DIR}/.env.test-stack.example"
ENV_FILE="${ROOT_DIR}/.env.test-stack"

usage() {
  cat <<'EOF'
Usage: bash scripts/test-stack.sh <command>

Commands:
  up       Start PostgreSQL, Redis, MinIO and initialize MinIO bucket
  down     Stop and remove containers
  reset    Stop and remove containers + volumes (destructive)
  ps       Show container status
  logs     Follow logs (optionally pass service names)
  init     Re-run MinIO bucket initialization
  health   Run quick health checks
EOF
}

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ENV_TEMPLATE}" "${ENV_FILE}"
    echo "[test-stack] Created ${ENV_FILE} from template."
  fi
}

load_env() {
  ensure_env
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

run_compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

cmd="${1:-help}"

case "${cmd}" in
  up)
    load_env
    run_compose up -d --remove-orphans postgres redis minio
    run_compose run --rm minio-init
    run_compose ps
    ;;
  down)
    load_env
    run_compose down
    ;;
  reset)
    load_env
    run_compose down -v --remove-orphans
    ;;
  ps)
    load_env
    run_compose ps
    ;;
  logs)
    load_env
    shift || true
    if [[ "$#" -gt 0 ]]; then
      run_compose logs -f "$@"
    else
      run_compose logs -f
    fi
    ;;
  init)
    load_env
    run_compose up -d minio
    run_compose run --rm minio-init
    ;;
  health)
    load_env
    echo "[test-stack] PostgreSQL:"
    run_compose exec -T postgres pg_isready -U "${TEST_PG_USER}" -d "${TEST_PG_DB}"
    echo "[test-stack] Redis:"
    run_compose exec -T redis redis-cli ping
    echo "[test-stack] MinIO:"
    run_compose run --rm minio-init >/dev/null
    echo "[test-stack] Health checks passed."
    ;;
  *)
    usage
    exit 1
    ;;
esac
