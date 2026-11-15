# AgentifUI Architecture

## Scope

This document describes the current repository architecture, updated November 15, 2026. It is intentionally narrower than a long-term vision document: the goal is
to explain how the codebase works today. For local setup, source navigation and
change examples, use the [developer guide](DEVELOPMENT.md); for submission rules,
use [Contributing](../CONTRIBUTING.md).

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
          -> Dify or compatible LangChain services
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
- `/api/content`
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

## Agent Execution And Shared Interaction

The shared product API under `/api/internal/apps/:appId/agent` is registered in
`apps/api/src/routes/agent-runs.ts`, within the existing `/api/internal/apps`
rewrite prefix. It resolves application access and trusted local conversation/run
bindings before backend execution. It is not an unauthenticated pass-through to
an arbitrary Agent URL or a promise of a standard AG-UI HTTP endpoint.

- `apps/api/src/lib/agent-app.ts` and the submission/run repositories resolve
  backend configuration, actor access, admission and persistent identities.
- `apps/api/src/lib/agui/` adapts the bounded negotiated Dify/LangChain paths;
  `apps/api/src/lib/langchain/` owns native LangChain transport and the optional
  human-input contract. Native service differences stay behind these boundaries.
- `packages/shared/src/agui/` holds event schemas/writing and pure display/history
  projections. It has no database or backend credentials. Schema-valid upstream
  data is not automatically safe public output.
- `components/langchain/agent-chat.tsx` integrates shared product chat components
  and history. The directory name does not make the negotiated Dify path a second
  navigation or persistence system.

LangChain and explicitly opted-in Dify marketplace chatbots use negotiated AG-UI
with server-managed saving. The Dify opt-in is text-only; existing Dify model,
chatflow, workflow and other compatible paths retain their own behavior and
browser-managed saving where applicable. A conversation must not have both a
browser and server history writer.

`backend_conversations`, `backend_runs`, `agent_submissions` and
`backend_run_interactions` complement the existing local conversations/messages.
They track native bindings, execution versus saving, task admission and optional
approve/reject decisions. Backend identifiers supplied by the browser never replace
actor-scoped ownership checks. A disconnect is not cancellation, a known saved
result can support save-only recovery, and an unknown dispatch/resume must not
be blindly replayed. There is no general process-crash stream recovery.

See [AG-UI integration](AGUI-INTEGRATION.md),
[LangChain integration](LANGCHAIN-INTEGRATION.md), [Dify integration](DIFY-INTEGRATION.md)
and [generation governance](AGENT-GOVERNANCE.md) for exact negotiated profiles,
capabilities, migration requirements and failure semantics.

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
- `auth_sso_providers`

`auth_sso_providers` belongs to the Better Auth SSO plugin and is separate from
the application's `sso_providers` table. See [database design](DATABASE-DESIGN.md)
for the corresponding migration and table roles.

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

Two application installation paths share the same Web/API and data boundaries:

- **Host/PM2:** `AgentifUI-Prod` runs Next.js and `AgentifUI-API-Prod` runs
  Fastify. The deployment entrypoint is `pnpm run deploy`, with
  `ecosystem.prod.config.js` and `scripts/smoke-prod.sh`.
- **Docker:** one application image runs separate Web/API services through
  `compose.yaml`; data services can use the optional profile or external
  dependencies. The optional manual-capacity topology manages replicas through
  its own gateway/connection-pool configuration, not ordinary bridge scaling.

Both require PostgreSQL, Redis, S3-compatible storage and persistent runtime
content outside replaceable releases. Environment configuration, native backend
credentials and user/operational data are not part of the image/source defaults.
Public Web settings and prepared interface translations are build inputs;
database startup does not automatically apply migrations.

Follow [host deployment](QUICK-DEPLOYMENT.md), [Docker](DOCKER.md),
[manual Docker capacity](DOCKER-CAPACITY.md), [configuration](CONFIGURATION.md)
and [operations](OPERATIONS.md) for commands. Ordinary feature Stage acceptance
uses a separate PM2 production build; relevant Docker validation is additional
for deployment/image/startup changes and Docker deliveries. Private environment
topology is not a prerequisite for a public contributor's local setup.

## CI Model

GitHub Actions currently runs on pushes and pull requests for both `main` and `develop`.

The pipeline does the following:

- check the outgoing publication for secrets and private paths on every run
- skip heavy checks for documentation-only changes and cancel superseded runs
- install dependencies once per quality or test/build job with pnpm caching
- run format/lint checks on changed files
- run root and workspace type checks
- start isolated PostgreSQL, Redis, and MinIO services on the GitHub runner
- apply SQL migrations
- build the shared package before type checks and tests that import it, then
  build the API and web packages (or validate the full application in Docker)

Dependency auditing runs separately on a weekly schedule or manual request. It does not duplicate installation on every push or pull request. Build outputs are not uploaded because deployment builds from the selected source version with its own environment configuration.

This matters architecturally because the repository now assumes monorepo-aware CI and explicit service startup for build/test verification.

## Architectural Invariants

These are the current rules worth preserving:

1. Fastify and Next route boundaries must stay explicit.
2. Prefix lists for rewrites and Fastify registration must stay in sync.
3. Business data should flow through PostgreSQL with RLS-aware actor context.
4. Test and CI environments should use isolated database, Redis, and bucket namespaces.
5. Disabled compatibility routes should fail closed, not silently serve stale business logic.
6. Shared interaction does not erase backend capability differences or authorize
   arbitrary upstream metadata/tool output for the browser.
7. A conversation has one persistence owner; execution, saving and human decisions
   retain trusted local identities and explicit unknown-outcome handling.
