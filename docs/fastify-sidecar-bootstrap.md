# Fastify Sidecar Bootstrap

## Overview

This repository now includes a Fastify API sidecar skeleton in `apps/api`.
The current migration strategy is:

1. Keep Next.js as the frontend runtime.
2. Run Fastify in parallel for API migration.
3. Use Next.js rewrites to forward selected `/api/*` prefixes to Fastify.
4. Keep Fastify fallback proxy disabled by default; only use it as an emergency rollback aid.

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
6. `pnpm m3:internal-data:verify:prod`: run full internal-data regression in production runtime (`next build/start` + `api build/start`).

## Key Environment Variables

1. `FASTIFY_PROXY_ENABLED`: `1` or `0`, controls Next.js rewrite forwarding.
2. `FASTIFY_PROXY_BASE_URL`: Fastify base URL, e.g. `http://127.0.0.1:3010`.
3. `FASTIFY_PROXY_PREFIXES`: comma-separated API prefixes to forward.
4. `FASTIFY_API_HOST`: Fastify bind host (default `0.0.0.0`).
5. `FASTIFY_API_PORT`: Fastify bind port (default `3010`).
6. `FASTIFY_LOG_LEVEL`: Fastify log level (default `info`).
7. `FASTIFY_PROXY_FALLBACK_ENABLED`: `1` enables fallback proxy to Next for unmatched proxied paths (default `0`).
   - This is emergency-only and should stay `0` in normal operation.
8. `NEXT_UPSTREAM_BASE_URL`: Next upstream URL for auth outbound calls and optional fallback proxy.
9. `REALTIME_SOURCE_MODE`: for Fastify-proxied `/api/internal/apps` and `/api/internal/profile`, use `db-outbox` (guard blocks `app-direct|hybrid`).

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
   - Uses PostgreSQL + RLS GUC context in Fastify with local session identity resolution.
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
7. `GET /api/admin/status`
   - Served directly by Fastify.
   - Preserves admin-only status summary contract (`hasActiveProviders`, `hasActiveInstances`, `providersCount`, `timestamp`).
8. `GET /api/admin/users`
   - Served directly by Fastify.
   - Preserves admin-only active-user list contract used by management UIs.
9. `POST /api/admin/users/for-group`
   - Served directly by Fastify.
   - Preserves admin-only group-member candidate pagination/search contract.
10. `GET/PUT /api/admin/translations`
    - Served directly by Fastify.
    - Preserves admin-only dynamic translation read/update contract, including section-level merge/replace modes.
11. `GET /api/internal/dify-config/:appId`
    - Served directly by Fastify.
    - Preserves admin-only Dify app config contract (provider resolution + default-instance fallback + API key decrypt).
12. `GET /api/internal/auth/local-password`
    - Served directly by Fastify.
    - Preserves authenticated local-password state contract (auth mode + user toggle + fallback password presence).
13. `POST /api/internal/auth/local-password/bootstrap`
    - Served directly by Fastify.
    - Preserves authenticated bootstrap contract (`newPassword` required, existing fallback password returns `409`).
    - Uses better-auth `set-password` when available, and falls back to legacy Next bootstrap endpoint when upstream does not expose that route.
14. `POST /api/internal/auth/local-password/change`
    - Served directly by Fastify.
    - Preserves authenticated password change contract (`currentPassword` + `newPassword` required, missing fallback password returns `409`).
    - Uses better-auth `change-password` endpoint with legacy Next route fallback if needed.
15. `GET/PATCH /api/admin/auth/fallback-policy`
    - Served directly by Fastify.
    - Preserves admin-only auth-mode policy management (`normal` / `degraded`).
16. `GET/PATCH /api/admin/auth/fallback-policy/users/:userId`
    - Served directly by Fastify.
    - Preserves admin-only per-user local-login toggle/state management.
17. `POST /api/internal/data`
    - Served by Fastify as a compatibility gateway.
    - Preserves the unified action contract (`{ action, payload }`).
    - Current local extraction scope:
      - `users.*` (`getUserList`, `getUserStats`, `getUserById`, `updateUserProfile`, `deleteUser`, `createUserProfile`, `batchUpdateUserStatus`, `batchUpdateUserRole`)
      - `groups.*` (`getGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `getGroupMembers`, `addGroupMember`, `removeGroupMember`, `getGroupAppPermissions`, `setGroupAppPermission`, `removeGroupAppPermission`, `removeAllGroupAppPermissions`, `searchUsersForGroup`, `getUserAccessibleApps`, `checkUserAppPermission`, `incrementAppUsage`)
      - `providers.*` (`getAllProviders`, `getActiveProviders`, `createProvider`, `updateProvider`, `deleteProvider`)
      - `serviceInstances.*` (`getByProvider`, `getById`, `create`, `update`, `delete`, `setDefault`)
      - `apiKeys.*` (`getByServiceInstance`, `create`, `update`, `delete`)
      - `conversations.*` (`getConversationByExternalId`, `createConversation`, `getUserConversations`, `renameConversation`, `deleteConversation`)
      - `messages.*` (`getLatest`, `findDuplicate`, `save`, `createPlaceholder`)
      - `appExecutions.*` (`getByServiceInstance`, `getById`, `create`, `updateStatus`, `updateComplete`, `delete`)
      - `sso.*` (`getSsoProviders`, `getSsoProviderStats`, `getSsoProviderById`, `createSsoProvider`, `updateSsoProvider`, `deleteSsoProvider`, `toggleSsoProvider`, `updateSsoProviderOrder`)
    - 默认不再透传 legacy：未识别 action 直接返回本地 `400 Unsupported action`。
    - 不再支持透传 legacy Next `internal/data`。
    - Response includes `x-agentifui-internal-data-handler: local` for phase-level verification.
18. `GET /api/internal/realtime/stream`
    - Served directly by Fastify.
    - Preserves SSE contract (`ready/ping/message/replay-gap`) and `last-event-id` replay behavior.
    - Preserves key-level permission model (`self/admin/conversation-owner/admin-only`) and default key->table config mapping.
19. `GET /api/internal/realtime/stats`
    - Served directly by Fastify.
    - Preserves admin-only contract and exposes subscription + broker metrics.
20. `POST/GET /api/internal/storage/avatar/presign`
    - Served directly by Fastify.
    - Preserves avatar upload/download presign contract, ownership checks, and public/private read-mode behavior.
21. `POST/DELETE /api/internal/storage/avatar`
    - Served directly by Fastify.
    - Preserves avatar commit/delete contract and profile `avatar_url` update semantics.
22. `POST/GET /api/internal/storage/content-images/presign`
    - Served directly by Fastify.
    - Preserves content-image upload/download presign contract and read-mode behavior.
23. `GET/POST/DELETE /api/internal/storage/content-images`
    - Served directly by Fastify.
    - Preserves content-image list/commit/delete contract with ownership checks.
24. Other configured API prefixes should be migrated route-by-route and not rely on fallback as a steady-state path.

## Smoke Check

1. Start Fastify:
   - `FASTIFY_API_PORT=3010 pnpm --filter @agentifui/api dev`
2. Direct Fastify route check:
   - `curl -i "http://127.0.0.1:3010/api/translations/en-US?sections=pages.home"`
3. Rewrite check from Next to Fastify:
   - `FASTIFY_PROXY_ENABLED=1 FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3010 PORT=3320 pnpm dev`
   - `curl -i "http://127.0.0.1:3320/api/translations/en-US?sections=pages.home"`
4. Optional emergency fallback check (for rollback drills only):
   - `curl -i "http://127.0.0.1:3320/api/internal/auth/profile-status"`

## Notes

1. Rewrites are disabled by default.
2. Rewrites now use `beforeFiles` so existing Next API route files can still be cut over to Fastify.
3. Fastify adds `x-agentifui-fastify-bypass: 1` when proxying to Next to prevent rewrite loops.
4. Browser internal-data client is single-path only and does not fallback to legacy Next handler.
5. In target A, auth/SSO routes stay in Next while business APIs converge to Fastify.
