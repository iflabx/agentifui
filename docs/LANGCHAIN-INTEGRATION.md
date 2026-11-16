---
layout: default
title: LangChain
parent: Agent Integrations
nav_order: 2
---

# LangChain Agent Integration

For website configuration, follow the [administrator guide](ADMIN-GUIDE.md#langchain).
For conversation and confirmation tasks, see the [user guide](USER-GUIDE.md).
This document defines what the upstream service must implement; configuring a
provider does not host or build the Agent.

AgentifUI can connect an existing LangChain Agent service alongside Dify. It
does not build or host agents. This integration targets a service exposing the
AG-UI subset described here, plus LangGraph-style thread and run queries. A
generic LangChain runnable or an arbitrary LangGraph endpoint is not sufficient.
The verified service profile uses `ag-ui-protocol` 0.1.22 conventions. It is
not a complete implementation of the newer AG-UI 1.0 specification: multi-run
replay, reopened message/tool IDs and additional state events are outside this
profile. Sanitized internal tool events are summaries, not a transparent AG-UI
wire proxy.

## Configure An Application

Generation uses the common server-side identity, input moderation, quota and
idempotency gate described in [Agent Governance](AGENT-GOVERNANCE.md). Ordinary
applications do not enable human input or resume. A separate, explicitly enabled
native interrupt profile is described below; stream replay remains unsupported.

1. Apply the database migrations using the deployment's usual migration process.
2. In API configuration, create a provider whose base URL is reachable from every
   API replica. Use HTTPS outside a trusted local network. Do not put credentials
   in the URL.
3. Add a service instance, select the **LangChain** backend, and set its assistant
   identifier to match the service. Keep this application in the application
   marketplace, not the Dify model selector.
4. Set the instance's service token using the existing encrypted API-key field.
   Set `API_ENCRYPTION_KEY` on the server as for other service credentials. Keep
   tokens and actual addresses in deployment-owned configuration, not Git.
5. Choose public, group-only or private visibility. Here, public means visible to
   signed-in users; generation still requires an active account.
6. Open the application from the application list. Its page includes local
   conversation history and supports text input only.

The generic, non-secret instance configuration is:

```json
{
  "backend_type": "langchain",
  "langchain": { "assistant_id": "agent" },
  "app_metadata": {
    "app_type": "marketplace",
    "is_marketplace_app": true,
    "tags": ["Agent"]
  }
}
```

Missing `backend_type` continues to mean Dify. Do not set a Dify subtype for a
LangChain application. Ordinary application responses omit connection details
and return only allowlisted display configuration. Service tokens never go to
the browser.

## Required Service Contract

The server uses `Authorization: Bearer <service-token>` and never follows redirects.

| Endpoint                                 | Required behavior                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `GET /capabilities`                      | Authenticated metadata identifying the configured assistant            |
| `POST /threads`                          | Accept `{}` and return a server-generated `thread_id`                  |
| `POST /ag-ui`                            | Accept one new user message and return the event stream described here |
| `GET /threads/{thread_id}/runs/{run_id}` | Return the native thread/run IDs and execution status                  |

Each AG-UI request includes `threadId`, a new correlation `runId`, one user
message with an ID, and empty `state`, `tools`, `context` and `forwardedProps`.
The service owns execution memory; AgentifUI never resends the entire local
history. Inputs are limited to 16,000 characters and a 64 KiB encoded request.

SSE frames contain JSON with `type`, independent of the optional SSE `event`
header. Supported events are:

- `RUN_STARTED`, with matching thread and correlation IDs.
- `CUSTOM` named `native_run`, containing the actual native `run_id`.
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT` and `TEXT_MESSAGE_END`.
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END` and `TOOL_CALL_RESULT`.
- `RUN_FINISHED` after confirmed successful execution, or `RUN_ERROR`.

The native run ID differs from the AG-UI correlation ID. Neither is an upstream
idempotency key. Text or tool completion is not run completion. Unexpected EOF,
timeout, malformed framing or inconsistent identifiers cannot produce a local
successful result. The parser bounds frames, stream size and event counts.

Tool parameters and raw tool results are not rendered. The first version shows
only validated tool names and execution status. Files, frontend tools, arbitrary
state synchronization, resumable streams and execution cancellation are not
supported. Human input requires the separate native profile below, not this
legacy bridge. Do not enable corresponding UI capabilities
merely because the upstream schema advertises additional endpoints.

New tool summaries carry a local run identity, an optional mapped local parent
message and a small projection order. Known text/tool/text ordering is retained
after refresh; native IDs are not local authorization IDs. Older summaries with
no ordering evidence stay labeled summaries rather than fabricated event
history. This is a compatibility projection, not a full event store.

## Identity, Saving And Limits

Website sessions, account state and application access are checked by Fastify.
The upstream service token does not identify individual website users. A
server-controlled binding associates a local conversation with a service
instance UUID and native thread; client metadata and external IDs do not grant
ownership. Dedicated endpoints under
`/api/internal/apps/{service-instance-uuid}/agent` own runs and history.

LangChain messages are saved on the server. Existing Dify persistence remains
unchanged. The server atomically reserves a submission and user message before
generation, including the first message before a conversation ID exists. Reuse
of a submission ID returns the original run; different content with that ID is
rejected. Multiple assistant messages retain distinct local IDs. Generic data
endpoints cannot write these conversations' messages or trusted run fields.

Default admission limits are one active run per user, two per application and
one per conversation. `AGENT_MAX_ACTIVE_PER_USER` and
`AGENT_MAX_ACTIVE_PER_APP` can change the first two limits; use positive integers
appropriate for actual service capacity. PostgreSQL transactions enforce the
limits across API replicas. Admission failures reject generation rather than
falling back to a process-local counter or an unbounded queue.

Execution and persistence statuses are separate. A successful model call with
failed saving is not a completely saved conversation. Retrying persistence uses
the same known snapshot, never a second model call. Browser disconnects do not
cancel execution: a live API consumes the stream within its bounded timeout and
tries to finish saving. Background work participates in replica draining.
The browser retains known streamed content when saving fails, blocks further
generation on that conversation, and polls the existing run a bounded number
of times. A manual status/save retry restarts only that lookup, never execution.
After refresh, an authorized run response can return a restricted visible
message snapshot while the same saved result is being recovered.

## Failure And Operational Boundaries

- Unknown results keep their admission slot and block overlapping generation.
  Run queries may report native status, but cannot reconstruct missing text by
  guessing the last upstream message. There is no automatic execution retry.
- If a save snapshot is available, a run query can retry saving that exact
  snapshot. If no complete snapshot exists, an operator must investigate the
  specific run and upstream state; do not blindly delete active records or
  treat an elapsed timeout as cancellation.
- API process loss does not provide durable stream recovery. Use a backend
  suitable for production persistence and availability before production rollout.
- Conversation deletion is local soft deletion and revokes subsequent local
  operations. It does not claim to delete upstream execution memory or backups.
- An application with history cannot change backend type. Endpoint or assistant
  changes invalidate existing trusted bindings rather than silently
  moving history to another backend identity. Create a separate application for
  a different backend; retain the original configuration for its history. A token
  rotation for the same service identity preserves the binding; the upstream
  must still authorize access to the existing native thread.
  Rotation of the effective credential is blocked until unresolved tasks have
  been reconciled. Capability preflight failures occur before the generation
  dispatch boundary and release admission; a dispatched POST with an unknown
  outcome retains protection instead of being retried automatically.
- Disable the new application/provider to stop new use without changing Dify.
  Additive tables remain during rollback; do not run destructive down migrations.

The HTTPS gateway must pass authenticated requests and SSE without buffering or
automatic upstream retries. Its timeout must accommodate the service runtime
and API stream deadline. Every API replica needs the same database access,
encryption configuration and upstream reachability. Validate fresh installation,
incremental migration and multiple replicas with isolated data before rollout.

## Optional Native Human Input

A separate LangChain application may explicitly set
`config.langchain.human_input: true` together with its configured `assistant_id`.
Apply `20261115090000_add_agent_human_input.sql` before using this profile.
Also apply `20261115100000_add_agent_resume_dispatch_fence.sql` in order; it
permits only proven pre-dispatch claims to be released safely.
Use a separate application rather than changing an existing conversation's
execution profile. This opt-in requires an upstream service with the specific
native interrupt contract; it does not make an arbitrary LangGraph deployment
compatible.

The service must advertise the configured assistant in `/capabilities` with
`native_interrupt`, `native_resume`, `one_task_per_thread: true` and the
`approve` / `reject` actions. The server uses native thread creation,
`POST /threads/{thread}/runs/stream`, run lookup, run listing and
`GET /threads/{thread}/state`, not `/ag-ui`. It sends only the new user input or
the saved interrupt's `command.resume` map. The browser cannot supply native
identifiers, checkpoints, commands or history.

The supported prompt is version 1 of
`agentifui.acceptance.confirmation`: one real interrupt, plain-text title and
description, approve/reject, an optional bounded comment and a nullable
`expires_at`. Multiple simultaneous interrupts and arbitrary forms are rejected,
not silently reduced to one item. A native run reporting `success` while a real
interrupt remains is a **waiting** segment, not a completed task. This profile
accepts one task per conversation; start a new conversation for another task.

The shared chat restores pending forms from the authorized conversation and
records a decision in a separate resume run without adding a fake user question.
The initial task uses the existing question quota once; each resume still needs
current access, moderation and a free execution slot. Refresh and history are
read-only and never submit a decision. Unknown acceptance is reconciled through
bounded queries rather than automatic POST retries. Native service tokens do
not replace website ownership or application permissions.

See [AG-UI Integration](AGUI-INTEGRATION.md#human-input-product-boundary) for the
product endpoints, states and compatibility boundary. This is a controlled
single-interrupt profile, not a general approval engine or an exactly-once
guarantee for arbitrary upstream side effects.

## Optional Frozen Result Profile

The supported result profile is `phase4.result.v1`, not a general LangChain file
API. Configure a separate marketplace application with the assistant ID advertised
by your service (`deep-agent` is an example, not a capability discriminator)
and enable **Result artifacts** in the instance form (`config.langchain.result_profile_enabled:
true`). Keep the provider URL at the service root. The authenticated capabilities
response must advertise that assistant, `/ag-ui/deep`, the profile, and both
`text/markdown` and `text/csv`. The server validates them before generation; it
does not accept an execution URL from the browser or silently fall back to `/ag-ui`.
Do not combine this profile with the native human-input setting.

The initial profile provides one frozen batch per thread: `report.md`, `data.csv`
and backend-provided source excerpts. Start a new conversation for another batch.
This limitation belongs to the selected result profile, not ordinary chat.
Disabling the switch pauses new generation and continuation for this application;
accepted work continues and existing results remain readable under current access
checks. It does not delete results or revoke previously downloaded copies.
Keep the optional field absent for ordinary applications. An explicit `false`
retains the selected profile and pauses its new tasks; both forms preserve that
value. Enabling the field alone never substitutes for a compatible capability
response, and unknown profiles or arbitrary execution paths are rejected.

The upstream owns immutable UTF-8 file bytes. The platform stores a validated
manifest in `backend_runs.deliverables` using the additive migration
`20261116100000_add_agent_run_deliverables.sql`. Apply it before running this code
using the normal migration procedure. On application rollback retain the column
and data; older code can ignore it. Do not run a destructive down migration.

Limits are 32 KiB per manifest, two known artifact IDs (`report`, `data`), 128 KiB
per artifact, and ten source excerpts of at most 2 KiB of UTF-8 text each. The
manifest limit applies to actual response bytes and the normalized PostgreSQL
JSONB text representation, including its separator spaces;
extra fields and whitespace do not bypass it. Artifact reads check media type,
length and SHA-256 against the registered manifest. A repeated identical manifest is
idempotent; a changed frozen manifest is rejected. Hashes establish byte integrity,
not factual correctness of Agent output.

The browser uses local run IDs and same-origin authenticated endpoints:

```http
GET /api/internal/apps/:appId/agent/runs/:runId/deliverables
GET /api/internal/apps/:appId/agent/runs/:runId/artifacts/:artifactId
```

These are product APIs, not AG-UI standard endpoints. The server derives the native
thread/run from trusted bindings; no upstream token, native ID or arbitrary URL is
accepted from the browser. Reading can register an already published manifest,
but never creates or resumes a task. Stored metadata remains available when the
upstream is offline; preview and download still require the upstream bytes.
Finding results for a locally unknown run does not reconcile execution, release
quota/concurrency reservations or unblock continuation/deletion. See
[operations](OPERATIONS.md#8-result-artifact-troubleshooting).
