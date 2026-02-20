# AgentifUI Production Deployment (Current Minimal Scheme)

## 1. Scope

This document describes the only production deployment path currently in use:

1. Environment file: `.env.prod`
2. Deploy entry: `pnpm deploy` (runs `scripts/deploy-prod.sh`)
3. Process manager: PM2 with `ecosystem.prod.config.js`
4. Runtime processes:
   - `AgentifUI-Prod` (Next.js)
   - `AgentifUI-API-Prod` (Fastify API)

Legacy deploy commands are not part of this runbook.

## 2. Prerequisites

1. Node.js LTS, pnpm, PM2 installed.
2. PostgreSQL, Redis, and MinIO are reachable from deploy host.
3. Repository is checked out on the production directory.

## 3. Configure `.env.prod`

Create and edit production env:

```bash
cp .env.prod.example .env.prod
```

Required groups:

1. Database and cache
   - `DATABASE_URL`
   - `MIGRATOR_DATABASE_URL`
   - `APP_DATABASE_ROLE`
   - `APP_DATABASE_PASSWORD`
   - `REDIS_URL`
2. Object storage
   - `S3_ENDPOINT`
   - `S3_BUCKET`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_ENABLE_PATH_STYLE`
3. Auth and encryption
   - `BETTER_AUTH_SECRET`
   - `API_ENCRYPTION_KEY`
4. Network and runtime
   - `NEXT_PUBLIC_APP_URL`
   - `PORT`
   - `FASTIFY_API_PORT`
   - `CORS_ALLOWED_ORIGINS`

Secret generation examples:

```bash
openssl rand -base64 48
openssl rand -hex 32
```

For the current "dev-container + host data stack" setup, recommended values are:

1. `DATABASE_URL=postgresql://agentif_app:agentif_app@172.20.0.1:5432/agentifui_prod`
2. `MIGRATOR_DATABASE_URL=postgresql://agentif:agentif@172.20.0.1:5432/agentifui_prod`
3. `REDIS_URL=redis://172.20.0.1:6379/1`
4. `S3_ENDPOINT=http://172.20.0.1:9000`
5. `S3_BUCKET=agentifui-prod`
6. `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` set to your production access URL

## 4. Initialize Isolated Prod Data Resources

Create dedicated PostgreSQL database:

```bash
psql "postgresql://agentif:agentif@172.20.0.1:5432/postgres" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE agentifui_prod OWNER agentif'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'agentifui_prod');
\gexec
SQL
```

Create runtime DB role and grants in prod database:

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

Create dedicated MinIO bucket:

```bash
set -a
source .env.prod
set +a

mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc mb --ignore-existing "local/$S3_BUCKET"
```

Apply baseline schema migrations (fresh install):

```bash
AGENTIF_ENV_FILE=.env.prod bash scripts/with-env-local.sh bash -lc '
for migration in ./database/migrations/202602*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
'
```

## 5. Deploy

First deployment:

```bash
pnpm install --frozen-lockfile
pnpm deploy
```

What `pnpm deploy` does:

1. Install dependencies (enabled by default).
2. Build web/shared/api.
3. Optionally run migrations.
4. `pm2 startOrRestart ecosystem.prod.config.js --update-env`
5. Run production smoke check.

Run deploy with migration command:

```bash
AGENTIF_DEPLOY_RUN_MIGRATIONS=1 \
AGENTIF_DEPLOY_MIGRATION_COMMAND='your_migration_command_here' \
pnpm deploy
```

Useful toggles:

1. Skip install:

```bash
AGENTIF_DEPLOY_INSTALL=0 pnpm deploy
```

2. Skip smoke:

```bash
AGENTIF_DEPLOY_SMOKE=0 pnpm deploy
```

## 6. Validate

```bash
pm2 status AgentifUI-Prod AgentifUI-API-Prod
pnpm smoke:prod
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3010
```

## 7. Operations

Start prod services (PM2):

```bash
pnpm pm2:prod:start
```

Restart prod services:

```bash
pnpm pm2:prod:restart
```

Stop prod services:

```bash
pnpm pm2:prod:stop
```

Remove prod PM2 entries:

```bash
pnpm pm2:prod:delete
```

View logs:

```bash
pm2 logs AgentifUI-Prod
pm2 logs AgentifUI-API-Prod
```

Run without PM2 (single-process/manual mode):

```bash
pnpm start:prod
pnpm start:prod:api
```

## 8. Troubleshooting

1. Login returns `403/503`
   - Verify `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, and auth-related callback domains.
2. White screen or static chunk load failure
   - Re-run `pnpm deploy`; ensure smoke check passes.
3. Storage upload/read failure
   - Verify `S3_ENDPOINT`, `S3_BUCKET`, and MinIO credentials.
4. API endpoints fail
   - Check `FASTIFY_API_PORT` and PM2 status for `AgentifUI-API-Prod`.

## 9. Non-goals of this runbook

1. No staging/develop deployment procedures.
2. No legacy deploy flows.
3. No migration-framework history discussion.
4. No maintainer-only migration verification gates (`m5`/`m6`/`m9`) in public docs.
