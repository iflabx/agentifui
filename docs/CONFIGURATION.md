# Runtime Configuration Guide

## Scope
This document describes user-facing runtime configuration. It applies to both local and production deployments and focuses on environment variables that control behavior, security, and integrations.

## Configuration Files
- Development: copy `.env.example` to `.env`
- Production: copy `.env.prod.example` to `.env.prod`

## Core Settings

### Application URLs
- `NEXT_PUBLIC_APP_URL` (required): public URL for the web app
- `BETTER_AUTH_URL` (required when better-auth is enabled): callback base URL

### Database
- `DATABASE_URL` (required): PostgreSQL connection string
- `PGURL` (optional): fallback connection string for scripts
- `APP_RLS_STRICT_MODE` (recommended in prod): `1` enforces strict RLS behavior

### Redis
- `REDIS_URL` (required): Redis connection string

### Storage (S3/MinIO)
- `S3_ENDPOINT` (required)
- `S3_BUCKET` (required)
- `S3_ACCESS_KEY_ID` (required)
- `S3_SECRET_ACCESS_KEY` (required)
- `S3_PUBLIC_READ_ENABLED` (optional): `1` for public objects, `0` for private

### Encryption & Secrets
- `API_ENCRYPTION_KEY` (required): 32-byte hex
- `BETTER_AUTH_SECRET` (required in prod when better-auth is enabled)

## Fastify Sidecar and Proxy
When Fastify is enabled, Next.js will rewrite selected API prefixes to Fastify.

Key settings:
- `FASTIFY_PROXY_ENABLED` (default on)
- `FASTIFY_PROXY_BASE_URL` (default `http://127.0.0.1:3010`)
- `FASTIFY_API_HOST` / `FASTIFY_API_PORT`
- `NEXT_UPSTREAM_BASE_URL` (Fastify -> Next)

## Dify Proxy Resilience
- `DIFY_PROXY_TIMEOUT_MS`
- `DIFY_PROXY_CIRCUIT_ENABLED`
- `DIFY_PROXY_CIRCUIT_FAILURE_THRESHOLD`
- `DIFY_PROXY_CIRCUIT_FAILURE_WINDOW_MS`
- `DIFY_PROXY_CIRCUIT_OPEN_DURATION_MS`
- `DIFY_PROXY_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`
- `DIFY_PROXY_CIRCUIT_FAILURE_STATUSES`
- `DIFY_PROXY_CIRCUIT_SHARED_STATE_ENABLED`
- `DIFY_PROXY_CIRCUIT_SHARED_METRICS_ENABLED`

## Dify Temporary Config (Admin-Only)
`_temp_config` allows temporary Dify verification without persisting settings. This is **disabled by default** and **admin-only**.

Enable with:
- `DIFY_TEMP_CONFIG_ENABLED=1`
- `DIFY_TEMP_CONFIG_ALLOWED_HOSTS=example.com,*.dify.internal`
- `DIFY_TEMP_CONFIG_ALLOW_PRIVATE=0` (recommended)

Behavior:
- Non-admin requests are rejected.
- Host must match `DIFY_TEMP_CONFIG_ALLOWED_HOSTS`.
- Private/loopback hosts are blocked unless explicitly allowed.
- Requests with `_temp_config` are forced to use GET.

## Notes
- Keep allowlists as narrow as possible.
- In production, enable `APP_RLS_STRICT_MODE=1`.
- See `docs/QUICK-DEPLOYMENT.md` for deployment flow.
