# Contributing Guide

## Base Branch

- Use `develop` for normal feature, fix, and documentation work.
- Only target `main` when a maintainer explicitly asks for a release or hotfix PR.

## Quick Setup

### Prerequisites

- Node.js 22+
- Corepack or pnpm `10.14.0`
- Git
- PostgreSQL, Redis, and MinIO if you want to run the full stack locally

### Clone and Install

```bash
git clone https://github.com/iflabx/agentifui.git
cd agentifui

corepack enable
corepack prepare pnpm@10.14.0 --activate
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
pnpm test
pnpm build:all
```

Notes:

- `pnpm build` only covers the Next.js app. Use `pnpm build:all` before a PR so shared and Fastify packages are checked too.
- If you only run targeted tests, explain that in the PR description.
- If you change runtime behavior, public routes, configuration, or deployment flow, update `README.md` and the relevant files under `docs/` in the same PR.

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
