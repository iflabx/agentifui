# Contributing Guide

## Quick Setup

**Prerequisites**: Node.js 18.17+, pnpm 8.0+, Git

```bash
# 1. Fork & Clone
git clone https://github.com/ifLabX/AgentifUI.git
cd AgentifUI
pnpm install

# 2. Setup
cp .env.example .env.dev
# Edit .env.dev

# 3. Create Branch
git checkout -b feat/your-feature  # or fix/issue-name
```

## Development Commands

```bash
pnpm dev          # Start dev server
pnpm type-check   # TypeScript check
pnpm format:check # Format check
pnpm lint         # Lint check
pnpm build        # Build test
pnpm i18n:check   # Translation check
```

## Before PR

Required checks:

```bash
pnpm type-check && pnpm format:check && pnpm lint && pnpm build
```

## Process

1. **Fork** → **Branch** → **Code** → **Test** → **PR**
2. **Commit format**: `type(scope): description`
3. **CLA**: Sign at https://cla.iflabx.com (required for external contributors)

## Issue Guidelines

**Bug reports**: Include environment, steps, expected vs actual
**Feature requests**: Include problem, solution, use cases

## Standards

- **Code**: TypeScript/React with Prettier
- **Commit types**: feat, fix, docs, style, refactor, perf, test
- **Dependencies**: Apache 2.0/MIT/BSD only, discuss in issues first

## Support

- **Issues**: Bug reports & features
- **Discussions**: Questions & community
- **Docs**: Check [./docs/](./docs/) first

**CLA**: By submitting code, you agree it may become part of future releases under the CLA terms.
