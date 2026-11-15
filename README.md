# AgentifUI

> Community Edition: Apache 2.0
> Commercial licensing and support: contact [license@iflabx.com](mailto:license@iflabx.com)

AgentifUI is an enterprise-oriented Agent UI for existing Dify applications and compatible LangChain Agent services, with a shared AG-UI interaction foundation for supported paths. It does not build or host the Agents themselves. The monorepo uses Next.js 16, React 19, Fastify, PostgreSQL, Redis, MinIO/S3 and better-auth, with a split runtime:

- `app/` serves the Next.js UI, auth handlers, and compatibility API stubs.
- `apps/api/` runs the Fastify sidecar for business APIs and proxy-heavy routes.
- PostgreSQL, Redis, and MinIO provide durable data, cache/realtime plumbing, and object storage.

## Key Capabilities

- Multi-app UI for chat, agent, chatbot, chatflow, workflow, and text generation flows
- Dify and compatible LangChain backends, with shared chat/history and explicitly bounded AG-UI support
- Optional native LangChain human confirmation with approve/reject; not general Dify human-input support
- better-auth based login, SSO, local-password fallback controls, and phone-OTP support
- Fastify sidecar for selected `/api/*` prefixes, with cutover and smoke-check scripts
- PostgreSQL-backed persistence with runtime actor context and RLS-aware access patterns
- Redis-backed cache invalidation, realtime broker helpers, and shared prefixes for isolation
- MinIO/S3 avatar and content-image upload flows
- Error-event capture pipeline for frontend and API failures
- Self-hosted Docker Compose or host/PM2 deployment, upgrade/recovery runbooks and optional manual Docker scaling

Start with the [documentation index](docs/README.md) for installation, operation,
administration and end-user guides. Use docs from the tag/commit you install;
`main` can describe functionality newer than the latest released version.
For working on the source, read the [developer guide](docs/DEVELOPMENT.md) and
[contribution workflow](CONTRIBUTING.md).

## Tech Stack

| Layer          | Current Stack                                      |
| -------------- | -------------------------------------------------- |
| Web app        | Next.js 16 App Router, React 19, TypeScript        |
| API sidecar    | Fastify 5 in `apps/api`                            |
| Shared package | `packages/shared` for cross-runtime helpers        |
| Data           | PostgreSQL, Redis, MinIO / S3-compatible storage   |
| Auth           | better-auth with SSO and local-password extensions |
| Styling        | Tailwind CSS 4, Radix UI, next/font/local          |
| Tooling        | pnpm 10, Jest, ESLint, Prettier, Husky, PM2        |

## Runtime Architecture

```text
Browser
  -> Next.js App Router (UI, SSR, auth routes, compatibility stubs)
  -> selected /api/* rewrites -> Fastify sidecar
  -> PostgreSQL / Redis / MinIO / Dify or compatible LangChain service
```

Notes:

- Fastify proxy prefixes are configured in `next.config.ts` and `apps/api/src/config.ts`.
- Auth routes such as `/api/auth/better/*` remain in Next.js.
- Some legacy Next API files intentionally remain as disabled stubs so `fastify:cutover:off` can fail closed with explicit `503` responses.

## Quick Start

### Prerequisites

- Node.js `24.22.2` (see `.nvmrc`)
- pnpm `10.34.9`
- PostgreSQL
- Redis
- MinIO or another S3-compatible object store

### Local Development

```bash
npm install --global --ignore-scripts pnpm@10.34.9
pnpm install --frozen-lockfile

cp .env.example .env.dev
# edit .env.dev

pnpm build:shared
pnpm dev:all
```

Then open `http://localhost:3000`.

The supported toolchain is Node.js 24 and the pnpm version pinned in
`packageManager`; CI and the test image use the same versions. Exact dependency
versions are pinned in `package.json` and `pnpm-lock.yaml`. Next.js uses
Webpack by default in this project; `dev:turbo` remains an opt-in alternative.
TypeScript 6 and ESLint 9 are compatibility pins while upstream plugins catch
up. ESLint 9 is an unsupported transitional version, not a long-term target.
React Compiler is not enabled. Its newly introduced migration diagnostics are
reported as warnings; existing Hooks correctness rules remain enabled.

Useful variants:

- `pnpm dev:web` - start the Next.js app only
- `pnpm dev:api` - start the Fastify sidecar only

### Production Deployment

Choose one installation path, then complete administrator/application setup:

- [Docker Compose installation](docs/DOCKER.md) (build locally; no registry account needed)
- [Host/PM2 installation](docs/QUICK-DEPLOYMENT.md)
- [Runtime configuration](docs/CONFIGURATION.md)
- [Administrator and first-application setup](docs/ADMIN-GUIDE.md)
- [Operations, upgrades and recovery](docs/OPERATIONS.md)
- [Optional manual Docker capacity](docs/DOCKER-CAPACITY.md)

## Common Commands

```bash
pnpm build:shared
pnpm dev:all
pnpm type-check
pnpm lint
pnpm test
pnpm build:all
pnpm gate:quality:verify
pnpm smoke:prod
```

Build the shared package after installation or shared-source changes, before
development, type checks, or tests that import it through the workspace package.
The shared AG-UI chat, negotiated product API and compatibility boundaries are
documented in [AG-UI Integration](docs/AGUI-INTEGRATION.md). LangChain uses the
shared chat; Dify chatbot applications can opt into its text-only mode. Other
Dify modes and existing conversations retain their compatible paths.

## Repository Layout

| Path                   | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `app/`                 | Next.js App Router pages, layouts, and route handlers                |
| `apps/api/`            | Fastify API sidecar                                                  |
| `components/`          | Shared and domain UI components                                      |
| `lib/`                 | Server helpers, DB access, services, hooks, stores, auth             |
| `packages/shared/`     | Shared runtime utilities                                             |
| `database/migrations/` | SQL schema and RLS migrations                                        |
| `scripts/`             | Public runtime, deployment, guard, and maintenance scripts           |
| `docs/`                | User-facing configuration, deployment, architecture, and schema docs |

## Additional Docs

- [All documentation by role and task](docs/README.md)
- [From installation to your first conversation](docs/GETTING-STARTED.md)
- [Compatibility and capability matrix](docs/COMPATIBILITY.md) and [deployment security/data handling](docs/SECURITY-PRIVACY.md)
- [End-user guide](docs/USER-GUIDE.md) and [administrator guide](docs/ADMIN-GUIDE.md)
- [Dify integration](docs/DIFY-INTEGRATION.md), [LangChain integration](docs/LANGCHAIN-INTEGRATION.md) and [AG-UI integration](docs/AGUI-INTEGRATION.md)
- [Architecture](docs/architecture.md) and [database design](docs/DATABASE-DESIGN.md)
- [Contributing](CONTRIBUTING.md), [test environments](docs/TEST-ENV.md) and [publishing safely](docs/PUBLICATION.md)

## Contributing and Support

- Open issues and pull requests at [`iflabx/agentifui`](https://github.com/iflabx/agentifui).
- Read `CONTRIBUTING.md` before sending a PR.
- Report vulnerabilities privately using [the security policy](SECURITY.md),
  which lists [security@iflabx.com](mailto:security@iflabx.com) as the contact.
- See `.github/TRADEMARK_POLICY.md` for trademark usage.
