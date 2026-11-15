# Runtime Configuration Guide

## Scope

This document covers the public runtime configuration surface for development, test, and production use.

For the exhaustive variable list, treat these template files as the source of truth:

- `.env.example`
- `.env.prod.example`
- `.env.test.example`

For the installation sequence, choose [Docker](DOCKER.md) or
[host/PM2](QUICK-DEPLOYMENT.md). For website-managed records, follow the
[administrator guide](ADMIN-GUIDE.md); for routine diagnosis and recovery, see
[operations](OPERATIONS.md).
For a first installation, start with [the complete first-use path](GETTING-STARTED.md).
Review [deployment security and data handling](SECURITY-PRIVACY.md) before
exposing signup, service credentials or storage to users.

## Where To Configure What

| Configuration                                                                  | Owner and storage                                         | How changes take effect                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Database, Redis, S3, SMTP, encryption/auth secrets, callback origin            | Operator; private server environment                      | Restart PM2 with the intended configuration, or recreate the affected Docker applications with updated runtime values |
| `NEXT_PUBLIC_*`, Web rewrite target and compiled UI translations               | Operator; public build inputs/private runtime content     | Prepare content and rebuild Web/image, then deploy with matching runtime configuration                                |
| Providers, service instances, upstream API keys, application access and groups | Administrator; database records via the administration UI | Normally no image rebuild; protected identity/credential edits may be blocked by unresolved work                      |
| Home/About page copy                                                           | Administrator; persistent runtime content                 | Runtime page loading; not a substitute for rebuilding compiled interface translations                                 |
| Advanced backend profiles                                                      | Maintainer; reviewed instance configuration               | Confirm supported service contract and migrations before enabling; not every profile has a form control               |

Changing a private env file alone does not change a running process. Docker
Compose only passes the mapped variables; `docker compose restart` does not load
new environment values. Recreate the affected application services through the
installation's update procedure, retaining their data volumes. For capacity mode,
use its version/configuration replacement procedure rather than changing values
under an active scaling operation. A public-origin change also needs a Web
rebuild and matching proxy/auth/storage configuration. Keep the existing encryption
key for stored provider credentials; replacing it is not routine token rotation.

The website does not provide a general environment-file editor. In particular,
GitHub OAuth App credentials and SMTP are server settings, while Dify/LangChain
application service tokens belong in the encrypted instance-key field. A login
provider, Agent provider and user's website account are separate concepts.

## Common Configuration Tasks

These are configuration recipes, not an alternative installation sequence. Apply
them to the private configuration and deployment method you actually use. Do not
copy a complete production environment into the repository or a public report.

### Set Or Change The Public Website Address

For a fictional HTTPS installation:

```env
NEXT_PUBLIC_APP_URL=https://agents.example.com
BETTER_AUTH_URL=https://agents.example.com
CORS_ALLOWED_ORIGINS=https://agents.example.com
```

Use the externally visible scheme, host and nonstandard port, if any. The brand
display domain is not the public origin. Do not change private database or API
addresses to the public website address just because the website domain changes.

1. Configure TLS and the reverse proxy for the new address, preserving the
   Web-owned auth routes and streaming behavior.
2. Update private build/runtime values together. Check OAuth/SSO callback
   registrations, browser storage-signing origin and storage CORS separately;
   a website-domain change does not rewrite stored object URLs.
3. Prepare and rebuild Web/the image in a separate release with the new public
   settings, then follow the selected runbook's application update procedure.
4. Sign in at the new address; old-domain cookies do not move to it. Check login,
   streaming, history and any enabled upload/download functionality.

### Enable GitHub Sign-In

1. Register a GitHub OAuth App for this deployment. Its callback is
   `https://agents.example.com/api/auth/better/callback/github` for the example
   origin above, not the application's home page and not a repository webhook.
2. Set private `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` values on the server.
   A repository personal-access token cannot replace these credentials.
3. Set `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=true` for the Web build and matching
   runtime. Rebuild/redeploy Web; ensure its runtime has both private values.
4. Use an intended test identity to check the redirect, callback and signed-in
   profile. A visible button alone does not validate provider credentials, and
   an existing email identity may be subject to account-linking restrictions.

### Enable Registration And Password-Reset Email

Use these non-secret mode settings alongside your privately supplied SMTP values:

```env
AUTH_EMAIL_DISABLED=0
AUTH_EMAIL_VERIFICATION_MODE=smtp
AUTH_RESET_PASSWORD_MODE=smtp
SMTP_PORT=465
SMTP_SECURE=true
```

Port 465 with implicit TLS is an example; use your provider's actual port and
TLS requirements. Also supply `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and an
authorized `SMTP_FROM`. Restart/recreate Web with those runtime values; SMTP
changes alone do not require a Web rebuild. Registration verification and reset
share the SMTP transport but use different templates/purposes and common
per-recipient limits described under [authentication](#better-auth-and-sso).
Do not use a real provider password as a public example.

Setting `AUTH_EMAIL_DISABLED=1` disables the documented email endpoints and
delivery; it does not disable existing password sign-in or automatically hide
every registration link. It is not a substitute for selecting a usable sign-in
method or maintaining a consistent visible registration policy.

### Hide Phone OTP Without Disabling Other Login Methods

Set `AUTH_PHONE_OTP_ENABLED=false` in the actual Web process environment and
restart/recreate that service. The login/register links disappear, phone OTP
endpoints are disabled and `/phone-login` redirects to `/login`. This is a
runtime setting, not a compiled public flag. The shipped Compose mapping already
sets it to `false`; changing an unmapped dotenv entry cannot override a fixed
Compose value. Use an explicit private override if enabling a supported phone
provider in that topology. Email/password, GitHub and SSO remain independent.

### Add Or Rotate An Agent Service Credential

Use the administrator's provider/instance forms, not the GitHub login settings or
Web build arguments. Set the provider endpoint and instance's encrypted service
key; choose the actual Dify/LangChain backend and supported application category.
This normally takes effect without rebuilding the website. Keep
`API_ENCRYPTION_KEY` unchanged so existing records remain decryptable.

For a genuinely different service/assistant identity, create a separate instance
instead of reusing the identity bound to existing history. Pending or unknown
work can block protected changes, including some credential rotations. Follow
the [administrator guide](ADMIN-GUIDE.md#7-configuration-changes-and-troubleshooting)
instead of editing database fields or clearing task state to bypass those guards.

## Key Settings Reference

This is a reference for the settings most likely to affect installation and
operation, not a second exhaustive environment template. **Web** and **API** mean
the respective application process; **tools** means an explicit initialization
or migration command. Runtime changes require a process restart or container
recreation with the new values; build inputs also require rebuilding Web/image.
Database/admin records follow their own update path described above.

Defaults below distinguish **code fallback**, **template example** and
**Compose mapping**. A template value is not necessarily a safe production
default. A blank required value does not provision a dependency or credential.

### Origins, Routing And Content

| Setting                                               | Required/default behavior                                                                                                                  | Consumer and change effect                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                 | Explicit real browser origin for an installation; Compose fallback is `http://localhost:3000`, not automatic domain discovery              | Web build and Web/API runtime; rebuild and deploy matching public/auth/CORS settings                                                        |
| `BETTER_AUTH_URL`                                     | Set explicitly; code falls back to `NEXT_PUBLIC_APP_URL`, then `http://localhost:3000`; Compose maps its own localhost fallback            | Web auth runtime; origin changes also require matching public build, proxy and provider callbacks                                           |
| `CORS_ALLOWED_ORIGINS`                                | Additional exact origins; none by default in API code beyond the configured application origin; Compose has a localhost example fallback   | API and Web auth trusted-origin resolution; restart/recreate, not a wildcard or authorization bypass                                        |
| `BETTER_AUTH_TRUSTED_ORIGINS`                         | Additional exact trusted origins when needed; no arbitrary private IdP origin is automatically trusted                                     | Web auth runtime; restart/recreate; use the smallest intentional list                                                                       |
| `FASTIFY_PROXY_ENABLED`                               | Enabled when unset in Next configuration; Compose explicitly sets `1`                                                                      | Web rewrite build input; rebuild when changing the route topology                                                                           |
| `FASTIFY_PROXY_BASE_URL`                              | Code fallback `http://127.0.0.1:3010`; bridge Compose default `http://api:3010`                                                            | Web rewrite build input; rebuild; value must be reachable from Web, not necessarily the browser                                             |
| `FASTIFY_API_HOST` / `FASTIFY_API_PORT`               | API defaults `0.0.0.0` / `3010`; bind/publish deliberately                                                                                 | API runtime; restart/recreate; a listening interface is not a firewall policy                                                               |
| `NEXT_UPSTREAM_BASE_URL`                              | API code fallback `http://127.0.0.1:3000`; bridge Compose default `http://web:3000`                                                        | API-to-Web calls; restart/recreate; must reach the actual Web service                                                                       |
| `AGENTIF_RUNTIME_DIR`                                 | Stable absolute external directory required for deployment; omitted dev/build uses ignored `output/runtime/`; Compose maps `/data/runtime` | Content tooling, Web and API; prepare/migrate data before changing; rebuild compiled interface translations, not ordinary runtime page copy |
| `NEXT_PUBLIC_BRAND_NAME` / `NEXT_PUBLIC_BRAND_DOMAIN` | Public defaults `AgentifUI` / `example.com`; domain is display text, not routing                                                           | Web build and matching Web/API runtime; rebuild; never put a secret here                                                                    |

### Database, Cache And Objects

| Setting                                       | Required/default behavior                                                                                                     | Consumer and change effect                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                | Required application connection; some server helpers accept `PGURL` fallback                                                  | Web/API runtime; restart/recreate; use a non-superuser role with intended RLS/grants                               |
| `MIGRATOR_DATABASE_URL`                       | Required only for the selected bootstrap/migration tools                                                                      | Tools only; do not inject the owner credential into normal Web/API                                                 |
| `APP_DATABASE_ROLE` / `APP_DATABASE_PASSWORD` | Used by the fresh-install role setup; choose a distinct role/password as required by that runbook                             | Tools; not a second live application credential setting or an automatic existing-role rotation                     |
| `APP_RLS_STRICT_MODE`                         | Explicitly set `1` for the supported strict deployment; unset code does not force the strict startup option; Compose sets `1` | Web/API runtime PostgreSQL context; restart/recreate; migrations and non-bypass roles still matter                 |
| `PG_POOL_MAX`                                 | Shared main-pool code fallback `10`; Compose default `5`, per process                                                         | Web/API runtime; restart/recreate; account for all replicas and other pools before raising                         |
| `PG_POOL_IDLE_MS` / `PG_POOL_CONNECT_MS`      | Shared main-pool fallbacks `30000` / `5000` milliseconds                                                                      | Web/API runtime; restart/recreate                                                                                  |
| `REDIS_URL`                                   | Supply the intended Redis connection for the supported setup; no service is created automatically                             | Web/API runtime; restart/recreate; do not repoint a live installation at another environment's namespace           |
| `REDIS_PREFIX`                                | Redis manager fallback and Compose default `agentifui`; choose environment-specific values                                    | Web/API runtime; align cache/realtime keys too; changing a namespace does not migrate or clean old state           |
| `REALTIME_SOURCE_MODE`                        | Keep `db-outbox` for Fastify-proxied realtime-sensitive routes; Compose fixes this mode                                       | Web/API runtime; incompatible routing/mode fails startup validation                                                |
| `S3_ENDPOINT` and storage credentials         | Supply endpoint, bucket-scoped `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`; do not rely on example administrator credentials  | Web/API runtime; restart/recreate; storage permissions are configured separately                                   |
| `S3_BUCKET` / `S3_REGION`                     | Storage code fallbacks `agentifui` / `us-east-1`; select the real bucket/region                                               | Web/API runtime; restart/recreate; changing these does not move existing objects                                   |
| `S3_PRESIGN_ENDPOINT`                         | Falls back to `S3_ENDPOINT`; set when the browser needs a different reachable signing origin                                  | Web/API runtime; restart/recreate; signed host/path/query must be preserved                                        |
| `S3_PUBLIC_READ_ENABLED`                      | Storage code fallback `true`; shipped Compose explicitly sets `false`                                                         | Web/API runtime; restart/recreate and align bucket policy; this setting does not itself change storage permissions |

Redis cache prefixes, invalidation channels and stream keys must match across the
same installation's processes while staying isolated from other environments.
See [Redis and realtime](#redis-and-realtime). An empty cache after a namespace
change is not proof that pending task/rate-limit state was migrated safely.

### Authentication, Credentials And Delivery

| Setting                                                     | Required/default behavior                                                                                                                               | Consumer and change effect                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BETTER_AUTH_ENABLED` / `AUTH_BACKEND`                      | Explicitly select the current `true` / `better-auth` setup; the base dev template retains an old disabled rollout example, while Compose enables it     | Follow the selected auth runtime/runbook; do not treat copying the base template as complete setup           |
| `BETTER_AUTH_SECRET`                                        | Required in production auth; `AUTH_SECRET` is a compatibility fallback, not a reason to reuse an example secret                                         | Web auth runtime; restart/recreate; changing authentication keys can affect existing sessions                |
| `API_ENCRYPTION_KEY`                                        | Required for encrypted service-key storage; generate/preserve a private 32-byte hex value                                                               | Server-side credential readers/writers; restart/recreate; replacing it does not re-encrypt existing records  |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`                 | Both must be nonempty to register the built-in GitHub provider                                                                                          | Web auth runtime; restart/recreate; these are private OAuth App credentials                                  |
| `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED`                          | Defaults to `false`; explicitly set `true` only with working private credentials/callback                                                               | Web build/public UI; rebuild; not an authentication credential or proof of working login                     |
| `AUTH_EMAIL_DISABLED`                                       | Only exact `1` disables the documented signup/verification/reset endpoints and email sending; otherwise email flows remain enabled                      | Web runtime; restart/recreate; existing password/social/SSO sign-in is independent                           |
| `AUTH_EMAIL_VERIFICATION_MODE` / `AUTH_RESET_PASSWORD_MODE` | Code defaults `dev-log`; Compose defaults `smtp`                                                                                                        | Web runtime; restart/recreate; public email flows need SMTP, not token logging                               |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`      | Provide the actual provider settings/authorized sender; authentication depends on the provider, not fictional template values                           | Web runtime; restart/recreate; keep SMTP credentials out of build arguments                                  |
| `SMTP_PORT` / `SMTP_SECURE`                                 | Code port fallback `587`; absent secure setting means implicit TLS only for port `465`, otherwise STARTTLS is required; Compose defaults `465` / `true` | Web runtime; restart/recreate; explicitly match the provider's supported port/TLS pair                       |
| `AUTH_PHONE_OTP_ENABLED`                                    | Code fallback `true`; Compose explicitly sets `false`                                                                                                   | Web runtime; restart/recreate; hides links, disables endpoints and redirects the phone-login page when false |

Authentication email recipient limits are currently fixed in implementation:
one send per purpose per 60 seconds and five combined sends in a fixed 3600-second
window. There is no general administrator limit editor or environment variable
for changing those values. See [authentication and SSO](#better-auth-and-sso)
for failure behavior and the other supported settings.

### Agent Runtime Limits

| Setting                                                  | Required/default behavior                                                                                               | Consumer and change effect                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENT_MAX_ACTIVE_PER_USER` / `AGENT_MAX_ACTIVE_PER_APP` | Code defaults `1` / `2`; explicitly supplied values must be integers from `1` through `100`, not `0` for unlimited      | API admission; restart/recreate with intended configuration; different from group allowance                                          |
| `DIFY_PROXY_TIMEOUT_MS`                                  | Dify proxy default `30000` milliseconds; valid override at least `1000`; SSE uses an upstream-chunk-reset idle deadline | API proxy runtime; restart/recreate; not a universal LangChain timeout                                                               |
| `DIFY_UPLOAD_MAX_BYTES`                                  | Default `16777216` bytes; explicitly supplied decimal safe integer at least `1024`                                      | API upload route registration; restart/recreate; applies to the documented Dify file/audio multipart paths, not every storage upload |

### Check The Deployment Mapping Before Editing

The shipped `compose.yaml` is an allowlist, not `env_file` injection of every
possible setting. In particular, phone OTP, private storage reads and the
realtime mode have explicit fixed mappings. Agent concurrency settings are not
currently passed by the ordinary Compose allowlist: an intentional private
override is needed to change those API values in that topology. Host/PM2 and the
optional capacity topology have their own loading rules.

When changing a setting: identify its consumer, check the chosen topology's
mapping, preserve needed data/keys, apply the appropriate restart/recreation or
build procedure, then check the affected workflow. Do not dump a resolved Compose
file or process environment into a public report to establish the effective value.

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

For [Docker Compose](DOCKER.md), pass `--env-file .env.prod` explicitly. Compose
reads dotenv `KEY=value` entries, not shell `export`, `source` or command
substitutions. It interpolates the file into an explicit application-variable
allowlist; Web/API do not receive migration or data-service administrator
credentials. Container entrypoints read process environment directly and do not
require a configuration file inside the image. Optional variables not mapped by
`compose.yaml` need an explicit private Compose override.

For optional Linux host-network Web/API replicas, use the single
[manual capacity command](DOCKER-CAPACITY.md). It preserves the selected image,
runtime configuration and shared data; it is not a version deployment command.

`NEXT_PUBLIC_*`, Next.js rewrite destinations and compiled UI translations are
build inputs. Rebuild for changes to them; changing only a running container's
environment is insufficient. Server credentials are runtime-only and must not
be build arguments. Operational pages remain runtime content; see the Docker
runbook for exporting translations before rebuilding an existing installation.

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

Initialization/migration-only credentials:

- `MIGRATOR_DATABASE_URL`: privileged connection string used for schema bootstrap
  or migrations. Keep it out of ordinary Web/API runtime environments; it is not
  a second application connection or a way to bypass runtime RLS.

Optional / deployment-specific variables:

- `PGURL`: fallback connection string used by some scripts
- `APP_DATABASE_ROLE`: dedicated runtime role name, typically for prod
- `APP_DATABASE_PASSWORD`: password for that runtime role
- `APP_RLS_STRICT_MODE`: `1` enables strict RLS behavior
- `PG_POOL_MAX`
- `PG_POOL_IDLE_MS`
- `PG_POOL_CONNECT_MS`

Current Better Auth accounts use persisted UUID identifiers. Unknown non-UUID
session identifiers are not automatically provisioned into new profiles. Existing
legacy mappings can still be read, but an older non-UUID authentication deployment
must migrate its authentication accounts and sessions to the UUID schema before
using identity synchronization; changing an email or inventing a mapping at login
is not an account migration. No request holds a session-level advisory lock for
this fallback.

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
- `S3_PRESIGN_ENDPOINT`
- `S3_PUBLIC_BASE_URL`
- `S3_PUBLIC_READ_ENABLED`
- `TRUSTED_AVATAR_HOSTS`

`S3_ENDPOINT` is used for server-to-storage operations. Set `S3_PRESIGN_ENDPOINT`
when browsers need a different, reachable endpoint for signed uploads/downloads;
it defaults to `S3_ENDPOINT`. HTTPS pages require an HTTPS browser endpoint.
The endpoint excludes the bucket name. A reverse proxy must preserve the signed
Host (including any port), object path and query parameters; do not rewrite a URL
after signing it. `S3_PUBLIC_BASE_URL`, when used, includes the bucket path and
controls stored public object URLs independently. Existing stored URLs are not
rewritten by these settings. Bucket permissions remain unchanged.

Direct PUT grants bind both the exact declared byte length and `Content-Type` in
the S3 signature. Send the original `File`/`Blob` with the same MIME type; browsers
set `Content-Length` automatically, so do not set that forbidden header manually.
The storage gateway must preserve both signed headers, reject invalid signatures,
and allow the application's origin and PUT/GET in its CORS policy. Requests with
different sizes/types or a missing signed header fail at storage before profile
commit. Existing commit-time object checks remain in place. This does not inspect
file magic bytes, make URLs single-use, or add a storage quota: a reused grant can
only replace the same key with the same size/type until expiry. Keep presign rate
limits and operator-managed quotas/unreferenced-object cleanup; do not expire all
objects in an active avatar/content prefix indiscriminately.

For a private bucket, set `S3_PUBLIC_READ_ENABLED=0`. Application storage avatars
use the authenticated avatar download-signing endpoint before loading an image;
ordinary external identity-provider image URLs remain unchanged. Persist the
stable object URL, not an expiring signed download URL.

Legacy compatibility switches still supported by runtime code:

- `STORAGE_LEGACY_RELAY_ENABLED`
- `NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED`

Use those only when you intentionally need the legacy relay upload path.

## Fastify Sidecar and Proxy

These variables control the split runtime between Next.js and Fastify.

External reverse proxies must keep Next-owned authentication routes on the Web
service, including `/api/auth/`, `/api/sso/` and
`/api/internal/auth/profile-status`. A catch-all `/api/` rule forwarding to
Fastify needs a more-specific Web rule for the profile-status endpoint.

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
- `NEXT_PUBLIC_GITHUB_LOGIN_ENABLED`: explicitly set `true` to show GitHub
  social-login entry points after configuring the server credentials; defaults
  to `false`. Rebuild the Web application after changing this public variable.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: private GitHub OAuth App
  credentials. The built-in GitHub provider is registered only when both are
  nonempty. Never prefix these variables with `NEXT_PUBLIC_` or commit their values.
- `NEXT_PUBLIC_SSO_ONLY_MODE`
- `DEFAULT_SSO_EMAIL_DOMAIN`

Static provider / mock OAuth configuration:

- `BETTER_AUTH_SSO_PROVIDERS_JSON`
- `BETTER_AUTH_SSO_STRICT`
- `BETTER_AUTH_GENERIC_OAUTH_PROVIDERS_JSON`

GitHub login uses Better Auth's built-in `/api/auth/better/sign-in/social`
endpoint, not the generic OAuth plugin. Register the OAuth App callback as
`https://your-domain.com/api/auth/better/callback/github`, using your actual
`BETTER_AUTH_URL` origin. Keep separate OAuth Apps for environments with different
callback origins when necessary. A GitHub repository access token is not an OAuth
App client secret. Existing Supabase OAuth settings are not automatically reused.
Enable the public button only in environments where both private credentials are
configured; the display flag does not validate credentials or register a provider.
Existing account-linking restrictions remain unchanged, including restrictions
on signing in with a different provider for an existing account email.

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

Registration verification and password reset emails share the existing Nodemailer
SMTP transport. Set `AUTH_EMAIL_VERIFICATION_MODE=smtp` and
`AUTH_RESET_PASSWORD_MODE=smtp` to send both email types. Configure `SMTP_FROM`
with a sender authorized by your email provider. Keep actual credentials and
environment files outside version control; examples contain placeholders only.

Registration sends the authentication library's verification link, valid for one
hour by default. This does not require all existing users to verify their email
before signing in, or change social/SSO login policy. Password reset uses the
existing reset page and revokes existing sessions after a successful reset.
Changing a password while already signed in does not send a notification.

Both modes default to `dev-log`, which writes the link and token to server logs
instead of sending mail. Use it only for development, not a public deployment.
The sender rejects SMTP failures and never falls back to `dev-log`. The
authentication library can catch and log those failures while returning a
successful signup or a generic password-reset response; an HTTP success response
is not proof of sending. Monitor authentication delivery errors and verify actual
receipt and both links with a test account before enabling production email.
Even SMTP acceptance is not proof of inbox delivery.

SMTP authentication emails also use the existing Redis connection to limit each
recipient, independently of the authentication API's IP-based request limits:

- At most one email per purpose (verification or password reset) every 60 seconds.
- At most five emails across both purposes in a fixed 3600-second window starting
  with the first reserved send. This is not a rolling-hour limit.
- Recipient addresses are trimmed and lowercased before hashing into Redis keys;
  raw addresses and tokens are not included in those keys. Provider-specific
  aliases are not merged.
- Reservations are atomic and shared across processes using the same Redis
  database and `REDIS_PREFIX`. Rejected attempts do not consume quota or extend
  expiry. SMTP failures still consume their reservation to prevent retry abuse.
- When a limit is reached, no email is sent; the authentication endpoint retains
  its normal response rather than revealing whether an address exists. Wait for
  the relevant window before requesting another link. Redis failure prevents
  sending rather than bypassing the limit; monitor authentication errors.

These limits apply automatically in `smtp` mode, not `dev-log`, require no new
service or settings, and do not change the existing verification/login policy.

Authentication email settings:

- `AUTH_EMAIL_DISABLED`: defaults to `0`. Set exactly `1` to disable self-service
  email signup, verification and password reset endpoints, and all authentication
  email sending (including development logging). Existing password, GitHub and
  SSO sign-in remain available. Restart Web after changing this server-side flag;
  no rebuild is required. Keep the registration policy in the administration UI
  consistent; this flag does not rewrite page content or enable another login
  method. SMTP is optional only while email flows are disabled. Leave this unset
  or `0` to retain the normal SMTP configuration and delivery requirements.
- `AUTH_EMAIL_VERIFICATION_MODE`: `dev-log` or `smtp`
- `AUTH_EMAIL_VERIFICATION_SUBJECT`
- `AUTH_EMAIL_VERIFICATION_EMAIL_FROM`: overrides `SMTP_FROM` for verification
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

- `AUTH_PHONE_OTP_ENABLED` defaults to `true`. Set it to `false` to disable
  phone OTP endpoints, hide phone-login links on the login and registration
  pages, and redirect direct visits to `/phone-login` back to `/login`.
  These pages read the same server-side setting at request time; no additional
  `NEXT_PUBLIC_*` flag is required. After installing a version with this support,
  restart the Web service when changing the setting. Changing this flag alone
  does not require rebuilding the application. Email/password, GitHub and SSO
  settings are independent; existing accounts and conversations are preserved.

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

## LangChain Agent Backend

LangChain applications reuse provider URLs and encrypted service-instance API
keys. Their explicit backend configuration, service contract, server-managed
history, supported capabilities and shared concurrency settings are documented
in [LangChain Agent Integration](LANGCHAIN-INTEGRATION.md). Unconfigured
LangChain applications do not prevent Dify from starting.

## Dify Proxy Resilience

Supported runtime controls:

- `DIFY_PROXY_TIMEOUT_MS`
- `DIFY_UPLOAD_MAX_BYTES` (file/audio multipart requests only; default 16 MiB)
- `DIFY_PROXY_CIRCUIT_ENABLED`
- `DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD`
- `DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS`
- `DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS`
- `DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`
- `DIFY_PROXY_CIRCUIT_FAILURE_STATUSES`
- `DIFY_PROXY_CIRCUIT_SHARED_STATE_ENABLED`
- `DIFY_PROXY_CIRCUIT_SHARED_METRICS_ENABLED`

In the Fastify Dify proxy, `DIFY_PROXY_TIMEOUT_MS` covers the complete ordinary
response, including body consumption. SSE responses switch to an idle deadline
reset by each upstream chunk, so active long-running conversations are not cut
off by a fixed total duration. The same setting is the SSE idle limit; configure
it to tolerate the upstream's longest normal pause/heartbeat interval. Downstream
disconnects cancel outstanding upstream work. Body timeout before sending a
response returns 504; failures after streaming starts close the stream instead
of attempting a second JSON response. Success metrics are recorded when the
body finishes, not merely when response headers arrive.

Dify failure logs keep request identifiers, normalized error codes, status,
response byte counts, and timing instead of response previews or raw exceptions.
Input-moderation failures follow the same policy. Error events written to the
database and local mirror keep generic messages and fixed diagnostic context,
not upstream error text or free-form upstream context. Existing client-facing
error fields remain unchanged; captured responses can still contain sensitive
upstream details and must not be shared as ordinary diagnostic logs. This policy
does not retroactively remove data from existing logs or error records.

See [Dify Service API compatibility](DIFY-INTEGRATION.md) for upload-limit scope,
version-specific endpoint behavior and currently unsupported features.

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
