# Fastify Internal-Data P2-P7 Closeout

## Scope

This document records completion of `internal-data` migration phases P2-P7:

1. P2: conversations/messages local handling.
2. P3: appExecutions local handling.
3. P4: users/groups/providers/serviceInstances/apiKeys/sso and group auth actions local handling.
4. P5: legacy fallback disabled by default.
5. P6: production-mode (`next build/start`) gate passed.
6. P7: cutover/rollback operations finalized.

## Final Action Coverage

`POST /api/internal/data` is now locally handled by Fastify for the full action set used by current web runtime:

1. `users.*`
2. `groups.*`
3. `providers.*`
4. `serviceInstances.*`
5. `apiKeys.*`
6. `conversations.*`
7. `messages.*`
8. `appExecutions.*`
9. `sso.*`

Unknown actions now return local `400 Unsupported action` by default.

## Fallback Policy

1. Default: `FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED=0`
2. Emergency-only override: `FASTIFY_INTERNAL_DATA_LEGACY_FALLBACK_ENABLED=1`

## Validation Commands

1. Dev-mode full gate:
   - `pnpm m3:internal-data:verify`
2. Prod-mode full gate:
   - `pnpm m3:internal-data:verify:prod`
3. Cutover smoke:
   - `pnpm fastify:cutover:on`
   - `curl -i -X POST http://127.0.0.1:3000/api/internal/data -H 'content-type: application/json' --data '{}'`

## Operational Checklist

1. Enable cutover: `pnpm fastify:cutover:on`
2. Validate health and internal-data smoke.
3. Run production-mode gate before acceptance.
4. If rollback needed:
   - `pnpm fastify:cutover:off`
   - optional sidecar stop: `STOP_FASTIFY_API=1 pnpm fastify:cutover:off`

## Notes

1. `x-agentifui-internal-data-handler` response header is used as migration-path proof (`local|legacy`).
2. Browser fail-open retry to Next legacy endpoint remains as emergency safety net.
