# AgentifUI Production Deployment

## 1. Scope

This is the current public production runbook.

It assumes:

1. You deploy a confirmed release in an unused version directory.
2. Production uses `.env.prod`.
3. PM2 manages two processes:
   - `AgentifUI-Prod` for Next.js
   - `AgentifUI-API-Prod` for Fastify
4. The supported deploy entrypoint is `pnpm run deploy` (explicit `run`).

## 2. Prerequisites

Install and prepare:

- Node.js 22.22.0
- Corepack or pnpm `10.14.0`
- PM2
- PostgreSQL 18.6 (current production compatibility target)
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

For upgrades, link this file to a private, versioned configuration outside the release directory. Build and both start commands read the same `.env.prod`; `AGENTIF_PROD_ENV_FILE`, if supplied, must resolve to that file. Preserve the previous release's configuration. Validate effective child-process settings rather than relying on PM2's environment summary.

At minimum, set:

### App URLs

- `NEXT_PUBLIC_APP_URL`
- `BETTER_AUTH_URL`
- `PORT`

Optional display overrides are `NEXT_PUBLIC_BRAND_NAME` and `NEXT_PUBLIC_BRAND_DOMAIN`; without them the public defaults are `AgentifUI` and `example.com`. Before upgrading an installation that needs custom branding, set its desired values in the private production configuration. These do not change routing or authentication URLs. Use production values during the build and for both running processes, not a build containing another environment's public configuration. See [public branding](CONFIGURATION.md#public-branding).

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

- `FASTIFY_PROXY_ENABLED=1` when Next proxies API requests; use `0` when your reverse proxy routes them directly to Fastify
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

When PgBouncer is used, point `DATABASE_URL` at its transaction pool and keep `MIGRATOR_DATABASE_URL` on the database directly. Use a non-superuser runtime role without `BYPASSRLS`.

With `FASTIFY_PROXY_ENABLED=0`, rebuild the Web application and set `DEPLOY_WEB_BASE_URL` to the reverse-proxy entrypoint used for acceptance, not the direct Next.js port. The smoke check includes a business API route that Next.js intentionally does not serve. For private TLS certificates, configure an appropriate CA bundle rather than disabling certificate verification.

### PostgreSQL container storage

The test-stack Compose file pins PostgreSQL 18.6 and mounts its named data volume at `/var/lib/postgresql`. PostgreSQL 18 stores the cluster under `/var/lib/postgresql/18/docker` by default.

For an existing installation, inspect `SHOW data_directory` and the container mounts before changing the Compose file. Older configurations mounting only `/var/lib/postgresql/data` may have stored the real cluster in an anonymous volume. Back up all databases and roles, stop writers, and migrate the actual data into the new named volume before recreating the service. Do not assume the old named volume contains the data, remove volumes during recreation, or attach PostgreSQL 16 files to PostgreSQL 18.

## 4. Create Isolated Production Data Namespaces

### PostgreSQL database

Create a dedicated production database once. Replace the connection and owner below with your administrative connection and migration owner:

```bash
psql "<ADMIN_POSTGRES_URL>" -v ON_ERROR_STOP=1 <<'SQL'
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
set -euo pipefail
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
'
```

## 6. Deploy

For upgrades, identify only the pending migrations, confirm backup/restore and old-code compatibility, and run the explicit incremental command. Do not replay all initialization SQL on an existing database.

Prepare a fresh version directory. Keep the running directory, its dependencies and build outputs available for recovery; do not share `node_modules`, `.next`, or API/shared `dist` between versions. Stop the two applications and watchers first only when deliberately rebuilding a fixed staging directory. The deploy command refuses to build inside an active application directory.

Deployment runs locally on the production server. The development side hands over the confirmed tag, full main commit and acceptance summary. Fetch that tag with read-only repository access, verify its commit against the handoff, and prepare a new directory; do not pull a moving branch into the running directory. A source archive from the same verified commit is a fallback when direct GitHub access is unavailable. The development host does not need to execute deployment remotely.

The source can be a clean checkout of the confirmed tag, or a verified Git source archive. For an archive without `.git`, create `release-source.json` beside `package.json` after checking the transferred archive SHA-256 against the handoff:

```json
{
  "commit": "<40-character final main SHA>",
  "tree": "<40-character Git tree SHA>",
  "archiveSha256": "<64-character source archive SHA-256>"
}
```

Run from the new directory:

```bash
pnpm run deploy
```

What `pnpm run deploy` does:

1. validates configuration, migration arguments, source identity and a deployment lock; refuses an active target directory
2. optionally installs frozen dependencies including build tools (`--prod=false`), validates and snapshots external content, prepares translations, then builds shared → API → Web
3. records the source identity, lock hash, tools, Web BUILD_ID and API/shared output hashes under `pm2-logs/`
4. optionally executes the explicit incremental migration command
5. replaces only the two application registrations with the target config, verifies actual process directories and runs bounded Web/API smoke checks

Installation/build/migration failure leaves the running applications untouched. Switching allows a brief interruption. Complete the business checks in section 7, update auxiliary jobs to the chosen version, then run `pm2 save`. A smoke result alone does not prove login or business correctness.

Useful switches:

### Link a controlled env file

```bash
ln -s /path/to/private/versioned.env .env.prod
pnpm run deploy
```

### Skip dependency install

```bash
AGENTIF_DEPLOY_INSTALL=0 pnpm run deploy
```

### Run a migration command during deploy

```bash
AGENTIF_DEPLOY_RUN_MIGRATIONS=1 \
AGENTIF_DEPLOY_MIGRATION_COMMAND='your_migration_command_here' \
pnpm run deploy
```

### Skip smoke check

```bash
AGENTIF_DEPLOY_SMOKE=0 pnpm run deploy
```

Skipping smoke requires equivalent checks before accepting the release. Concurrent version deployments must use the same lock; its default location is the parent of the release directory. Set `AGENTIF_DEPLOY_LOCK_FILE` to a stable absolute path when deployment directories have different parents.

### Prepare application recovery

After confirming database and editable-content compatibility, enable recovery for switch/smoke failure:

```bash
AGENTIF_DEPLOY_ROLLBACK=1 \
AGENTIF_DEPLOY_PREVIOUS_DIR=/path/to/previous-release \
pnpm run deploy
```

The previous directory must retain its real PM2 configuration, `.env.prod`, installed dependencies and builds. Recovery starts it without rebuilding, verifies it and saves the restored PM2 state. The deployment still returns failure. It does not reverse SQL, merge content or change system services; handle those using the release's recorded recovery procedure.

### Preserve editable content

Set `AGENTIF_RUNTIME_DIR` in the controlled `.env.prod` to one stable, absolute directory outside all releases. It contains `content/pages/` and `messages/`. Admin operations write there, never into tracked defaults. Use the same directory for compatible releases; do not create one operational-content copy per release.

For a genuinely new installation only:

```bash
AGENTIF_RUNTIME_INIT=1 pnpm run deploy
```

Initialization refuses a nonempty runtime directory. Do not save this one-time switch in `.env.prod`. When adopting this release on an existing instance, first preserve and copy its actual edited pages and translations into the external directory; do not initialize it from repository defaults. Keep the old code, builds and content until the first cutover and recovery procedure have been verified.

For upgrades, run normal `pnpm run deploy`. A missing configured directory fails. Preparation reuses the existing page-shape validation, validates translation types, snapshots the existing content under the runtime directory's sibling `runtime-snapshots/`, and adds missing default translation keys while preserving existing values. Type/shape conflicts fail before switching. Existing CMS version checks still protect admin saves; compatible locale layers do not have to be retranslated merely because the source revision advanced. New page structures or changed translation parameters require explicit review; there is no automatic three-way content merge. Verify snapshot permissions and retention with the existing backup procedure.

Pause admin content editing from preparation until switching completes; ordinary chat can continue. Translations are imported at build time from ignored, release-local `output/build-messages/`. Saving an admin translation does not update a running production build; rebuild through a new release directory. Do not share generated translations, dependencies or builds between releases.

Keep `pm2-logs/` outside version directories as well, including the cwd-based `error-events.jsonl` file. Compatible old code uses the same latest runtime content and its preserved old translation build. Incompatible content needs an explicit restore or forward fix after preserving newer edits; snapshot restoration may lose edits made afterward. The first pre-external-content version needs a separate compatibility procedure. Rehearse content preservation during the first upgrade/recovery, and again when its format changes. Never replace existing production environment files, database data, uploads or encryption keys with development copies.

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

Also verify HTTPS login/session cookies, a complete chat and persisted history after refresh, and the release's changed functionality. Staging should match the production database major version, pool behavior, API routing and SSE buffering/timeouts. Readiness uses `/healthz` with HTTP 200 and the expected `ok`/`service` JSON fields.

For manual application recovery, first confirm schema compatibility and prepare compatible content, then start the previous retained directory's actual PM2 config without rebuilding. Verify health and business behavior before `pm2 save`. Restore auxiliary-job paths along with the application.

## 8. Operations

Configure one standard PM2 systemd startup service for the application user if no startup mechanism already exists. `pm2 save` alone does not install boot recovery. Check the service and saved process list during initial rollout; test a real reboot in a maintenance window. If scheduled warm-up jobs or other application jobs reference the old directory, update or preserve their executable/configuration and working directory at cutover, and restore them on recovery.

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
