# Test Environment Guide

## Scope

This guide describes the minimum isolated test setup for AgentifUI when development and production already use existing PostgreSQL, Redis, and MinIO services.

The goal is data isolation, not full infrastructure isolation.

## Files and Profiles

Use:

- `.env.test` for isolated test runs
- `.env.dev` for development
- `.env.prod` for production

Start from the public template:

```bash
cp .env.test.example .env.test
```

You can load it with the shared wrapper:

```bash
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh <command>
```

## Minimum Isolated Values

Use a dedicated namespace for every shared service:

```env
NODE_ENV=test
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
BETTER_AUTH_URL=http://127.0.0.1:3000

DATABASE_URL=postgresql://agentif:agentif@127.0.0.1:5432/agentifui_test
MIGRATOR_DATABASE_URL=postgresql://agentif:agentif@127.0.0.1:5432/agentifui_test

REDIS_URL=redis://127.0.0.1:6379/2
REDIS_PREFIX=agentifui-test
CACHE_L2_KEY_PREFIX=agentifui-test:cache:l2
CACHE_L2_INVALIDATION_CHANNEL=agentifui-test:cache:l2:invalidate
REALTIME_REDIS_CHANNEL=agentifui-test:realtime:events
REALTIME_REDIS_STREAM_KEY=agentifui-test:realtime:events:stream

S3_ENDPOINT=http://127.0.0.1:9000
S3_BUCKET=agentifui-test
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
S3_ENABLE_PATH_STYLE=1

BETTER_AUTH_ENABLED=true
AUTH_BACKEND=better-auth
BETTER_AUTH_SECRET=test-only-better-auth-secret-change-me
API_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

If you run tests inside a dev container, replace `127.0.0.1` with the host gateway that reaches the shared data services.

## Why Redis Needs More Than a Different DB

A separate Redis DB such as `/2` is necessary but not sufficient.

This project also uses named cache prefixes, invalidation channels, and realtime stream keys. Keep test values explicit so test traffic does not collide with `dev` or `prod`.

Relevant variables:

- `REDIS_PREFIX`
- `CACHE_L2_KEY_PREFIX`
- `CACHE_L2_INVALIDATION_CHANNEL`
- `REALTIME_REDIS_CHANNEL`
- `REALTIME_REDIS_STREAM_KEY`

## Bootstrap the Test Namespaces

### PostgreSQL

Create the test database once:

```bash
psql "postgresql://agentif:agentif@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE agentifui_test;
SQL
```

Then apply the public SQL migrations:

```bash
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh bash -lc '
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
'
```

### Redis

No extra bootstrap step is required beyond choosing a dedicated DB and test-only prefixes.

### MinIO

Create a dedicated bucket once:

```bash
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin
mc mb --ignore-existing local/agentifui-test
```

## Running Commands with the Test Profile

Examples:

```bash
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm test
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm build
AGENTIF_ENV_FILE=.env.test bash scripts/with-env-local.sh pnpm --filter @agentifui/api build
```

Use targeted commands when possible, but keep the test profile loaded so runtime assumptions match the isolated namespace.

## CI Parity

GitHub Actions uses the same variable model and applies the same SQL migrations, but it starts temporary PostgreSQL, Redis, and MinIO services on the GitHub runner itself.

That means CI does not talk to your existing dev or prod services unless you explicitly point it there.

## Isolation Boundary

With the setup above:

- tests do not write into the dev PostgreSQL database
- tests do not write into the prod PostgreSQL database
- tests do not write into dev or prod MinIO buckets
- tests do not share Redis prefixes, invalidation channels, or realtime stream keys with dev or prod

What is still shared in the minimum scheme:

- PostgreSQL server process and port
- Redis server process and port
- MinIO server process and port
- machine resources such as CPU, memory, network, and disk

So this is namespace isolation, not full infrastructure isolation.
