# Fastify Sidecar Bootstrap

## Overview

This repository now includes a Fastify API sidecar skeleton in `apps/api`.
The current migration strategy is:

1. Keep Next.js as the frontend runtime.
2. Run Fastify in parallel for API migration.
3. Use Next.js rewrites to forward selected `/api/*` prefixes to Fastify.
4. Let Fastify proxy not-yet-migrated routes back to Next upstream.

## Workspace Layout

1. Root app (existing Next.js)
2. `apps/api` (Fastify API sidecar)
3. `packages/shared` (shared runtime utilities)

## Commands

1. `pnpm dev:web`: start Next.js in development mode.
2. `pnpm dev:api`: start Fastify sidecar (`apps/api`).
3. `pnpm dev:all`: run both together.
4. `pnpm build:all`: build web + shared + api packages.
5. `pnpm start:api`: start built Fastify server.

## Key Environment Variables

1. `FASTIFY_PROXY_ENABLED`: `1` or `0`, controls Next.js rewrite forwarding.
2. `FASTIFY_PROXY_BASE_URL`: Fastify base URL, e.g. `http://127.0.0.1:3010`.
3. `FASTIFY_PROXY_PREFIXES`: comma-separated API prefixes to forward.
4. `FASTIFY_API_HOST`: Fastify bind host (default `0.0.0.0`).
5. `FASTIFY_API_PORT`: Fastify bind port (default `3010`).
6. `FASTIFY_LOG_LEVEL`: Fastify log level (default `info`).
7. `NEXT_UPSTREAM_BASE_URL`: Next upstream URL for Fastify fallback proxy.

## Health Endpoints

1. `GET /healthz` (Fastify runtime health).
2. `GET /api/internal/fastify-health` (Fastify migration health payload).

## Migrated Routes (Current)

1. `GET /api/translations/:locale`
   - Served directly by Fastify.
   - Keeps section filtering + file mtime cache behavior compatible with existing Next route.
2. `GET /api/internal/apps`
   - Served directly by Fastify.
   - Covers `scope=public|all`, `mode=default`, and `instanceId` query branches.
   - Uses PostgreSQL + RLS GUC context in Fastify, and bridges session identity via upstream `/api/internal/auth/profile-status`.
3. `PATCH /api/internal/apps`
   - Served directly by Fastify.
   - Preserves admin-only update contract for app visibility (`public|group_only|private`).
4. `GET /api/internal/profile`
   - Served directly by Fastify.
   - Preserves existing auth/authorization semantics (`401` unauthenticated, `403` forbidden cross-user access for non-admin).
5. `PATCH /api/internal/profile`
   - Served directly by Fastify.
   - Preserves field allow-list update semantics (`full_name`, `username`, `avatar_url`).
6. `POST /api/admin/encrypt`
   - Served directly by Fastify.
   - Preserves admin-only behavior and AES-256-GCM key encryption output format (`iv:authTag:encryptedHex`).
7. Other configured API prefixes still use Fastify fallback proxy to Next upstream.

## Smoke Check

1. Start Fastify:
   - `FASTIFY_API_PORT=3010 pnpm --filter @agentifui/api dev`
2. Direct Fastify route check:
   - `curl -i "http://127.0.0.1:3010/api/translations/en-US?sections=pages.home"`
3. Rewrite check from Next to Fastify:
   - `FASTIFY_PROXY_ENABLED=1 FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3010 PORT=3320 pnpm dev`
   - `curl -i "http://127.0.0.1:3320/api/translations/en-US?sections=pages.home"`
4. Fallback check (not yet migrated route):
   - `curl -i "http://127.0.0.1:3320/api/internal/auth/profile-status"`

## Notes

1. Rewrites are disabled by default.
2. Rewrites now use `beforeFiles` so existing Next API route files can still be cut over to Fastify.
3. Fastify adds `x-agentifui-fastify-bypass: 1` when proxying to Next to prevent rewrite loops.
