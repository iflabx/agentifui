# Docker Compose Installation

## Scope

For an optional host-network installation with a selectable initial size and
later manual application scaling, see [Manual Docker Capacity](DOCKER-CAPACITY.md).
The default bridge path below remains a single Web/API installation.

This is the source-build installation path, alongside the
[host/PM2 runbook](QUICK-DEPLOYMENT.md). Use Docker Engine with Compose V2 and
BuildKit on a Linux server. No Docker Hub/GHCR account, image push, PM2, host Node,
or existing test-stack network is required. Start with a confirmed release tag
containing these files, verify its commit against the release handoff, and use a
separate source directory for each release. Do not assume older tags contain
this installer.

One image runs two separate non-root services: Web (Next.js) and API (Fastify).
The first implementation retains installed dependencies, including build tools
needed by `next.config.ts`, rather than relying on incomplete standalone tracing.
The optional data profile provides PostgreSQL 18.6, Redis 7.4 and MinIO built
from pinned official source, alongside its client. Historical upstream MinIO
container images may no longer be anonymously downloadable; a locally cached
image is not proof that another installation can pull it. Review upstream
security/support notices when choosing an object store; a source pin ensures
traceability, not absence of vulnerabilities. Existing external S3-compatible
storage remains supported and does not need replacement.

### Contributor Validation

Runtime changes trigger Docker build and smoke checks in pull-request CI. To
repeat the basic check locally, build a disposable image with a synthetic public
origin, then run:

```bash
docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" \
  --build-arg NEXT_PUBLIC_APP_URL=http://127.0.0.1:23300 \
  --tag agentifui:smoke .
node scripts/smoke-docker.mjs --image agentifui:smoke
```

The smoke check creates a randomly named, isolated Compose project with fresh
data services and synthetic credentials. It checks application startup, login
page assets and anonymous access control, then removes only its own containers
and volumes and checks that existing containers were not restarted or replaced.
It never loads an installation's private environment or sends real email. Port
23300 must be unused; select another with `--web-port PORT` and match the public
build argument. Docker must be able to obtain the declared base/data-service
images. The first check builds the pinned-source storage images if absent; CI
prepares and caches them separately. No storage image is pushed to a registry.

This is not business acceptance, an upgrade rehearsal or a scale test. Before
releasing deployment changes, run the candidate with the intended deployment
mode in an isolated staging environment, verify affected business/persistence
behavior, and exercise scaling/draining when that mechanism changes. Keep
source commit, image identity and non-sensitive build configuration with the
acceptance result. A production rebuild with different public configuration
needs its own artifact check before cutover.

## 1. Private Configuration

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Edit the file using dotenv `KEY=value` syntax. Never commit it, pass it to the
build, or put real credentials in Dockerfile/Compose source. Generate independent
passwords using `openssl rand -hex 24`; generate `API_ENCRYPTION_KEY` with
`openssl rand -hex 32` and `BETTER_AUTH_SECRET` with `openssl rand -hex 32`.
Use actual values, not the symbolic passwords in this table. Hex avoids URL
encoding problems; other URI password characters must be percent-encoded.

| Setting                                                          | Local data profile value                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`                                           | `agentifui` (keep stable across upgrades)                           |
| `AGENTIF_IMAGE`                                                  | `agentifui:<verified-release>` (keep old images for rollback)       |
| `SOURCE_COMMIT`                                                  | verified full source commit                                         |
| `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `CORS_ALLOWED_ORIGINS` | same public origin, e.g. `https://chat.example.com`                 |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`              | `agentifui`, `agentif_owner`, private owner password                |
| `APP_DATABASE_ROLE`, `APP_DATABASE_PASSWORD`                     | `agentif_app`, different private runtime password                   |
| `DATABASE_URL`                                                   | `postgresql://agentif_app:APP_PASSWORD@postgres:5432/agentifui`     |
| `MIGRATOR_DATABASE_URL`                                          | `postgresql://agentif_owner:OWNER_PASSWORD@postgres:5432/agentifui` |
| `REDIS_PASSWORD`, `REDIS_URL`                                    | private password, `redis://:REDIS_PASSWORD@redis:6379/1`            |
| `REDIS_PREFIX`                                                   | a namespace unique to this installation                             |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`                         | `agentif_owner`, private root password                              |
| `S3_BUCKET`                                                      | unique bucket, e.g. `agentifui`                                     |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                       | `agentif_storage`, different private application password           |
| `S3_ENDPOINT`                                                    | `http://minio:9000`                                                 |
| `S3_PRESIGN_ENDPOINT`                                            | browser-accessible origin, e.g. `https://storage.example.com`       |
| `AUTH_EMAIL_VERIFICATION_MODE`, `AUTH_RESET_PASSWORD_MODE`       | `smtp`                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`             | authorized SMTP endpoint and sender                                 |
| `SMTP_USER`, `SMTP_PASSWORD`                                     | provider credentials, if required                                   |

Replace the template's host URLs and weak sample passwords; do not merely append
duplicate settings. Compose fixes runtime content to `/data/runtime`, bridge
addresses to `http://api:3010` / `http://web:3000`, and strict RLS to `1`.
Web/API receive **only** explicitly mapped variables; migration/root credentials
are passed only to their respective one-shot/data services. Docker administrators
can still inspect container secrets: restrict host and Docker access. Do not
print resolved Compose configuration into public logs; use `config --quiet`.

Configure optional public branding and GitHub login before building. GitHub
credentials belong in private runtime configuration; callback configuration is
described in [CONFIGURATION.md](CONFIGURATION.md). SMTP is required for public
registration/reset flows: the container entrypoint rejects `dev-log`, which
would expose authentication links to logs. An installation that uses existing
accounts or external sign-in only may explicitly set `AUTH_EMAIL_DISABLED=1`;
this disables email signup, verification and reset endpoints and sending, while
preserving existing password and external sign-in. In that mode SMTP is optional.
The default is `0`; restart applications after changing it and keep the UI
registration policy consistent. An isolated acceptance test may use
a private SMTP sink, never a real recipient without authorization.

The default Docker stack disables phone OTP to avoid logging real OTPs through
the application's development sender. Enabling it needs a private Compose
override with a real SMS gateway, not `dev-log`. Legacy storage relay stays off;
if deliberately needed, configure both `STORAGE_LEGACY_RELAY_ENABLED` at runtime
and `NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED` before rebuilding the Web image.

## 2. Build and Initialize Once

The commands below run from the checked-out source directory. Always specify
the same `--env-file` and project name. There are no migrations at app startup.

```bash
docker compose --env-file .env.prod config --quiet
docker compose --env-file .env.prod build web
docker compose --env-file .env.prod build minio storage-init
docker compose --env-file .env.prod --profile data up -d --wait postgres redis
docker compose --env-file .env.prod --profile data up -d minio
docker compose --env-file .env.prod run --rm db-init
docker compose --env-file .env.prod run --rm content content-init
docker compose --env-file .env.prod run --rm storage-init
docker compose --env-file .env.prod up -d --wait web api
```

If storage setup initially fails because MinIO is not ready, inspect its logs
and retry only after it is ready. Later errors must be inspected rather than
ignored. `db-init` refuses a nonempty database or an existing runtime role and
runs fresh-install SQL plus role creation/grants in one transaction. It does not
reset an existing password. `content-init` refuses nonempty content. Storage
setup refuses an existing bucket/identity, creates a private bucket and grants
the separate application identity access only to that bucket. A partially failed
storage setup needs inspection and repair; it is not an automatic retry loop.

Build the optional storage services only for a new bundled installation. They
use `docker/Dockerfile.storage` with separate server/client targets and include
the upstream AGPL license and source identity. Building needs access to the Go
module proxy/checksum service and base-image registry; subsequent builds reuse
BuildKit caches. Do not rebuild or replace an existing storage service as part
of an application upgrade. Operators providing reviewed prebuilt equivalents
can set `AGENTIF_MINIO_IMAGE` and `AGENTIF_MC_IMAGE` privately and skip their
source builds; these images are not application Web/API build arguments.

Content and snapshots share the `content` volume at `/data`; logs, database,
Redis and objects have separate named volumes. The PostgreSQL 18 volume is
mounted at `/var/lib/postgresql`, not the older `/var/lib/postgresql/data` layout.
Fresh volumes inherit the image's node UID 1000 permissions. Bind mounts instead
require you to prepare writable directories for UID/GID 1000; startup never
recursively changes ownership of existing data.

## 3. HTTPS and Browser Storage

Before opening the installation to other users, create and verify the operator's
account through the normal registration/login flow. Use a restricted proxy or
SSH tunnel during this bootstrap; do not make the first registrant an automatic
administrator. If needed, enable email registration explicitly in the isolated
installation's `auth_settings` using the migration owner. After the operator has
logged in and a profile exists, promote only that verified account with a
reviewed SQL command (replace the example address):

```bash
docker compose --env-file .env.prod exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
BEGIN;
DO $$
DECLARE affected integer;
BEGIN
  UPDATE profiles SET role = 'admin'
  WHERE email = 'operator@example.com'
    AND id IN (SELECT id FROM auth_users WHERE email = 'operator@example.com' AND email_verified);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Expected exactly one verified operator profile'; END IF;
END $$;
COMMIT;
SQL
```

For external PostgreSQL, run the same SQL through its migration-owner connection.
Log out/in and confirm admin access; configure registration policy and Dify from
the administration UI. No default administrator account or password is shipped.

Only Web and the S3 API are mapped, by default to loopback ports 3000 and 9000.
API, PostgreSQL, Redis and the MinIO console are not published. Existing host
Nginx/Caddy should terminate HTTPS. For a remote reverse proxy, explicitly set
`WEB_BIND_IP` / `STORAGE_BIND_IP` to a restricted reachable interface and apply a
firewall allowlist; do not expose databases to solve container connectivity.

Example Nginx locations, in separate TLS virtual hosts with your own certificates:

```nginx
# chat.example.com
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 32m;
}
```

```nginx
# storage.example.com
location / {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    client_max_body_size 32m;
}
```

Use `S3_PRESIGN_ENDPOINT=https://storage.example.com`, not an internal service
hostname. Preserve the signed Host (including nonstandard ports), query string
and object path: no bucket-prefix rewrites. MinIO's allowed CORS origin is set
from `NEXT_PUBLIC_APP_URL`; changing it requires recreating MinIO, not deleting
its volume. With an external S3 store, configure CORS for your exact app origin,
GET/PUT/HEAD and required request headers at that provider. Verify browser
preflight and signed upload/download with a private bucket. The Compose stack
forces `S3_PUBLIC_READ_ENABLED=false`; do not make a whole bucket anonymous.

## 4. External Dependencies

Set `DATABASE_URL`, `REDIS_URL` and S3 settings to reachable external endpoints;
leave data services you do not need stopped. There are deliberately no hard
`depends_on` links to local data services. Start only the desired ones, e.g.
`--profile data up -d --wait redis`. `up -d web api` starts no data services.
For an existing database, **skip `db-init`** and use reviewed pending migrations
with a separate migration owner. For an existing bucket/identity, **skip
`storage-init`** and verify scoped permissions and CORS at the provider.

Container loopback is not host loopback. Existing host-only PG/PgBouncer/Redis
need a separately reviewed restricted connection design. This bridge stack is
not a drop-in migration of host PM2 into host networking: its rewrites are baked
for the `api` service. Do not point it at live data until backup, compatibility,
connectivity and restoration have been validated.

## 5. Upgrade and Rollback

1. Record the old commit, image ID, private configuration and stable project name.
   Back up database/roles, objects, runtime content/snapshots and secrets. Verify
   a restore path; retain the old source, Compose file and image. Never run
   `down -v`, clear a bucket, or replay `db-init` during an upgrade.
2. Prepare the confirmed new release in a separate source directory. Review only
   pending SQL since the installed version. Apply it once using a migration
   owner and `psql -v ON_ERROR_STOP=1` (or your migration tooling), after checking
   old-code compatibility and stopping writers if required. Use the host
   runbook's role/default-privilege rules; no automatic schema downgrade exists.
   For bundled PostgreSQL, apply each **reviewed pending file** explicitly,
   replacing the example filename; do not loop over all migration files:

   ```bash
   docker compose --env-file .env.prod exec -T postgres sh -c \
     'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
     < database/migrations/REVIEWED_PENDING_MIGRATION.sql
   ```

   For an external database, use its migration-owner connection instead.

3. Set a new immutable `AGENTIF_IMAGE` and verified `SOURCE_COMMIT` in a new private
   config copy. Retain the project name so existing named volumes are reused.
4. Export operational content privately if UI translations were customized:

   ```bash
   set -o pipefail
   umask 077
   mkdir -p /safe/path/build-content
   docker compose --env-file .env.prod run --rm -T --no-deps \
     --entrypoint tar content -C /data/runtime -cf - messages content \
     | tar -C /safe/path/build-content -xf -
   ```

   Build with the exported directory using BuildKit directly (the tag must match
   `AGENTIF_IMAGE`; this does not push an image):

   ```bash
   docker build --build-context runtime-content=/safe/path/build-content \
     --build-arg SOURCE_COMMIT=<verified-commit> \
     --build-arg NEXT_PUBLIC_APP_URL=https://chat.example.com \
     --tag agentifui:<new-release> .
   ```

   Supply **all** selected public build arguments (branding, GitHub/SSO flags,
   session-cache options) in the direct command, matching the private config.
   The directory must contain only trusted `messages/` and `content/pages/`, no
   configuration or credentials. It overrides the Dockerfile's public-default
   content stage; it is a content build input, **not** a secret transport. Selected
   translations intentionally become compiled image/browser content and may be
   retained in local build cache: do not put secrets in them. A separate content
   context also avoids BuildKit's small secret-file size limit. Export before upgrading content; the
   build merges missing translation keys without changing the live volume.
   Without custom translations, normal `build web` uses public defaults.

5. Using the **new image**, explicitly prepare content with
   `docker compose --env-file .env.prod run --rm content content-upgrade`.
   It validates and snapshots existing content, preserves existing values and
   adds missing translation keys. Page schema conflicts stop deployment rather
   than overwriting operator data. Rebuild if translations changed after export.
6. `docker compose --env-file .env.prod up -d --wait --no-build web api` recreates
   only the applications. Confirm login/logout, two-turn chat, refresh/history,
   file upload/download/delete and required external auth/email integrations.

For compatible schema/content rollback, restore the prior config and image tag
and recreate Web/API only, using the prior Compose file and same project name.
Do not recreate data services just to roll back app code. If data/schema is no
longer backward compatible, stop and choose a forward fix or an explicitly
planned backup restore; an old image alone is not a database rollback.

## 6. Diagnosis and Backups

Use `docker compose --env-file .env.prod ps`, `logs --tail 100 web api`, and
`run --rm content content-check`. Health checks are local to each process and
do not create a Web/API startup dependency cycle. Health is not full business
acceptance; a restart policy also does not restart every unhealthy service.
API handles termination signals; Compose grants up to 60 seconds for shutdown.

Use PostgreSQL-aware database/role exports, provider-aware object backups and
volume content exports. A live raw filesystem copy of PG data is not a
consistent database backup. Keep encryption/auth keys with restricted backups;
losing `API_ENCRYPTION_KEY` prevents decryption of existing provider secrets.
Record restore steps, test them in isolation, and verify persistence after
recreating application containers. Never publish resolved environment, tokens,
SMTP bodies or private backup archives in issue reports.

Example exports for the bundled services, to a private path outside the source.
For a matched cross-service recovery point, stop application writers in a
maintenance window first; these separate exports are not an atomic snapshot:

```bash
umask 077
mkdir -p /safe/path/backup/objects
docker compose --env-file .env.prod exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > /safe/path/backup/database.dump
docker compose --env-file .env.prod exec -T postgres sh -c \
  'exec pg_dumpall -U "$POSTGRES_USER" --globals-only' \
  > /safe/path/backup/roles.sql
docker compose --env-file .env.prod run --rm -T --no-deps \
  --entrypoint tar content -C /data -cf - . > /safe/path/backup/content.tar
docker compose --env-file .env.prod run --rm \
  --volume /safe/path/backup/objects:/backup --entrypoint sh storage-init -ec \
  'mc alias set backup "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
   mc mirror "backup/$S3_BUCKET" /backup'
cp .env.prod /safe/path/backup/application.env
chmod 600 /safe/path/backup/application.env
```

For external services, use the provider's equivalent consistent backup tools.
Restore rehearsal uses a separate database/project and bucket, never overwrites
live data: review the roles export before restoring into a different cluster,
create an empty restore database, then feed the custom dump to `pg_restore
--exit-on-error` there. Existing roles in the same cluster need not be recreated.
Restore content and objects into separate destinations, validate grants, RLS,
encryption keys and business reads, and only then plan a real cutover. Skip
`db-init` for a restored database. Backup exports alone are not a tested restore.
