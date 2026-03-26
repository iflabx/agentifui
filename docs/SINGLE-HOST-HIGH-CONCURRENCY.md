# AgentifUI Single-Host High-Concurrency Deployment

## 1. Scope

This guide describes the recommended deployment shape when you want to run AgentifUI on a single Ubuntu host and still preserve reasonable concurrency and stability.

It supplements `docs/QUICK-DEPLOYMENT.md`. Use this document when:

1. You deploy to one physical or virtual Ubuntu server.
2. You want better concurrency than a single-process setup.
3. You want a production shape that still matches this repository's runtime architecture.

## 2. Recommended Topology

Run these components on the same host:

- `Nginx` as the public entrypoint on `80/443`
- `Next.js` web service managed by PM2 in `cluster` mode
- `Fastify` API service managed by PM2 in `cluster` mode
- `PgBouncer` in front of PostgreSQL
- `Redis` for shared cache and invalidation
- `PostgreSQL` for application data and auth state

Recommended request flow:

1. Browser traffic reaches `Nginx`
2. Page requests go to `Next.js`
3. `/api/*` requests go directly to `Fastify`
4. App services talk to `Redis`, `PgBouncer`, and `PostgreSQL`

## 3. Why This Shape Fits This Repository

This project is not a static frontend. It combines:

- `Next.js` SSR web pages
- a separate `Fastify` API sidecar
- authentication and database-backed state
- streaming and realtime endpoints

Because of that, the recommended single-host target is not a single `next start` process. The better shape is:

- reverse proxy in front
- web and API as separate services
- multiple Node.js worker processes
- controlled database fan-out

## 4. Core Deployment Rules

### 4.1 Use a Dedicated Production Checkout

Deploy production from a dedicated `main` checkout, not from the active development directory.

Do not share these between dev and prod:

- `.next`
- `node_modules`
- `pm2` logs
- runtime temp files

## 4.2 Route `/api/*` Directly to Fastify

At the proxy layer:

- page requests should go to `Next.js`
- `/api/*` should go directly to `Fastify`

This avoids pushing high-volume API traffic through the Next.js rewrite layer.

If your public proxy is doing the split, the production environment should generally use:

```env
FASTIFY_PROXY_ENABLED=0
```

## 4.3 Run PM2 in Cluster Mode

Do not keep production on `instances: 1` with `fork` mode if your goal is higher concurrency.

Recommended pattern:

- `Next.js` web: PM2 `cluster`
- `Fastify` API: PM2 `cluster`

Suggested starting point:

- `8 CPU / 16 GB`: web `2`, api `3`
- `16 CPU / 32 GB`: web `3-4`, api `4-6`

Tune from there based on:

- CPU saturation
- memory pressure
- PostgreSQL load
- upstream Dify latency

## 4.4 Keep Realtime on `db-outbox`

For multi-process operation on one host, prefer:

```env
REALTIME_SOURCE_MODE=db-outbox
```

This is the safer default for cross-process consistency.

## 4.5 Enable Shared Cache via Redis

This repository already supports local cache plus optional Redis L2 cache.

For multi-process production, enable Redis L2:

```env
CACHE_L2_REDIS_ENABLED=1
```

Without Redis, each process keeps its own cache and invalidation becomes weaker.

## 4.6 Keep PostgreSQL Pool Sizes Conservative

Do not solve concurrency by setting very large per-process pool sizes.

Recommended approach:

- keep `PG_POOL_MAX` conservative
- use `PgBouncer` to absorb connection pressure

Suggested starting point:

```env
PG_POOL_MAX=5
PG_POOL_IDLE_MS=30000
PG_POOL_CONNECT_MS=5000
```

## 5. Nginx Requirements

Nginx should:

- terminate TLS
- proxy page traffic to the web service
- proxy `/api/*` traffic to the API service
- cache static assets where appropriate

For streaming endpoints such as realtime and Dify stream responses, disable proxy buffering:

- `proxy_buffering off`
- `proxy_request_buffering off`
- `proxy_read_timeout 3600`

This is important for:

- server-sent events
- long-lived streaming responses

## 6. Production Environment Baseline

Suggested baseline values:

```env
NODE_ENV=production
FASTIFY_PROXY_ENABLED=0
REALTIME_SOURCE_MODE=db-outbox
CACHE_L2_REDIS_ENABLED=1
PG_POOL_MAX=5
PG_POOL_IDLE_MS=30000
PG_POOL_CONNECT_MS=5000
```

You still need the normal production settings from `docs/CONFIGURATION.md` and `docs/QUICK-DEPLOYMENT.md`, including:

- app URLs
- auth secrets
- database credentials
- Redis URL
- object storage settings

## 7. Operating System Baseline

Before load testing or production launch, tune the host at least enough to avoid trivial bottlenecks:

- raise `nofile`
- use `worker_processes auto` in Nginx
- increase `worker_connections`
- keep prod and dev runtimes separated

## 8. Deployment Order

Recommended order on a single host:

1. Prepare the dedicated production checkout
2. Install dependencies with a frozen lockfile
3. Configure `.env.prod`
4. Build with `pnpm build:prod`
5. Start web and API with PM2
6. Put Nginx in front of them
7. Run production smoke checks

## 9. Not Recommended

These shapes can work, but are not the recommended high-concurrency target for this repository:

- one `next start` process only
- one `pm2` `fork` process for web and one for API
- exposing the Node.js ports directly to the internet
- using large direct PostgreSQL pool sizes without `PgBouncer`
- mixing dev and prod inside the same working directory

## 10. Summary

For a single Ubuntu host, the recommended deployment shape is:

`Nginx -> PM2 cluster (Next.js + Fastify) -> Redis + PgBouncer + PostgreSQL`

That gives this repository a much better concurrency baseline than a single-process deployment while keeping the setup operationally simple.
