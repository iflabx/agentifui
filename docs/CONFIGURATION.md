# Runtime Configuration Guide

## Scope

This document covers the public runtime configuration surface for development, test, and production use.

For the exhaustive variable list, treat these template files as the source of truth:

- `.env.example`
- `.env.prod.example`
- `.env.test.example`

## Environment Profiles

| File                | Purpose                         |
| ------------------- | ------------------------------- |
| `.env.dev`          | local development profile       |
| `.env.prod`         | production runtime profile      |
| `.env.test`         | isolated test / CI-like profile |
| `.env.example`      | base development template       |
| `.env.prod.example` | production template             |
| `.env.test.example` | test template                   |

The helper `scripts/with-env-local.sh` loads `.env.dev` by default, or the file pointed to by `AGENTIF_ENV_FILE`.

Example:

```bash
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm test
```

## Core Application Settings

### URLs and ports

- `NODE_ENV`: usually `development`, `test`, or `production`
- `PORT`: Next.js HTTP port; defaults to `3000`
- `NEXT_PUBLIC_APP_URL`: public base URL for the web app
- `BETTER_AUTH_URL`: callback/sign-in base URL used by better-auth
- `CORS_ALLOWED_ORIGINS`: comma-separated allowed origins for runtime APIs
- `DEV_ALLOWED_ORIGINS`: additional dev-only origins allowed by Next.js

Fastify allows credentialed CORS only for exact origins in `NEXT_PUBLIC_APP_URL` and `CORS_ALLOWED_ORIGINS`, including the scheme and port. With neither configured, it grants no cross-origin access. Requests without an `Origin` header still work; CORS does not replace authentication or authorization.

If you expose a dev container over a host-mapped port, update the URL variables above to the externally reachable address instead of leaving them at `127.0.0.1`.

## PostgreSQL

Required runtime variables:

- `DATABASE_URL`: main application connection string
- `MIGRATOR_DATABASE_URL`: privileged connection string used for schema bootstrap or migrations

Optional / deployment-specific variables:

- `PGURL`: fallback connection string used by some scripts
- `APP_DATABASE_ROLE`: dedicated runtime role name, typically for prod
- `APP_DATABASE_PASSWORD`: password for that runtime role
- `APP_RLS_STRICT_MODE`: `1` enables strict RLS behavior
- `PG_POOL_MAX`
- `PG_POOL_IDLE_MS`
- `PG_POOL_CONNECT_MS`

## Redis and Realtime

Minimum:

- `REDIS_URL`
- `REDIS_PREFIX`

Optional cache and channel isolation knobs:

- `CACHE_L2_REDIS_ENABLED`
- `CACHE_L2_KEY_PREFIX`
- `CACHE_L2_REDIS_INVALIDATION_ENABLED`
- `CACHE_L2_INVALIDATION_CHANNEL`
- `REALTIME_REDIS_CHANNEL`
- `REALTIME_REDIS_STREAM_KEY`
- `CACHE_DEBUG_LOGS`

Realtime mode:

- `REALTIME_SOURCE_MODE`
  - supported values: `db-outbox`, `app-direct`, `hybrid`
  - if Fastify is proxying realtime-sensitive prefixes, keep this at `db-outbox`

## S3 / MinIO Storage

Required:

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Common optional settings:

- `S3_REGION`
- `S3_ENABLE_PATH_STYLE`
- `S3_PUBLIC_BASE_URL`
- `S3_PUBLIC_READ_ENABLED`
- `TRUSTED_AVATAR_HOSTS`

Legacy compatibility switches still supported by runtime code:

- `STORAGE_LEGACY_RELAY_ENABLED`
- `NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED`

Use those only when you intentionally need the legacy relay upload path.

## Fastify Sidecar and Proxy

These variables control the split runtime between Next.js and Fastify.

- `FASTIFY_PROXY_ENABLED`
  - if unset, the current code treats proxy rewrites as enabled by default
- `FASTIFY_PROXY_BASE_URL`
- `FASTIFY_PROXY_PREFIXES`
- `FASTIFY_API_HOST`
- `FASTIFY_API_PORT`
- `FASTIFY_LOG_LEVEL`
- `FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS`
- `NEXT_UPSTREAM_BASE_URL`
- `FASTIFY_AUTH_SESSION_COOKIE_NAMES`

Operational scripts:

- `pnpm fastify:cutover:on`
- `pnpm fastify:cutover:off`

These scripts validate route behavior around the rewrite boundary and are part of the supported runtime tooling.

## better-auth and SSO

Core switches:

- `BETTER_AUTH_ENABLED`
- `AUTH_BACKEND`
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED`: set `false` to hide GitHub social-login
  entry points while keeping the generic capability available in mainline
- `NEXT_PUBLIC_SSO_ONLY_MODE`
- `DEFAULT_SSO_EMAIL_DOMAIN`

Static provider / mock OAuth configuration:

- `BETTER_AUTH_SSO_PROVIDERS_JSON`
- `BETTER_AUTH_SSO_STRICT`
- `BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON`

Better Auth rejects SSO discovery and endpoint URLs that resolve to private
networks unless their exact origins are explicitly trusted. For an internal
identity provider, add only the required origins to
`BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated). Do not disable the protection
or use a wildcard. Keep actual endpoints and credentials in private environment
files, not in the repository.

Session identity synchronization knobs:

- `AUTH_IDENTITY_SYNC_INLINE`
- `AUTH_IDENTITY_RECOVER_MISSING_MAPPING`: allow one compensating sync when
  read-only resolve finds a missing identity mapping or profile row
- `AUTH_IDENTITY_SYNC_RETRY_ATTEMPTS`
- `AUTH_IDENTITY_SYNC_RETRY_DELAY_MS`

Password reset settings:

- `AUTH_RESET_PASSWORD_MODE`
- `AUTH_RESET_PASSWORD_SUBJECT`
- `AUTH_RESET_PASSWORD_EMAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

Phone OTP settings:

- `AUTH_PHONE_OTP_ENABLED`
- `AUTH_PHONE_OTP_MODE`
- `AUTH_PHONE_OTP_LENGTH`
- `AUTH_PHONE_OTP_EXPIRES_IN`
- `AUTH_PHONE_OTP_ALLOWED_ATTEMPTS`
- `AUTH_PHONE_SIGNUP_ON_VERIFICATION`
- `AUTH_PHONE_TEMP_EMAIL_DOMAIN`
- `AUTH_PHONE_OTP_API_URL`
- `AUTH_PHONE_OTP_API_TOKEN`
- `AUTH_PHONE_OTP_API_TOKEN_HEADER`
- `AUTH_PHONE_OTP_HTTP_TIMEOUT_MS`

## Encryption and Secrets

- `API_ENCRYPTION_KEY`: required for encrypted provider/API-key storage
- `BETTER_AUTH_SECRET`: required when better-auth is enabled in production

Do not reuse production secrets in dev or test profiles.

## Dify Proxy Resilience

Supported runtime controls:

- `DIFY_PROXY_TIMEOUT_MS`
- `DIFY_PROXY_CIRCUIT_ENABLED`
- `DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD`
- `DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS`
- `DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS`
- `DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`
- `DIFY_PROXY_CIRCUIT_FAILURE_STATUSES`
- `DIFY_PROXY_CIRCUIT_SHARED_STATE_ENABLED`
- `DIFY_PROXY_CIRCUIT_SHARED_METRICS_ENABLED`

## Dify Input Moderation

Optional Fastify-side guardrail controls:

- `DIFY_INPUT_MODERATION_ENABLED`
- `DIFY_INPUT_MODERATION_APP`

Behavior:

- applies only to proxied Dify `chat-messages` and `completion-messages`
- runs before the Fastify proxy forwards the request upstream
- when enabled, `DIFY_INPUT_MODERATION_APP` must be valid JSON with:
  - `apiUrl`
  - `apiKey`
- if the moderation app marks input unsafe, the proxy returns
  `CONTENT_MODERATION_BLOCKED`
- if the moderation app is unavailable or returns an invalid payload, the proxy
  fails closed with `CONTENT_MODERATION_UNAVAILABLE`

Example:

```env
DIFY_INPUT_MODERATION_ENABLED=true
DIFY_INPUT_MODERATION_APP={"apiUrl":"https://your-dify-host/v1","apiKey":"app-xxxxxxxxxxxxxxxx"}
```

## Dify Temporary Config

`_temp_config` is an admin-only verification path for temporary Dify connectivity checks.

Variables:

- `DIFY_TEMP_CONFIG_ENABLED`
- `DIFY_TEMP_CONFIG_ALLOWED_HOSTS`
- `DIFY_TEMP_CONFIG_ALLOW_PRIVATE`

Behavior:

- non-admin requests are rejected
- hosts must match the allowlist
- private and loopback targets stay blocked unless explicitly allowed
- temporary config requests are forced to safe verification behavior

## Public Branding

The public defaults are `AgentifUI` and `example.com`. Set `NEXT_PUBLIC_BRAND_NAME` and `NEXT_PUBLIC_BRAND_DOMAIN` in each environment's private env file without modifying source. An explicit brand name controls the document title, dynamic title base and sidebar application name, including installations with existing translations. Without an override, translated dynamic titles and sidebar labels are preserved; document metadata defaults to `AgentifUI`. Other copy changes only where it uses `{productName}` or `{publicDomain}` placeholders; literal page text, project attribution and operator-edited content are not automatically rewritten. The domain is display text, without a scheme or path; it does not configure routing, CORS or authentication URLs. Keep `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL` and allowed origins set to the real access URL, including its port.

These values are intentionally public and must not contain secrets. Next.js compiles them into the Web build, while the API uses its process environment for translation protection. Build and start both processes with matching values; rebuild when changing branding. Existing installations should record their desired branding in the private env file before upgrading. Development, Stage and production may use different values.

The existing production-test Dockerfile accepts `NEXT_PUBLIC_BRAND_NAME` and `NEXT_PUBLIC_BRAND_DOMAIN` as explicit `--build-arg` inputs. Actual environment files are excluded from the build context; provide the same branding values to Web/API at container startup. Compose `env_file` alone cannot configure values already embedded during the image build. Validate the same code revision in each environment, but do not promote a Stage build containing Stage-specific public settings to production unchanged.

## Editable Content Storage

`AGENTIF_RUNTIME_DIR` is an absolute, environment-specific directory outside the source/release directory. It contains `content/pages/` and `messages/`; Web build preparation and API content editing must use the same environment's value. A configured missing or invalid directory fails rather than falling back to tracked defaults. Do not point Dev and Stage at production content.

For a fresh configured development environment, initialize it once:

```bash
AGENTIF_ENV_FILE=.env.dev bash scripts/with-env-local.sh node scripts/prepare-runtime-content.mjs --init
```

Without this variable, the development/build commands initialize an ignored `output/runtime/` fixture from tracked defaults. This fallback is for local development and CI, not production: deployment requires a stable external directory. Development commands prepare ignored `output/build-messages/` before starting; direct `next` commands bypass this preparation and are not supported entry points.

Admin edits do not change repository defaults. The public `/api/translations/:locale` endpoint and admin translation operations read the same runtime directory; invalid configured storage does not fall back to source defaults. Web translations are compiled from `output/build-messages/` and become visible after preparation and rebuilding; API save success does not mean an existing production build changed. Existing operational values override matching default keys. When testing changes to the public defaults themselves, use a fresh isolated runtime fixture rather than an existing customized environment. Pages keep their existing API-reading behavior.

Production initialization, upgrade snapshots and recovery are described in [QUICK-DEPLOYMENT.md](QUICK-DEPLOYMENT.md). Publication protection is described in [PUBLICATION.md](PUBLICATION.md).

## Profile Selection

- Use `.env.dev` for local feature work.
- Use `.env.test` for isolated test runs and CI-like checks.
- Use `.env.prod` for PM2-managed production deployment.

See also:

- `docs/QUICK-DEPLOYMENT.md`
- `docs/TEST-ENV.md`
