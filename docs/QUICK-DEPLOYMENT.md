# AgentifUI Production Deployment

## 1. Scope

This is the current public production runbook.

It assumes:

1. You deploy from a checked-out repository directory.
2. Production uses `.env.prod`.
3. PM2 manages two processes:
   - `AgentifUI-Prod` for Next.js
   - `AgentifUI-API-Prod` for Fastify
4. The supported deploy entrypoint is `pnpm deploy`.

## 2. Prerequisites

Install and prepare:

- Node.js 22+
- Corepack or pnpm `10.14.0`
- PM2
- PostgreSQL
- Redis
- MinIO or another S3-compatible object store

Clone the repository and install dependencies:

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
```

## 3. Create `.env.prod`

```bash
cp .env.prod.example .env.prod
```

At minimum, set:

### App URLs

- `NEXT_PUBLIC_APP_URL`
- `BETTER_AUTH_URL`
- `PORT`

### PostgreSQL

- `DATABASE_URL`
- `MIGRATOR_DATABASE_URL`
- `APP_DATABASE_ROLE`
- `APP_DATABASE_PASSWORD`
- `APP_RLS_STRICT_MODE=1`

### Redis

- `REDIS_URL`
- `REDIS_PREFIX`

### S3 / MinIO

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION`
- `S3_ENABLE_PATH_STYLE`

### Auth / secrets

- `BETTER_AUTH_ENABLED=true`
- `AUTH_BACKEND=better-auth`
- `BETTER_AUTH_SECRET`
- `API_ENCRYPTION_KEY`

### Fastify sidecar

- `FASTIFY_PROXY_ENABLED=1`
- `FASTIFY_PROXY_BASE_URL`
- `FASTIFY_API_HOST`
- `FASTIFY_API_PORT`
- `NEXT_UPSTREAM_BASE_URL`
- `CORS_ALLOWED_ORIGINS`

Secret generation examples:

```bash
openssl rand -base64 48
openssl rand -hex 32
```

If you are deploying from a container to data services exposed on the host, replace `127.0.0.1` with the reachable host gateway for your environment.

## 4. Create Isolated Production Data Namespaces

### PostgreSQL database

Create a dedicated production database once:

```bash
psql "postgresql://agentif:agentif@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE agentifui_prod OWNER agentif'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'agentifui_prod');
\gexec
SQL
```

### Runtime role and grants

```bash
set -a
source .env.prod
set +a

psql "$MIGRATOR_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v app_role="$APP_DATABASE_ROLE" \
  -v app_password="$APP_DATABASE_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'app_role',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'app_role'
);
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
  :'app_role',
  :'app_password'
);
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role');
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role');
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_role');
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_role');
\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app_role');
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_role');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'app_role');
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', :'app_role');
\gexec
SQL
```

### Redis namespace

No separate Redis creation step is required, but production should use its own logical DB and prefix values. The template uses:

- `REDIS_URL=redis://127.0.0.1:6379/1`
- `REDIS_PREFIX=agentifui-prod`

### MinIO bucket

```bash
set -a
source .env.prod
set +a

mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc mb --ignore-existing "local/$S3_BUCKET"
```

## 5. Apply SQL Migrations

For a fresh environment, apply all public SQL migrations in lexical order:

```bash
AGENTIF_ENV_FILE=.env.prod bash scripts/with-env-local.sh bash -lc '
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
'
```

## 6. Deploy

Standard deploy:

```bash
pnpm deploy
```

What `pnpm deploy` currently does:

1. optionally runs `pnpm install --frozen-lockfile`
2. runs `pnpm build:all`
3. optionally runs a custom migration command
4. runs `pm2 startOrRestart ecosystem.prod.config.js --update-env`
5. runs `scripts/smoke-prod.sh`

Useful switches:

### Use a different env file

```bash
AGENTIF_PROD_ENV_FILE=/path/to/.env.prod pnpm deploy
```

### Skip dependency install

```bash
AGENTIF_DEPLOY_INSTALL=0 pnpm deploy
```

### Run a migration command during deploy

```bash
AGENTIF_DEPLOY_RUN_MIGRATIONS=1 \
AGENTIF_DEPLOY_MIGRATION_COMMAND='your_migration_command_here' \
pnpm deploy
```

### Skip smoke check

```bash
AGENTIF_DEPLOY_SMOKE=0 pnpm deploy
```

## 7. Validate

Check process state:

```bash
pm2 status AgentifUI-Prod AgentifUI-API-Prod
```

Run the built-in smoke:

```bash
pnpm smoke:prod
```

Minimal manual checks:

```bash
curl -I http://127.0.0.1:3000
curl -fsS http://127.0.0.1:3010/healthz
curl -i -X POST http://127.0.0.1:3000/api/internal/error-events/client \
  -H 'content-type: application/json' \
  --data '{}'
```

Expected results:

- web home page responds
- Fastify `/healthz` responds
- `/api/internal/error-events/client` returns `400` in the normal proxied production path

## 8. Operations

PM2 helpers:

```bash
pnpm pm2:prod:start
pnpm pm2:prod:restart
pnpm pm2:prod:stop
pnpm pm2:prod:delete
```

Logs:

```bash
pm2 logs AgentifUI-Prod
pm2 logs AgentifUI-API-Prod
```

Fastify boundary helpers:

```bash
pnpm fastify:cutover:on
pnpm fastify:cutover:off
```

Manual process start without PM2:

```bash
pnpm start:prod
pnpm start:prod:api
```

## 9. Troubleshooting

### Login or callback failures

Check:

- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `BETTER_AUTH_URL`
- callback domain / reverse-proxy headers

### API requests fail or bypass Fastify unexpectedly

Check:

- `FASTIFY_PROXY_ENABLED`
- `FASTIFY_PROXY_BASE_URL`
- `FASTIFY_API_PORT`
- `NEXT_UPSTREAM_BASE_URL`
- PM2 status for `AgentifUI-API-Prod`

### Storage failures

Check:

- `S3_ENDPOINT`
- `S3_BUCKET`
- credentials
- bucket existence

### Fresh deploy cannot read tables

Check:

- migrations were applied to the correct database
- `DATABASE_URL` and `MIGRATOR_DATABASE_URL` point to the same schema target
- runtime grants were applied to `APP_DATABASE_ROLE`

## 10. Non-goals

This runbook does not cover:

- internal maintainer migration rehearsal scripts
- staging-specific release-process notes
- legacy one-process deployment flows
