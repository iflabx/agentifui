# Fastify Cutover Runbook

## Scope

This runbook controls Next.js API ingress cutover to Fastify sidecar for:
`/api/internal/data*`, `/api/internal/apps*`, `/api/internal/profile*`,
`/api/internal/dify-config*`, `/api/internal/auth/local-password*`,
`/api/internal/fastify-health*`, `/api/admin*`, and `/api/translations*`.

## Preconditions

1. PM2 apps exist in `ecosystem.config.js`:
   - `AgentifUI` or `AgentifUI-Standalone`
   - `AgentifUI-API`
2. Database/Redis/S3 env for both app and api are already configured.
3. Build artifacts are ready. Next build must include Fastify rewrite rules:
   - `FASTIFY_PROXY_ENABLED=1 FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3010 pnpm build`
   - `pnpm build:api`

## Enable Cutover

1. Start Fastify sidecar and switch Next rewrite on:
   - `pnpm fastify:cutover:on`
   - The script validates `.next/routes-manifest.json` first and fails fast if rewrite rules were not built in.
2. Optional target overrides:
   - `NEXT_PM2_APP=AgentifUI-Standalone pnpm fastify:cutover:on`
   - `FASTIFY_API_PORT=3011 FASTIFY_PROXY_BASE_URL=http://127.0.0.1:3011 pnpm fastify:cutover:on`
3. Verify:
   - `curl -fsS http://127.0.0.1:3010/healthz`
   - `curl -i http://127.0.0.1:3000/api/internal/fastify-health`
   - `curl -i -X POST http://127.0.0.1:3000/api/internal/data -H 'content-type: application/json' --data '{}'`
   - expected status: `400` with `{"success":false,"error":"Missing action"}`
4. Production-mode gate (recommended before accepting cutover):
   - `pnpm m3:internal-data:verify:prod`

## Disable Cutover (Rollback)

1. Disable rewrite and restart Next:
   - `pnpm fastify:cutover:off`
2. Optional hard stop sidecar:
   - `STOP_FASTIFY_API=1 pnpm fastify:cutover:off`
3. Verify:
   - `curl -i -X POST http://127.0.0.1:3000/api/internal/data -H 'content-type: application/json' --data '{}'`
   - expected status: `503` (served by Next disabled stub, code `INTERNAL_DATA_NEXT_DISABLED`)

## Safety Notes

1. Fastify `internal-data` gateway timeout is configurable:
   - `FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS`
2. Unknown `internal-data` actions always return local `400 Unsupported action`.
3. M3 internal-data gate defaults to verify Fastify path unless disabled:
   - `M3_INTERNAL_DATA_USE_FASTIFY_PROXY=0` to run legacy-only path
