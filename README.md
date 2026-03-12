# AgentifUI

> Community Edition: Apache 2.0
> Commercial licensing and support: contact [license@iflabx.com](mailto:license@iflabx.com)

AgentifUI is a monorepo for an enterprise-oriented AI application frontend built on Next.js 15, React 19, Fastify, PostgreSQL, Redis, MinIO, better-auth, and Dify. The current codebase uses a split runtime:

- `app/` serves the Next.js UI, auth handlers, and compatibility API stubs.
- `apps/api/` runs the Fastify sidecar for business APIs and proxy-heavy routes.
- PostgreSQL, Redis, and MinIO provide durable data, cache/realtime plumbing, and object storage.

## Key Capabilities

- Multi-app UI for chat, agent, chatbot, chatflow, workflow, and text generation flows
- better-auth based login, SSO, local-password fallback controls, and phone-OTP support
- Fastify sidecar for selected `/api/*` prefixes, with cutover and smoke-check scripts
- PostgreSQL-backed persistence with runtime actor context and RLS-aware access patterns
- Redis-backed cache invalidation, realtime broker helpers, and shared prefixes for isolation
- MinIO/S3 avatar and content-image upload flows
- Error-event capture pipeline for frontend and API failures
- Production deployment via PM2, `pnpm deploy`, and smoke verification

## Tech Stack

| Layer          | Current Stack                                      |
| -------------- | -------------------------------------------------- |
| Web app        | Next.js 15 App Router, React 19, TypeScript        |
| API sidecar    | Fastify 5 in `apps/api`                            |
| Shared package | `packages/shared` for cross-runtime helpers        |
| Data           | PostgreSQL, Redis, MinIO / S3-compatible storage   |
| Auth           | better-auth with SSO and local-password extensions |
| Styling        | Tailwind CSS 4, Radix UI, next/font                |
| Tooling        | pnpm 10, Jest, ESLint, Prettier, Husky, PM2        |

## Runtime Architecture

```text
Browser
  -> Next.js App Router (UI, SSR, auth routes, compatibility stubs)
  -> selected /api/* rewrites -> Fastify sidecar
  -> PostgreSQL / Redis / MinIO / Dify
```

Notes:

- Fastify proxy prefixes are configured in `next.config.ts` and `apps/api/src/config.ts`.
- Auth routes such as `/api/auth/better/*` remain in Next.js.
- Some legacy Next API files intentionally remain as disabled stubs so `fastify:cutover:off` can fail closed with explicit `503` responses.

## Quick Start

### Prerequisites

- Node.js 22+
- Corepack or pnpm `10.14.0`
- PostgreSQL
- Redis
- MinIO or another S3-compatible object store

### Local Development

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile

cp .env.example .env.dev
# edit .env.dev

pnpm dev:all
```

Then open `http://localhost:3000`.

Useful variants:

- `pnpm dev:web` - start the Next.js app only
- `pnpm dev:api` - start the Fastify sidecar only

### Production Deployment

Use the public runbooks:

- `docs/CONFIGURATION.md`
- `docs/QUICK-DEPLOYMENT.md`
- `docs/TEST-ENV.md`

## Common Commands

```bash
pnpm dev:all
pnpm type-check
pnpm lint
pnpm test
pnpm build:all
pnpm gate:quality:verify
pnpm smoke:prod
```

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

- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/DATABASE-DESIGN.md`
- `docs/FONTS.md`

## Contributing and Support

- Open issues and pull requests on GitHub.
- Read `CONTRIBUTING.md` before sending a PR.
- Report security issues to [security@iflabx.com](mailto:security@iflabx.com).
- See `.github/TRADEMARK_POLICY.md` for trademark usage.
