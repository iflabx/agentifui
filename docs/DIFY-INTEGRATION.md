# Dify Service API Compatibility

AgentifUI uses Dify's application-scoped Service API, normally served under
`/v1`. Compatibility work targets the Dify `1.19.0` tagged implementation; this
does not mean every newer Dify feature is available in the AgentifUI interface.
Keep the Dify API URL and application API keys in private deployment
configuration. No Dify server upgrade or AgentifUI database migration is needed
for these client changes.

## Implementation Boundaries

- The authenticated proxy lives in `apps/api/src/routes/dify-proxy.ts` and
  `apps/api/src/routes/dify-proxy-route/`. The legacy Next.js Dify route is a
  disabled compatibility stub; add proxy behavior in Fastify rather than
  restoring the old handler.
- Keep client operations, streaming handling, and result processing in the
  relevant modules under `lib/services/dify/`. Browser requests use the
  authenticated AgentifUI proxy and never carry an upstream application API key.
- Define upstream request, response, and event types under
  `lib/services/dify/types/`, with exports through `lib/services/dify/types.ts`.
  Reuse existing error and stream-handling patterns.
- When adding an operation, verify its route and behavior against the supported
  Dify release, cover the affected app types, and update this compatibility
  document. Parsing a new event does not by itself implement the corresponding
  UI feature.

## Existing Interfaces

| Application or operation                    | Service API path                                     |
| ------------------------------------------- | ---------------------------------------------------- |
| Chatbot, legacy Agent and Chatflow messages | `POST /chat-messages`                                |
| Text generation                             | `POST /completion-messages`                          |
| Workflow execution                          | `POST /workflows/run`                                |
| Workflow run detail                         | `GET /workflows/run/{run_id}`                        |
| Stop Workflow                               | `POST /workflows/tasks/{task_id}/stop`               |
| App information and configuration           | `GET /info`, `/parameters`, `/meta`, `/site`         |
| File upload and download                    | `POST /files/upload`, `GET /files/{file_id}/preview` |

Conversation, message, feedback and suggested-question requests retain their
existing Service API endpoints. Workflow apps keep shared app/file/audio routes
outside the `/workflows` prefix. Only recognized legacy Workflow shorthand paths
are expanded; unsupported Workflow routes are rejected rather than guessed.

The Dify 1.19.0 release notes also discuss run-based stop operations under
`/openapi/v1`. Those belong to a different API surface and do not replace the
Service API task-based stop endpoint used here. Console APIs, workspace Skills,
package imports and tracing administration are not part of this integration.

## Streaming And Results

- Chat, Completion and Workflow share a buffered SSE parser with UTF-8, BOM,
  LF/CR/CRLF, keepalive and final-frame handling. Unknown JSON event types remain
  parseable; that alone does not give them UI support.
- Message persistence prefers `message_id`, with the legacy `id` fallback.
  Completion token usage accepts `metadata.usage` and the legacy top-level field.
- Workflow detail inputs can be JSON values, not only serialized strings.
  Workflow logs have a nested `workflow_run` record, which can be null.
- `partial-succeeded` is a finished upstream result, not a fully successful run.
  Outputs and the original status are retained; the existing local history marks
  it failed with an explanation instead of claiming complete success. Stopped
  runs retain the local stopped status.
- Human Input pauses are detected and reported explicitly. Human Input forms,
  submitting answers and resuming paused runs are not implemented. Do not use
  HITL-dependent apps here until that separate feature is supported. The client
  reports an unsupported-operation error; the upstream run remains paused, not
  stopped or resumed by that error.
- New Agent variants, separated reasoning streams, Workflow text-delta rendering
  and nested tracing are not automatically enabled by a Dify backend upgrade.

## Files And Limits

Successful file-preview responses are forwarded without converting file bytes
to text, including document/archive MIME types. HTML, SVG and XML responses keep
forced-download, sandbox and `nosniff` protections.

`DIFY_UPLOAD_MAX_BYTES` sets the total buffered multipart request limit for
`POST /files/upload` and `POST /audio-to-text`. The default is `16777216` bytes
(16 MiB), leaving room for multipart overhead around a 15 MiB file. It must be a
decimal safe integer of at least 1024; an invalid configured value prevents API
startup. Other API routes keep their original body limits. Dify and reverse
proxies enforce their own limits independently; larger audio/file requirements
need an appropriately bounded setting at each layer. Uploads are buffered, so
account for concurrency and available memory before increasing the limit.

## Identity Boundary

Browsers call AgentifUI's authenticated proxy, not Dify with exposed API keys.
The proxy replaces `user` with the current application user in JSON, multipart
and query data. Generation inputs under `agentifui_user_` are server-controlled,
including version-specific Workflow execution paths.

An upstream `user` parameter is not a universal resource-ownership check: some
Dify operations are application-scoped. Do not treat app-wide workflow logs or
knowledge of a run/task/file identifier as proof of end-user authorization.
Full server-observed per-resource ownership enforcement is a separate pending
security task; this compatibility work does not claim to complete it.

## References

- [Dify 1.19.0 release](https://github.com/langgenius/dify/releases/tag/1.19.0)
- [Tagged Service API controllers](https://github.com/langgenius/dify/tree/1.19.0/api/controllers/service_api/app)
- [Official API documentation](https://docs.dify.ai/en/api-reference)

The documentation site may describe a newer version; use the fixed release tag
when checking version-specific behavior. Validate the app types actually used
by your installation before rollout, rather than assuming a passing chat test
also verifies Workflow, Completion, audio or files.
