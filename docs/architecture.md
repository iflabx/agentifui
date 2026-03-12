# AgentifUI Architecture

## Scope

This document describes the current repository architecture as of March 12, 2026. It is intentionally narrower than a long-term vision document: the goal is to explain how the codebase works today.

## Repository Shape

AgentifUI is a small monorepo with three main runtime areas:

| Area           | Path                          | Role                                                                   |
| -------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Web app        | `app/`, `components/`, `lib/` | Next.js UI, auth handlers, server utilities, route compatibility layer |
| API sidecar    | `apps/api/`                   | Fastify server for business APIs and proxy-heavy internal routes       |
| Shared package | `packages/shared/`            | Cross-runtime helpers used by multiple packages                        |

## Runtime Topology

```text
Browser
  -> Next.js App Router
      - pages / layouts / SSR
      - better-auth endpoints
      - selected compatibility route handlers
  -> selected /api/* rewrites
      -> Fastify sidecar (apps/api)
          -> PostgreSQL
          -> Redis
          -> MinIO / S3
          -> Dify upstreams
```

The split is deliberate:

- Next.js owns UI rendering, auth entrypoints, and a small number of route handlers that must stay in the App Router.
- Fastify owns the increasingly centralized business API surface, especially routes that need explicit envelopes, shared proxy policy, and stronger operational control.

## Current Request Boundaries

### Routes that stay in Next.js

These continue to execute in the App Router layer:

- `app/api/auth/better/[...all]/route.ts`
- `app/api/auth/sso/providers/route.ts`
- `app/api/sso/[providerId]/*`
- `app/api/internal/auth/*`
- compatibility stubs such as `app/api/internal/data/route.ts` and `app/api/internal/error-events/client/route.ts`

Those compatibility stubs are intentional. When Fastify proxying is disabled, they return explicit `503` envelopes instead of silently serving stale logic.

### Routes that are normally served by Fastify

When `FASTIFY_PROXY_ENABLED` is on, Next.js rewrites selected prefixes to Fastify. The current default prefix list is defined in:

- `next.config.ts`
- `apps/api/src/config.ts`

The active list includes:

- `/api/dify`
- `/api/internal/data`
- `/api/internal/apps`
- `/api/internal/profile`
- `/api/internal/error-events/client`
- `/api/internal/realtime`
- `/api/internal/storage`
- `/api/internal/ops/dify-resilience`
- `/api/internal/dify-config`
- `/api/internal/fastify-health`
- `/api/admin`
- `/api/translations`

Guard scripts are part of the architecture here. They prevent drift between the Next rewrite layer, the Fastify route contract, and the disabled Next compatibility handlers.

## Data Access Pattern

The repository uses PostgreSQL as the primary source of truth.

### Next.js side

Most Next.js server-side data access lives under `lib/`:

- `lib/db/` contains direct DB-oriented modules for business entities.
- `lib/server/pg/` manages connection pooling and session-scoped actor context.
- `lib/services/` contains higher-level orchestration around Dify, caching, content flows, and admin logic.

### Fastify side

Fastify routes live in `apps/api/src/routes/` and use `apps/api/src/lib/` plus shared repository logic from the main app. The sidecar centralizes:

- route-level error envelopes
- proxy policy
- auth/session lookup for proxied requests
- storage and realtime route behavior
- operational health and observability endpoints

## PostgreSQL Security Model

The project has moved to local PostgreSQL ownership and no longer depends on Supabase tables or `auth.users`.

Key runtime ideas:

- RLS is enabled on the main business tables through SQL migrations.
- The application sets PostgreSQL GUCs such as `app.current_user_id`, `app.current_user_role`, and `app.rls_system_actor` per request.
- `APP_RLS_STRICT_MODE=1` tightens the legacy bypass behavior so only explicit system-actor contexts can bypass actor checks.

Relevant implementation files:

- `lib/server/pg/pool.ts`
- `lib/server/pg/session-options.ts`
- `lib/server/pg/user-context.ts`
- `database/migrations/20260215030000_m4_rpc_rls_guc_hardening.sql`
- `database/migrations/20260215050000_m4_table_rls_phase2.sql`
- `database/migrations/20260215070000_m4_table_rls_phase3.sql`
- `database/migrations/20260215080000_m4_rls_strict_mode_switch.sql`

## Auth and Identity Model

Authentication is provided by better-auth, backed by PostgreSQL tables in `public`:

- `auth_users`
- `auth_sessions`
- `auth_accounts`
- `auth_verifications`

Business-facing profile and identity data are separate:

- `profiles`
- `user_identities`
- `profile_external_attributes`
- `sso_providers`
- `domain_sso_mappings`
- `auth_settings`

This split lets the app keep auth persistence, business profile state, and external IdP metadata distinct.

## Realtime and Caching

Realtime is currently anchored on a database outbox pattern.

- `database/migrations/20260215170000_m6_realtime_outbox_cdc.sql` creates `realtime_outbox_events` and triggers on key business tables.
- Redis is used for cache invalidation and broker-style helpers.
- When realtime-sensitive prefixes are proxied through Fastify, `REALTIME_SOURCE_MODE` must stay `db-outbox`.

This rule is enforced at Fastify startup in `apps/api/src/server.ts`.

## Storage

Object storage uses MinIO or another S3-compatible backend.

Current public storage flows include:

- avatar upload and presign endpoints
- content-image upload and presign endpoints
- optional trusted-avatar host filtering

Relevant code paths:

- `app/api/internal/storage/*`
- `apps/api/src/routes/internal-storage-*`
- `lib/services/content-image-upload-service.ts`
- `lib/utils/profile-cache-security.ts`

## Error Handling and Observability

The architecture standardizes error envelopes across Next.js and Fastify.

Important pieces:

- shared request-id propagation
- compatibility normalization of legacy errors
- persisted API/frontend error events in `error_events`
- smoke checks for production routes
- guard scripts for route and envelope consistency

The recent `/api/internal/error-events/client` cutover is an example of this pattern: Fastify serves the live route, while the Next.js file remains as an explicit disabled stub for cutover-off mode.

## Deployment Model

The supported production shape is:

- `AgentifUI-Prod` - Next.js process managed by PM2
- `AgentifUI-API-Prod` - Fastify process managed by PM2
- deployment entrypoint: `pnpm deploy`
- PM2 config: `ecosystem.prod.config.js`
- smoke check: `scripts/smoke-prod.sh`

There is no separate public staging runbook in this repository. The documented public flows are `dev`, isolated `test`, and `prod`.

## CI Model

GitHub Actions currently runs on pushes and pull requests for both `main` and `develop`.

The pipeline does the following:

- install dependencies with pnpm
- run format/lint checks on changed files
- run root and workspace type checks
- start isolated PostgreSQL, Redis, and MinIO services on the GitHub runner
- apply SQL migrations
- build shared, API, and web packages
- run tests
- run lightweight security scans

This matters architecturally because the repository now assumes monorepo-aware CI and explicit service startup for build/test verification.

## Architectural Invariants

These are the current rules worth preserving:

1. Fastify and Next route boundaries must stay explicit.
2. Prefix lists for rewrites and Fastify registration must stay in sync.
3. Business data should flow through PostgreSQL with RLS-aware actor context.
4. Test and CI environments should use isolated database, Redis, and bucket namespaces.
5. Disabled compatibility routes should fail closed, not silently serve stale business logic.
