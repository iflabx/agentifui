---
layout: default
title: Development
nav_order: 7
has_children: true
---

# Developer Guide

This guide explains how to run, change, test and debug the current source. For
submitting work, start with [Contributing](https://github.com/iflabx/agentifui/blob/main/CONTRIBUTING.md). For operating an
installed instance, use [Docker](DOCKER.md), [host/PM2](QUICK-DEPLOYMENT.md) and
[operations](OPERATIONS.md) instead. A development command is not a production
deployment procedure.

AgentifUI provides an enterprise-oriented UI for external Agent services. It is
not an Agent builder or a LangChain execution host. Current supported backends
are Dify and compatible LangChain services, with explicitly bounded shared AG-UI
interaction. Future backends or protocol features are not enabled by adding a
name to a dropdown.

## 1. Find The Relevant Code

| Area                      | Main paths                                                                             | Responsibility                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web pages and layouts     | `app/`                                                                                 | App Router, navigation, server-rendered pages, authentication handlers and compatibility API stubs                |
| UI                        | `components/`                                                                          | Shared controls, chat/message rendering, application views and administration forms                               |
| Client state and requests | `lib/hooks/`, `lib/stores/`, `lib/services/client/`                                    | Browser state, history reconciliation and requests to the product APIs                                            |
| API runtime               | `apps/api/src/server.ts`, `apps/api/src/routes/`                                       | Fastify registration, authorized business routes, streaming and proxy behavior                                    |
| Agent execution           | `apps/api/src/lib/agent-*.ts`, `apps/api/src/lib/agui/`, `apps/api/src/lib/langchain/` | Trusted app/run resolution, admission, backend adaptation, persistence and human input                            |
| Shared protocol           | `packages/shared/src/agui/`                                                            | Typed contracts, event validation/writing and display/history projections without database or backend credentials |
| Server data and identity  | `lib/db/`, `lib/server/`, `lib/auth/`                                                  | Repositories, PostgreSQL actor context, authentication and identity synchronization                               |
| Schema                    | `database/migrations/`                                                                 | Ordered SQL migrations, constraints, RLS and persistent runtime state                                             |
| Public default content    | `messages/`, `content/pages/`, `public/`                                               | Shipped translations, page defaults and public assets, not an installation's private runtime content              |
| Tests                     | `__tests__/` and colocated `*.test.ts` / `*.test.tsx`                                  | Regression, component, contract, script and integration coverage                                                  |
| Tooling and deployment    | `scripts/`, `docker/`, `compose.yaml`, `.github/workflows/`                            | Public checks, runtime/deployment tools, images and CI                                                            |

Read [architecture](architecture.md) for ownership boundaries and
[database design](DATABASE-DESIGN.md) for persistent entities. Use the source
version you are changing; the latest branch's docs can differ from an older tag.

## 2. Prepare A Local Development Instance

### Toolchain And Dependencies

- Use the Node version in `.nvmrc` and `package.json` engines, currently
  **24.22.2**, and pnpm **10.34.9** from `packageManager`.
- Run commands from the repository root unless a command explicitly selects a
  workspace. Do not install separate dependency trees inside each workspace.
- Full application development needs PostgreSQL, Redis and S3-compatible
  storage. They can be dedicated local services or isolated namespaces on
  services you control. See the deployment guides for initialization rather
  than using production connections as a shortcut.
- Real conversations additionally need at least one configured Dify application
  or compatible LangChain service. Synthetic regression tests do not require a
  real model account; LangChain is not required merely to work on a Dify path.

After cloning your fork or the project, install the pinned dependencies:

```bash
npm install --global --ignore-scripts pnpm@10.34.9
pnpm install --frozen-lockfile
pnpm build:shared
cp .env.example .env.dev
```

The one npm command installs the pnpm tool itself. Use pnpm for project
dependencies and scripts. Keep `pnpm-lock.yaml` in sync with intentional package
changes; do not resolve an unrelated issue by upgrading the whole dependency set.

### Configure Development, Not Production

Edit the ignored `.env.dev`. The base template includes historical rollout
defaults and example HTTPS hosts; copying it alone does not produce a working
current login configuration. For a loopback development instance, explicitly
select matching settings such as:

```env
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
BETTER_AUTH_URL=http://127.0.0.1:3000
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3000
BETTER_AUTH_ENABLED=true
AUTH_BACKEND=better-auth
AUTH_PHONE_OTP_ENABLED=false
NEXT_PUBLIC_GITHUB_LOGIN_ENABLED=false
FASTIFY_PROXY_ENABLED=1
FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3010
FASTIFY_API_HOST=127.0.0.1
FASTIFY_API_PORT=3010
NEXT_UPSTREAM_BASE_URL=http://127.0.0.1:3000
REALTIME_SOURCE_MODE=db-outbox
```

Also set the real **development-only** database, Redis and S3 values, isolated
prefixes/bucket, `BETTER_AUTH_SECRET` and a valid `API_ENCRYPTION_KEY`. Generate
private values locally; `openssl rand -hex 32` produces a suitable new encryption
key for a new environment. Preserve that key after storing encrypted service
credentials. Do not copy a production key into an example or replace an existing
environment's key simply to make startup pass.

If you change Web/API ports, align the public origin, rewrite destination,
Fastify listener and `NEXT_UPSTREAM_BASE_URL` together. Inside a container,
`127.0.0.1` refers to that container, not the host or another service. Remote
development requires the actually reachable browser origin and appropriate
authentication/storage configuration, not just an open server port.

The development email modes default to `dev-log`, which records verification and
reset links/tokens rather than delivering mail. Use this only in an isolated
development instance; do not share its logs. SMTP testing and production email
setup are separate, controlled operations. See [configuration](CONFIGURATION.md)
for email, GitHub/SSO, branding, storage and optional settings.

### Initialize Data And Configure An Application

1. Create a new development database, a dedicated Redis namespace and an object
   bucket. Keep development and test namespaces separate even on one server.
2. Apply the repository SQL migrations in filename order to the new database
   using a migration-owner connection. Follow the role/grant instructions in
   [host deployment](QUICK-DEPLOYMENT.md#4-create-isolated-production-data-namespaces)
   or the chosen installation runbook; their database security model also
   applies to development. Do not rerun fresh-install initialization against an
   existing database. Apply only reviewed pending migrations when upgrading.
3. Use a non-superuser application connection with appropriate grants and RLS
   actor context. A migration-owner connection is not a normal Web/API identity.
4. Start the application, create/sign in to your own development account and
   follow [administrator bootstrap](ADMIN-GUIDE.md#1-bootstrap-the-first-administrator)
   if you need to configure the site. There is no shipped default admin password.
5. Configure a provider and service instance, its real backend/category and
   ordinary-user access using the [administrator guide](ADMIN-GUIDE.md).
   LangChain applications open from `/apps`, not the Dify model selector.

For tests, prepare the separate `.env.test` and dependencies described in
[test environments](TEST-ENV.md). Do not run data-writing integration tests
against the development database just because it already contains useful records.

## 3. Start, Edit And Debug

```bash
pnpm build:shared
pnpm dev:all
```

Open `http://127.0.0.1:3000` for the example above. `dev:all` starts Web and API;
`pnpm dev:web` or `pnpm dev:api` starts only that part. Web-only mode cannot
serve business routes owned by Fastify. Do not disable the proxy and expect
disabled compatibility handlers to recreate the API.

The default Web dev command uses Webpack. `pnpm dev:turbo` is an explicit
alternative, not the default acceptance runtime. `pnpm dev` also enables the
Node inspector; do not expose a debugger on a public network.

The API's current dev script runs `ts-node` without a file watcher. Restart the
API after changing its server code; a Web hot reload alone does not reload that
process. Rebuild the shared package after shared-source changes so workspace
imports see the new `dist` output. Restart the affected process if needed.

### Environment And Build Outputs

| Command or directory                        | Behavior                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `scripts/with-env-local.sh`                 | Sources the selected trusted shell env file, defaulting to `.env.dev`; `AGENTIF_ENV_FILE` selects another profile |
| `pnpm dev:web` / `.next-dev`                | Prepares runtime content and writes Web development output separately from production `.next`                     |
| `pnpm build:check` / `.next-build`          | Performs a production Web build check with separate Web output; does not by itself build shared/API packages      |
| `pnpm build:check:all`                      | Builds shared/API and then the separated Web build check; shared/API `dist` is still shared within the checkout   |
| `pnpm build:all` / `.next`                  | Builds shared, API and production Web; use an independent checkout if active services use these outputs           |
| `output/runtime/`, `output/build-messages/` | Ignored development/runtime-content fixture and prepared translation build input, not files to commit             |

Some package commands explicitly select `.env.dev` or `.env.prod`; do not assume
an outer `AGENTIF_ENV_FILE` overrides an assignment inside a script. Inspect
`package.json` when composing commands. The env wrapper sources shell syntax, so
only load trusted local files; Compose dotenv parsing has different rules.

An external `AGENTIF_RUNTIME_DIR` must exist and be initialized intentionally.
Without one, supported development/build commands prepare an ignored local
fixture from public defaults. Existing runtime edits can override default copy:
use a fresh isolated fixture when checking changed shipped translations/pages.
Do not delete a live runtime directory to test a default. Avoid invoking `next`
directly and bypassing content preparation.

Separate Web output directories do not isolate API/shared `dist`, dependencies,
type caches or runtime data. Do not run competing builds in a checkout serving
another process; use a separate source directory when needed.

## 4. Make Changes At The Right Boundary

### UI, State And Localization

- Reuse existing navigation, message renderers, input and history components.
  Backend-specific capabilities belong in the capability/adapter contract, not
  duplicated sidebars or a second independent history system.
- Keep database clients, service credentials and upstream calls on the server.
  Client code calls authenticated product APIs, not a backend URL with a key.
- Preserve stable message/run identities and ordered history reconciliation;
  concatenating streamed text or treating one page as the complete history can
  duplicate or discard messages.
- Use `next-intl` keys, add public English defaults and maintain matching locale
  structure. Run `pnpm i18n:check` for changes; Home/About runtime translation is
  different from compiled interface translation.
- Check narrow/mobile layouts, keyboard behavior, labels, focus, loading/error
  states and the affected ordinary-user path, not just administrator access.

### Chat Interaction Principles

These are design and review rules, not a claim that every existing application
already implements the same interface. Reuse product components and preserve
backend semantics; do not promise capabilities an Agent does not provide.

1. **One chat surface.** Reuse the message list, composer, attachment controls
   and execution-process views. Backend adapters supply capabilities and data,
   not a separate visual system or an inner sidebar. Backend-specific parameters
   can remain in a controlled area; do not make a separate large form card the
   primary interaction instead of the shared chat surface.
2. **Identify the application before input.** Show its configured display name
   on one line and description below it, directly above the composer. Use
   body-sized, moderately bold text for the name and a muted description;
   omit empty values. Hide this introduction after the first request is
   accepted and restore it for a new task. It is not a saved message or model
   input. Introduction visibility does not determine parameter visibility:
   freeze session-initialization parameters after acceptance, but keep required
   per-run parameters available for each independent task. Keep errors and retry
   actions available as needed.
3. **Keep the composer quiet.** Avoid generic placeholder instructions when the
   introduction already explains the task. Keep an accessible input name,
   consistent send/stop controls and keyboard/composition behavior. Dedicated
   application chat surfaces have no generic visible placeholder; the model
   homepage retains its existing greeting and composer defaults.
4. **Let capabilities govern attachments.** Keep the attachment action inside
   the composer, enabled only when adding a supported file is possible. Use a
   disabled action when unsupported or full; distinguish loading or failure
   from lack of support. Explain required/optional counts, remaining capacity,
   file restrictions and upload failures in readable language, for example
   "Up to 3 files; 1 added", without repeated counters or warning panels for a
   normal supported state. Offer a purpose selector only when several upload
   slots need disambiguation; do not merge their limits into one generic slot.
   Preserve each input slot's limits and server-side validation.
5. **Keep state transitions continuous.** Make sending, waiting, streaming,
   completion and failure understandable without a page refresh or a broken
   message stream when saving or replacing a temporary conversation URL.
   Distinguish execution, connection and persistence status; unknown is not
   success and must not trigger an automatic duplicate run.
6. **Separate process from output.** Reuse the process interaction for workflow
   steps and tool activity, scoped to the correct run. Do not clear completed
   records. Restore available snapshots in history, and explain missing legacy
   records rather than inventing them. Keep results and human approval controls
   distinct from process details.
7. **Restore history without inventing continuity.** Reloading or signing in
   again should recover authorized messages, stored process records and
   attachments. Single-turn versus multi-turn behavior follows the application's
   declared type/configuration and supported semantics, not its visual layout.
   Single-turn applications offer a new-task action; multi-turn applications
   continue the bound conversation. A local task history may group independent
   Workflow runs without giving them upstream conversational memory. Treating
   Chatflow as single-turn is a current product convention, not a universal
   property of Dify Chatflow or evidence that the backend enforces one turn.
8. **Use a consistent result-reading interaction.** Ordinary replies stay inline;
   long documents, files and structured artifacts can open from a result card
   in the shared preview shell. The target is a right-side desktop panel and a
   full-screen mobile panel, with consistent close/copy/download actions only
   where supported. Do not automatically open every completed result or require
   a panel to read an ordinary reply. A file opened from a result returns to
   that result when closed; closing the result returns to the originating
   conversation and focus without rerunning, refreshing or clearing results.
   Preserve authenticated reads, backend-specific parsing and explicit
   unavailable-result errors.

Workflow result viewing reuses `components/file-preview/preview-shell.tsx`, as do
file and Agent artifact previews. Workflow retains its own result parsing,
reasoning disclosure, input-attachment references, copy and download behavior.
The shell supplies responsive layout, dismissal and focus restoration; it does
not replace authenticated data loading or create a universal result-storage
system. Other legacy viewers are not implicitly migrated by sharing this shell.

### API, Authentication And Persistence

- Next owns auth and selected server-rendering endpoints. Fastify owns business
  APIs. Update both rewrite/registration contracts and their tests when changing
  a route; preserve deliberate closed compatibility stubs.
- Resolve the session/actor and application access server-side. A browser-supplied
  user, conversation, run or backend ID is not authorization to access that resource.
- Use the existing repositories and request-scoped PostgreSQL context. Preserve
  RLS with the actual runtime role; a test passing under a superuser does not
  establish user isolation.
- Add a new ordered SQL migration for schema changes rather than editing an
  already-applied historical migration. Include grants, constraints and affected
  types/repositories, and check both fresh and incremental paths as applicable.
- Use the existing error envelope/request identifiers. Keep secrets, raw upstream
  errors, tokens and user content out of ordinary logs and public issue evidence.

### Backends, Streaming And AG-UI

Start with [Dify](DIFY-INTEGRATION.md), [LangChain](LANGCHAIN-INTEGRATION.md),
[AG-UI](AGUI-INTEGRATION.md) and [generation governance](AGENT-GOVERNANCE.md).

Shared responsibilities are application/actor resolution, admission and root
submission identity, local conversation/run ownership, public event projection,
history and persistence. Backend adapters own native endpoints, request/event
translation, native identifiers and supported capabilities. Keep those native
differences explicit instead of forcing a feature that one service does not have.

When adding an operation or backend, trace the whole path:

1. Provider/instance configuration and validation, encrypted credentials and
   application access/capability description.
2. Client request and shared chat/history behavior, including reload and errors.
3. Authenticated route, submission/admission checks and trusted native binding.
4. Backend transport and allowlisted public event conversion, without leaking
   tool arguments/results or upstream metadata.
5. Server/browser persistence ownership for that specific path, idempotency,
   saved-result lookup, timeout/disconnect/unknown-outcome behavior and tests.

The negotiated Dify chatbot path is explicitly text-only and server-managed;
legacy Dify paths retain their compatible behavior. LangChain human input is a
separate opt-in, single-task approve/reject profile. AG-UI schema validity alone
does not authorize a tool or implement arbitrary input forms, cancellation or
crash recovery. Never blindly retry a generation/resume POST after an unknown
outcome or regenerate merely to repair saving.

## 5. Validate According To The Change

During editing, start with focused tests. For example, after preparing the test
profile and building shared:

```bash
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm test --runInBand lib/services/client/agui-stream.test.ts
```

Before a code candidate is ready, run the relevant full checks against isolated
dependencies. From a checkout whose build outputs are not serving live traffic:

```bash
pnpm build:shared
pnpm gate:quality:verify
pnpm --filter @agentifui/shared type-check
pnpm --filter @agentifui/api type-check
pnpm format:check
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm test --runInBand
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm build:all
```

`gate:quality:verify` includes root TypeScript/ESLint and route, client/database,
RLS and error-envelope guards; it is not a replacement for tests, workspace
checks or production builds. Publication-related tests also need the pinned
Gitleaks scanner described in [publication protection](PUBLICATION.md).

| Change                       | Add or emphasize                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation only           | Source/command accuracy, changed Markdown formatting, relative links/anchors and public-content review; no application rebuild or environment rehearsal solely for prose |
| UI                           | Component regressions and affected production-mode desktop/mobile interaction                                                                                            |
| API/auth/authorization       | Route contracts, ordinary-user and disallowed-user behavior, real affected auth/session boundary                                                                         |
| Schema or data logic         | Isolated database, migrated schema/runtime grants, RLS and affected upgrade compatibility                                                                                |
| Agent/AG-UI                  | Synthetic backend and stream fixtures, event/history ordering, ownership, idempotency, persistence failures and affected legacy compatibility                            |
| Translation/content defaults | `pnpm i18n:check`, relevant content checks and fresh isolated runtime fixture                                                                                            |
| Image/startup/deployment     | Real isolated Docker build/startup and affected business smoke; scaling/draining/recovery only as affected                                                               |

CI runs in GitHub Actions, not against a contributor's existing services. The
current workflow includes publication checks even for docs, change-filtered
quality/tests and Docker Build and Smoke when triggered, with **CI Status Check**
as the aggregate result. Docker can provide the application build in place of a
duplicate host build in that CI run. A green CI result does not establish real
model, inbox, authorized SSO or production deployment acceptance.

Maintainers validate ordinary features in a separate production-build Stage
release under PM2, with automated smoke and affected manual acceptance. Local
Docker deployment validation is additional when image/startup/deployment changes
require it, not a mandatory full-stack rebuild for every feature edit. Changes
are fixed source candidates, not uncommitted production patches. Contributors
without shared Stage access should state what they tested and let maintainers
complete that environment's acceptance; never invent a passed result.

## 6. Diagnose Common Development Problems

| Problem                                         | Check                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Shared module or exported type not found        | Frozen workspace install, then `pnpm build:shared`; API/shared imports use built package output                             |
| Business API returns 503 or connection refused  | API is running, expected listener/rewrite target and route ownership; disabled Next stubs are not a fallback implementation |
| API edit appears ineffective                    | Restart the API's non-watching dev process and rebuild changed shared code                                                  |
| Login fails or cookies disappear                | Better Auth enabled, matching browser/auth origin and scheme, expected cookie scope, migrated schema and identity profile   |
| No models available                             | Model versus `/apps` entry point, provider/instance backend/category, enabled state and ordinary-user permissions           |
| Default text change does not appear             | Runtime overrides, prepared translation input and whether the Web build/dev process has reloaded the intended fixture       |
| Relation/permission error                       | Missing SQL, runtime grants/RLS context and isolated database selection, not an invitation to use the owner role            |
| Reply visible but history differs after refresh | Persistence owner, run/save state and trusted history IDs; do not create another model run to repair storage                |
| Storage signing/upload fails                    | Reachable browser endpoint, signed host/query/headers, bucket CORS and actual file limits                                   |

For further diagnosis, see [operations](OPERATIONS.md). Capture sanitized request
IDs and reproduction steps. Do not publish a complete `.env` file, reset link,
session cookie, database dump or real conversation to make a report reproducible.

## 7. Hand Off The Change

Review the diff and follow [Contributing](https://github.com/iflabx/agentifui/blob/main/CONTRIBUTING.md) for branch/PR,
checks, hooks and publication review. Include new migration/configuration and
capability limits in the appropriate docs in the same change. Public examples
must work without private scripts, operational notes or a maintainer's credentials.

Merging source into `main`, tagging a release and deploying an installation are
separate actions. A documentation or feature PR does not automatically authorize
any release or live deployment.
