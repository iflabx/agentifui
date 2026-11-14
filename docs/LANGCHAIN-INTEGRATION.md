# LangChain Agent Integration

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
idempotency gate described in [Agent Governance](AGENT-GOVERNANCE.md). This does
not implement AG-UI replay, human input or resume.

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
only validated tool names and execution status. Files, human-in-the-loop input,
frontend tools, arbitrary state synchronization, resumable streams and execution
cancellation are not supported. Do not enable corresponding UI capabilities
merely because the upstream schema advertises additional endpoints.

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
- Disable the new application/provider to stop new use without changing Dify.
  Additive tables remain during rollback; do not run destructive down migrations.

The HTTPS gateway must pass authenticated requests and SSE without buffering or
automatic upstream retries. Its timeout must accommodate the service runtime
and API stream deadline. Every API replica needs the same database access,
encryption configuration and upstream reachability. Validate fresh installation,
incremental migration and multiple replicas with isolated data before rollout.
