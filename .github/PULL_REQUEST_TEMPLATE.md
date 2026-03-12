> [!IMPORTANT]
>
> - Target `develop` unless a maintainer explicitly asked for a `main` hotfix/release PR.
> - Read [CONTRIBUTING.md](../CONTRIBUTING.md).
> - Link the issue correctly, for example: `Fixes #123`.

## Summary

Briefly describe what changed.

## Why

Explain the problem, risk, or user need this PR addresses.

Fixes #

## Validation

- [ ] `pnpm format:check`
- [ ] `pnpm gate:quality:verify`
- [ ] `pnpm test`
- [ ] `pnpm build:all`
- [ ] `pnpm i18n:check` (if translations changed)
- [ ] Manual or targeted tests are described below when full test coverage was not run

### Test Notes

Describe manual checks, targeted tests, screenshots, or why some checks were skipped.

## Docs and Ops Impact

- [ ] No public doc changes required
- [ ] Updated `README.md` and/or `docs/*` for public behavior changes
- [ ] Added or updated `.env*.example` entries for new runtime configuration
- [ ] Database / migration impact explained below
- [ ] Deployment / CI impact explained below

## Checklist

- [ ] Commit messages follow the repository's Conventional Commit style
- [ ] The PR is scoped to one logical change set
- [ ] New routes, rewrites, or cutovers do not leave stale public docs behind
- [ ] UI changes include screenshots when relevant
