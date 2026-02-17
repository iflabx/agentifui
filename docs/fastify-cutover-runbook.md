# Fastify Cutover Runbook

## Scope

This runbook controls Next.js API ingress cutover to Fastify sidecar for `/api/internal*`, `/api/admin*`, `/api/dify*`, and `/api/translations*` prefixes.

## Preconditions

1. PM2 apps exist in `ecosystem.config.js`:
   - `AgentifUI` or `AgentifUI-Standalone`
   - `AgentifUI-API`
2. Database/Redis/S3 env for both app and api are already configured.
3. Build artifacts are ready (`pnpm build` and `pnpm build:api` in release pipeline).

## Enable Cutover

1. Start Fastify sidecar and switch Next rewrite on:
   - `pnpm fastify:cutover:on`
2. Optional target overrides:
   - `NEXT_PM2_APP=AgentifUI-Standalone pnpm fastify:cutover:on`
   - `FASTIFY_API_PORT=3011 FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3011 pnpm fastify:cutover:on`
3. Verify:
   - `curl -fsS http://127.0.0.1:3010/healthz`
   - `curl -i -X POST http://127.0.0.1:3000/api/internal/data -H 'content-type: application/json' --data '{}'`
   - expected status: `400` with `{"success":false,"error":"Missing action"}`

## Disable Cutover (Rollback)

1. Disable rewrite and restart Next:
   - `pnpm fastify:cutover:off`
2. Optional hard stop sidecar:
   - `STOP_FASTIFY_API=1 pnpm fastify:cutover:off`
3. Verify:
   - `curl -i -X POST http://127.0.0.1:3000/api/internal/data -H 'content-type: application/json' --data '{}'`
   - expected status: `400` (served by Next local legacy route)

## Safety Notes

1. Browser-side internal-data client has fail-open retry:
   - primary call: rewrite path
   - fallback call: sends `x-agentifui-fastify-bypass: 1` to bypass rewrite and hit Next legacy route directly
2. Fastify `internal-data` gateway timeout is configurable:
   - `FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS`
3. Legacy fallback for unknown `internal-data` actions is disabled by default:
   - default: `FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED=0`
   - emergency fallback on: `FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED=1`
4. M3 internal-data gate defaults to verify Fastify path unless disabled:
   - `M3_INTERNAL_DATA_USE_FASTIFY_PROXY=0` to run legacy-only path
