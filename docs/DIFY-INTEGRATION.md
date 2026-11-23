---
layout: default
title: Dify
parent: Agent Integrations
nav_order: 1
---

# Dify Service API Compatibility

For provider/application setup through the website, start with the
[administrator guide](ADMIN-GUIDE.md#dify). For end-user behavior, see the
[user guide](USER-GUIDE.md). This document describes integration contracts rather
than a complete upstream feature list.

AgentifUI uses Dify's application-scoped Service API, normally served under
`/v1`. Compatibility work targets the Dify `1.19.0` tagged implementation; this
does not mean every newer Dify feature is available in the AgentifUI interface.
Keep the Dify API URL and application API keys in private deployment
configuration. No Dify server upgrade is required. The shared generation
governance gate requires the AgentifUI migrations described in
[Agent Governance](AGENT-GOVERNANCE.md); deploy its API and browser client together.

Generation requests now require `x-agentifui-submission-id` (a UUID). Existing
cached browser pages must be refreshed after this coordinated upgrade. The
Dify service helpers create a new UUID per generation; their final optional
`{ submissionId }` argument lets an explicit replay reuse the original UUID.
Do not automatically resend a generation after a network interruption, and do
not reuse an ID for a new question. Existing legacy paths retain upstream `user`
binding and browser-side conversation/message saving. Explicitly negotiated
AG-UI chatbot conversations instead use trusted server bindings and server-side
saving; see the [compatibility reference](COMPATIBILITY.md) and
[AG-UI integration](AGUI-INTEGRATION.md). Never enable both persistence writers
for the same conversation.

## Implementation Boundaries

### Effective Input Requirements

The internal input-capabilities endpoint normalizes live `/parameters` into a
bounded contract shared by browser controls and API validation. Message `files`
and `inputs` file variables remain distinct slots. Exact upstream variable names
are preserved; no lowercase aliases or fabricated fields are sent. File-list
limits are not interpreted as required counts, and remote-only slots do not
enable local upload.

Native generation endpoints enforce aggregate slot counts and registered file
ownership/type/size before admission. Upload validation alone does not authorize
a later generation request. This does not route Workflow or text generation
through the text-only shared AG-UI transport; those execution adapters retain
their native execution semantics. New Workflow/text-generation sessions use the
shared chat interface with local task grouping; they do not gain upstream chat
memory. Each round is one independent `app_executions` record. Legacy execution
links remain readable without automatically creating conversations.

Administrators can set `config.task_input.text_variable` to an exact text field,
leave it absent to map one unambiguous text field, or use `null` for parameters-only
tasks. Other required fields and file slots remain parameters. Pure-file/parameter
tasks do not require dummy composer text. See the [administrator guide](ADMIN-GUIDE.md)
for configuration and [configuration](CONFIGURATION.md#dify-input-attachment-previews)
for the additive metadata migration and old-reference compatibility.

When a native Chatflow continuation omits initialization variables, the server
retrieves the latest inputs through the application's authenticated Dify message
history with the current user's identity. Recovered file references undergo the
same ownership, count, type and size checks before forwarding; a conversation ID
alone never bypasses those checks. Explicitly supplied values are not replaced,
and current-message attachments remain subject to their own limits. If history
or an old upload's trusted metadata is unavailable, the request fails rather than
silently guessing inputs or resending the task.

The Chatflow browser adapter uses the standard composer for the initial request.
The product currently treats each Chatflow conversation as a single-turn task:
after acceptance, further sends and edit-and-resend are not offered. While the
request runs, the stop action remains; afterwards, a new-task link opens a fresh
conversation without reusing its parameters or upload references. Reopened
history is read-only, including older multi-turn conversations. Requests rejected
before acceptance keep editable inputs. Initialization `inputs` and message
`files` slots retain their native payload semantics on the initial request.
Multiple slots require explicit purpose selection. Single-file variables remain
objects and file-list variables remain arrays, preserving exact keys without
duplicating input files in message `files`. Initialization fields are shown
directly above the first-message composer, without a disclosure; guidance and
fields disappear after the conversation starts, including when reopening
history. Stored scalar initialization metadata is retained but no longer fetched
for a composer summary. Upload references and execution snapshots retain their
existing persistence paths. This does not convert Chatflow into a new task
backend or alter its native conversation memory.

The configured `app_metadata.dify_apptype` determines task versus conversation
mode: Workflow and Text Generation run independent tasks; Chatflow still uses
the native conversation API. Its single-turn presentation is currently a product
UI convention, not a server-enforced API maximum-turns policy. Native continuation
compatibility remains in the backend; declaring a Chatflow as Workflow to change
its UI would select the wrong endpoint. The declared type must match the upstream
application and API endpoint.

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
Dify operations are application-scoped. Workflow logs, Workflow run details and
Workflow task stopping currently require an AgentifUI administrator. Other
authenticated roles receive HTTP 403 before those upstream requests are sent.
This also applies to the shortened Workflow route aliases. Input-file previews
instead require a registered upload or an accessible saved reference belonging
to the current user and application; a file ID alone does not authorize access.
Normal chat requests and user-scoped chat stop operations retain their existing
behavior. Workflow execution itself is still available to authorized users, but
the restricted follow-up operations are not available to ordinary users.

This is an interim restriction, not full per-resource ownership enforcement.
Restoring these operations for ordinary users requires trusted server-observed
ownership records; client-supplied run/task/file identifiers or locally saved
execution records are not sufficient proof. Existing signed file URLs remain
subject to their own authorization and expiration rules.

Authenticated proxy requests resolve the exact requested application under the
current user's permissions. An unavailable or unauthorized application does not
fall back to another application's default configuration.

## References

- [Dify 1.19.0 release](https://github.com/langgenius/dify/releases/tag/1.19.0)
- [Tagged Service API controllers](https://github.com/langgenius/dify/tree/1.19.0/api/controllers/service_api/app)
- [Official API documentation](https://docs.dify.ai/en/api-reference)

The documentation site may describe a newer version; use the fixed release tag
when checking version-specific behavior. Validate the app types actually used
by your installation before rollout, rather than assuming a passing chat test
also verifies Workflow, Completion, audio or files.
