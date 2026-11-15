# Contributing Guide

This guide covers submitting changes to AgentifUI. For detailed local setup,
repository navigation, debugging and backend/AG-UI extension boundaries, read
the [developer guide](docs/DEVELOPMENT.md). For the whole documentation set, use
the [documentation index](docs/README.md).

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

Copying the template alone is not enough: choose the actual local origin,
explicitly enable Better Auth for the current runtime, generate development-only
keys and initialize isolated dependencies. Follow the
[development setup](docs/DEVELOPMENT.md#2-prepare-a-local-development-instance)
before starting services. Build the shared package after installation or shared
source changes:

```bash
pnpm build:shared
```

### Create a Working Branch

With repository write access and an existing local `develop` branch:

```bash
git switch develop
git pull --ff-only
git switch -c feat/your-change
```

Without write access, fork the repository on GitHub and clone your fork instead
of the upstream clone above. In that fresh clone, create your branch from the
upstream development line:

```bash
git remote add upstream https://github.com/iflabx/agentifui.git
git fetch upstream
git switch -c feat/your-change upstream/develop
```

Push the feature branch to your fork (`origin`) and open a PR to upstream
`develop`. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md); a direct push
to the upstream repository is not required for contributing. Resolve conflicts
on your own branch, not by changing the PR target to `main`.

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
- Build shared first and include `pnpm --filter @agentifui/shared type-check` and
  `pnpm --filter @agentifui/api type-check` when workspace contracts are affected;
  the root quality gate alone does not type-check every workspace.
- If you only run targeted tests, explain that in the PR description.
- If you change runtime behavior, public routes, configuration, or deployment flow, update `README.md` and the relevant files under `docs/` in the same PR.
- For prose-only changes, check changed Markdown formatting, links, examples and
  publication content. Do not rebuild or rehearse a deployment solely for prose;
  preserve whatever checks the repository hooks and CI actually require.

## Hooks And Safe Publication

Dependency installation activates Husky outside CI/production installs. Current
hooks perform these checks:

- **Pre-commit:** root type check, staged formatting/lint, locale consistency and
  staged test-file runs. Formatting can modify staged files; inspect the result.
- **Commit message:** Conventional Commit validation through commitlint.
- **Pre-push:** the shared publication checker validates outgoing Git objects
  and invokes Gitleaks **8.24.3**, which must already be installed on `PATH`.

See [publication protection](docs/PUBLICATION.md) for installation and full-range
scanning. Hooks complement, not replace, the PR's tests or manual review. Do not
disable hooks or add scanner exceptions merely to make a new finding pass.

Before committing, inspect `git status --short`, `git diff` and
`git diff --cached`. Stage only intended files; avoid blindly adding an entire
working tree containing unrelated edits. Keep real environment files, API/OAuth
and SMTP keys, model-configuration exports, uploads, backups and operational
notes out of commits. Use placeholder examples and synthetic test data.

`.gitignore` does not remove already tracked secrets. The publication checker
scans committed objects, not uncommitted drafts, and deleting a leaked value in
a later commit does not erase it from outgoing history. If a secret is exposed,
revoke/rotate it and coordinate cleanup before pushing. Do not put it in a
public bug report to ask whether it is sensitive.

## Development Guidelines

### Runtime and Data Boundaries

- Follow [the architecture guide](docs/architecture.md) for Next.js, Fastify, service, and data-access responsibilities. Keep database access and upstream credentials on the server.
- Follow [the database design](docs/DATABASE-DESIGN.md) and [deployment guide](docs/QUICK-DEPLOYMENT.md) for SQL migrations under `database/migrations/`. Include affected types and access code in the same change, and preserve RLS-aware user context.
- Follow [the Dify integration guide](docs/DIFY-INTEGRATION.md) when adding upstream operations or changing streaming behavior.
- For LangChain and shared interaction work, follow [LangChain integration](docs/LANGCHAIN-INTEGRATION.md),
  [AG-UI integration](docs/AGUI-INTEGRATION.md) and [generation governance](docs/AGENT-GOVERNANCE.md).
  Preserve supported legacy paths and declare unsupported capabilities explicitly.
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

### Documentation Maintenance

- Update the guide for the affected reader: [first use](docs/GETTING-STARTED.md),
  user, administrator, operator or developer. Keep detailed commands/contracts in
  their existing reference rather than copying another full procedure.
- Update [compatibility](docs/COMPATIBILITY.md) when a backend/profile gains or
  loses a capability. Distinguish upstream support, implemented product behavior
  and optional configuration; do not describe a prototype or roadmap as shipped.
- For configuration changes, update the relevant safe `.env*.example`,
  [configuration reference](docs/CONFIGURATION.md) and deployment mapping notes.
  Check code defaults, template values and fixed Compose values separately.
- For new external data transfers, credential handling or retention/deletion
  behavior, update [security and data handling](docs/SECURITY-PRIVACY.md). Report
  vulnerabilities through [SECURITY.md](SECURITY.md), not a public docs issue.
- State prerequisites, entry point, expected result and important limitations.
  Use fictional domains and synthetic examples. Screenshots, if included, must
  match the current UI and be free of accounts, conversations, keys and private
  URLs; do not fabricate a screenshot or acceptance result to complete a guide.
- Check formatting of changed Markdown with the existing Prettier tool and
  inspect relative file links/heading anchors, especially after moving headings.
  Publication CI does not itself establish correct links or current behavior.
- Use documentation from the applicable tag for release-specific behavior; link
  to GitHub Releases instead of maintaining a second complete change log. Explain
  upgrade/configuration impact in the PR when relevant.

Documentation is maintained as repository Markdown. No separate documentation
site, private infrastructure access, installation rehearsal or application build
is required merely to contribute prose. Existing Git hooks and required checks
still apply; record any check not performed rather than claiming it passed.

## Pull Request Expectations

1. Keep each PR focused on one change set.
2. Link the issue or explain why the PR is needed.
3. Call out database, environment-variable, deployment, or CI impact.
4. Include screenshots for visible UI changes.
5. Prefer follow-up PRs over mixing refactors and behavior changes into one large submission.

### What Happens After Submission

GitHub Actions runs for PRs targeting `develop` or `main`; a push to an arbitrary
feature branch alone is not a promise of a CI run. Monitor **CI Status Check**
and the jobs it aggregates. Documentation-only changes still receive publication
checks; runtime changes trigger the relevant quality, test and build jobs.
Keep failed checks and unavailable validations visible in the PR rather than
marking them as passed.

Maintainers integrate feature/fix/documentation work into `develop`, freeze a
candidate and complete affected Stage acceptance before a release PR to `main`.
Ordinary feature acceptance uses a separate PM2 production build; Docker-specific
changes additionally need relevant isolated Docker checks. A contributor does
not need credentials for the maintainers' environments or access to their
internal operational notes. If a bug needs an environment-specific trial fix,
the final patch still returns through the development branch and a new validated
candidate; do not leave the only fix in a running deployment.

A merge to `main` does not automatically create a version or deploy production.
Maintainers handle tags, release notes and version handoff separately. Production
operators deploy a confirmed version using the public deployment runbook.

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
- Read the [Code of Conduct](.github/CODE_OF_CONDUCT.md),
  [license](LICENSE) and [contributor agreement](.github/CLA.md) before contributing.
  Follow the maintainers' requested CLA process; do not add unrelated personal
  details or signatures to a source-code change.
