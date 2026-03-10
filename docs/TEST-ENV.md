# Test Environment Guide

## Scope

This guide describes the minimum isolated test setup for AgentifUI when `dev` and `prod` already share existing PostgreSQL, Redis, and MinIO services.

The goal is isolation at the data namespace level:

- PostgreSQL: dedicated test database
- Redis: dedicated DB plus dedicated key/channel prefixes
- MinIO: dedicated bucket

This avoids direct writes into `dev` or `prod` business data, while still reusing the same service instances and ports.

## Recommended Files

- Copy `.env.test.example` to `.env.test`
- Keep `.env.dev` for development
- Keep `.env.prod` for production verification

If you run commands inside a dev container, replace `127.0.0.1` with the host gateway that reaches the shared data services. In the current workspace setup that gateway is `172.20.0.1`.

## Minimum Isolated Test Values

Use a dedicated namespace for every shared service:

```env
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
```

## Why Redis Needs More Than A Different DB

Using a different Redis DB such as `/2` separates most keys, but this project also uses named realtime channels and stream keys. Keep the test names explicit so test traffic does not collide with `dev` or `prod`.

Relevant runtime knobs:

- `REDIS_PREFIX`
- `CACHE_L2_KEY_PREFIX`
- `CACHE_L2_INVALIDATION_CHANNEL`
- `REALTIME_REDIS_CHANNEL`
- `REALTIME_REDIS_STREAM_KEY`

## Create The Test Namespaces

### PostgreSQL

Create a dedicated database once:

```bash
psql "postgresql://agentif:agentif@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE agentifui_test;
SQL
```

Run migrations against the test database before running integration tests.

### Redis

No separate database creation step is required. Using `redis://127.0.0.1:6379/2` is enough, provided the test-only prefixes and channel names are also set.

### MinIO

Create a dedicated bucket once:

```bash
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin
mc mb --ignore-existing local/agentifui-test
```

## Running With The Test Profile

Example commands on the host:

```bash
cp .env.test.example .env.test
# edit .env.test if needed

set -a
source .env.test
set +a

pnpm test
```

Inside a dev container, use the same flow but replace hostnames in `.env.test` with the host gateway, for example `172.20.0.1`.

## Isolation Boundary

With the configuration above:

- test does not write into the `dev` or `prod` PostgreSQL databases
- test does not write into the `dev` or `prod` MinIO buckets
- test does not share Redis keys, cache invalidation channels, or realtime channels with `dev` or `prod`

What is still shared:

- PostgreSQL server process and ports
- Redis server process and ports
- MinIO server process and ports
- machine resources such as CPU, memory, network, and disk

So this is data isolation, not full infrastructure isolation.
