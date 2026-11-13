# Contributing Guide

## Base Branch

- Use `develop` for normal feature, fix, and documentation work.
- Only target `main` when a maintainer explicitly asks for a release or hotfix PR.

## Quick Setup

### Prerequisites

- Node.js `24.22.2` (see `.nvmrc` and `package.json` engines)
- pnpm `10.34.9` (see `packageManager` in `package.json`)
- Git
- PostgreSQL, Redis, and MinIO if you want to run the full stack locally

### Clone and Install

```bash
git clone https://github.com/iflabx/agentifui.git
cd agentifui

npm install --global --ignore-scripts pnpm@10.34.9
pnpm install --frozen-lockfile
```

### Configure Local Runtime

```bash
cp .env.example .env.dev
# edit .env.dev for your local PostgreSQL / Redis / MinIO / auth settings
```

### Create a Working Branch

```bash
git switch develop
git pull
git switch -c feat/your-change
```

## Daily Commands

```bash
pnpm dev:all          # Next.js + Fastify together
pnpm dev:web          # Next.js only
pnpm dev:api          # Fastify only
pnpm type-check
pnpm lint
pnpm test
pnpm build:all
pnpm gate:quality:verify
```

If you change translations, also run:

```bash
pnpm i18n:check
```

## Before Opening a PR

Run the relevant checks locally:

```bash
pnpm format:check
pnpm gate:quality:verify
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm test
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm build:all
```

Notes:

- Prepare the isolated profile and services described in [the test environment guide](docs/TEST-ENV.md) before these test/build commands. Integration tests write data; do not use development or production connections.
- `pnpm build` only covers the Next.js app. Use `pnpm build:all` before a PR so shared and Fastify packages are checked too.
- If you only run targeted tests, explain that in the PR description.
- If you change runtime behavior, public routes, configuration, or deployment flow, update `README.md` and the relevant files under `docs/` in the same PR.

## Development Guidelines

### Runtime and Data Boundaries

- Follow [the architecture guide](docs/architecture.md) for Next.js, Fastify, service, and data-access responsibilities. Keep database access and upstream credentials on the server.
- Follow [the database design](docs/DATABASE-DESIGN.md) and [deployment guide](docs/QUICK-DEPLOYMENT.md) for SQL migrations under `database/migrations/`. Include affected types and access code in the same change, and preserve RLS-aware user context.
- Follow [the Dify integration guide](docs/DIFY-INTEGRATION.md) when adding upstream operations or changing streaming behavior.
- Check for existing development services before starting or restarting them. Validate from a separate source directory when a running service uses the build output; loading a test environment alone does not isolate build artifacts.

### Code and Tests

- Follow existing TypeScript types and ESLint rules; keep comments concise, in English, and focused on reasons or non-obvious behavior. Use JSDoc when a public contract needs explanation rather than adding boilerplate to every function.
- Put Jest tests alongside the source or under `__tests__/`, and reuse the relevant setup and mocking patterns. Use React Testing Library for component behavior.
- Cover changed behavior and important regressions. Prefer focused tests during development and run broader checks when shared code or the affected scope requires them.
- For UI changes, check the affected desktop/mobile layout, keyboard interaction, labels, focus, and error states.

### Internationalization

- Use `next-intl` translation keys for application UI text; preserve existing translation calls instead of replacing them with hardcoded text.
- Add new keys to `messages/en-US.json` and maintain matching key structure in the other supported locale files.
- Run `pnpm i18n:check` when translations change. Keep translation work within the affected feature.

## Pull Request Expectations

1. Keep each PR focused on one change set.
2. Link the issue or explain why the PR is needed.
3. Call out database, environment-variable, deployment, or CI impact.
4. Include screenshots for visible UI changes.
5. Prefer follow-up PRs over mixing refactors and behavior changes into one large submission.

## Commit Style

Use Conventional Commits where practical:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

## Standards

- Use `pnpm`, not `npm` or `yarn`.
- Keep TypeScript and ESLint warnings under control; do not bypass quality gates without a clear reason.
- Update `.env*.example` when adding or renaming public runtime configuration.
- Do not leave dead route paths or outdated docs behind after a cutover.

## Support

- Start with `README.md` and `docs/`.
- Use GitHub Issues for bugs and feature requests.
- External contributors must complete the CLA flow if the repository requests it.
