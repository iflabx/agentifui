# Error Observability Unification

## Scope

- Unified API error envelope for Next/Fastify core data paths.
- Request ID propagation via `x-request-id`.
- Error event persistence to PostgreSQL (`error_events`) with optional Redis stream marker.
- Admin observability page at `/admin/errors`.

## Error Envelope (Backward Compatible)

All error responses now keep legacy fields and add structured metadata:

```json
{
  "success": false,
  "error": "Missing action",
  "app_error": {
    "code": "BAD_REQUEST",
    "source": "next-api",
    "severity": "error",
    "retryable": false,
    "userMessage": "Missing action",
    "requestId": "uuid",
    "occurredAt": "ISO-8601"
  },
  "request_id": "uuid"
}
```

Success payloads now include `request_id` when available.

## Request ID

- Middleware injects `x-request-id` into forwarded request headers and API responses.
- Dify proxy and internal-data routes return `x-request-id` on every response.

## Storage

- Migration: `database/migrations/20260217153000_add_error_events_table.sql`
- Table: `error_events`
- Upsert key: `fingerprint` (code/source/route/method/normalized-message hash)
- Sensitive keys in context are redacted before persistence.

## New Internal Data Actions

- `errors.getSummary` (admin only)
  - payload: `{ "hours": number }` (default 24, max 720)
- `errors.getRecent` (admin only)
  - payload: `{ "limit": number, "offset": number }` (default 50/0)

Both are implemented in:

- `app/api/internal/data/route.ts` (Next local route)
- `apps/api/src/routes/internal-data.ts` (Fastify local route)

## Admin UI

- New page: `app/admin/errors/page.tsx`
- Shows:
  - 24h summary metrics
  - Recent event list with severity, code, message, request ID, occurrence count

## Frontend Error Consumption

- Shared parser/normalizer:
  - `lib/errors/app-error.ts`
  - `lib/errors/ui-error.ts`
- Integrated into:
  - `lib/db/internal-data-api.ts`
  - `lib/services/dify/chat-service.ts`
  - workflow/text-generation/chat hooks

## Additional Hardening

- Added route error boundaries:
  - `app/error.tsx`
  - `app/global-error.tsx`
- Fixed text-generation clear-error behavior:
  - `components/text-generation/text-generation-layout.tsx`
  - `lib/hooks/use-text-generation-execution.ts`
