---
layout: default
title: AG-UI
parent: Agent Integrations
nav_order: 3
---

# AG-UI Integration

## Implementation Status

The shared contract and pure conversion prototypes target **AG-UI 1.0**, using
`@ag-ui/core` **1.0.4** and its official schemas with Zod **4.6.7**. Protocol,
SDK, and upstream service versions are separate compatibility concerns.

LangChain and a bounded Dify chatbot path now support an explicitly negotiated
AG-UI event stream on the existing trusted product API. The shared agent chat
uses that stream for LangChain and explicitly opted-in Dify text-only chatbot
applications. LangChain requests without negotiation retain the legacy protocol;
the existing Dify proxy and its browser-managed persistence remain unchanged
for conversations that have not migrated.
Passing prototype or synthetic-service tests does not establish
support for all AG-UI events or for a standard AG-UI HTTP endpoint.

References:

- [Protocol specification](https://docs.ag-ui.com/spec/1.0/)
- [Official JSON Schema](https://docs.ag-ui.com/spec/1.0/schema.json)
- [SDK source](https://github.com/ag-ui-protocol/ag-ui)

## Shared Modules

`packages/shared/src/agui` contains a public event writer, schema validation, and
a bounded in-memory projection. It has no database, service credentials, or
backend transport dependencies.

The writer constructs an allowlisted output instead of forwarding upstream
objects. The official schemas validate structure; they do **not** redact secrets,
authorize resource access, or enforce event order. Do not forward arbitrary
schema-valid upstream `rawEvent`, metadata, tool arguments, or results to a client.

The projection implements the text, complete-message-snapshot, safe activity,
and run-lifecycle subset used by these prototypes. Message snapshots reconcile
the producer's complete collection by ID, updating existing messages in place,
appending new IDs, and dropping omitted ordinary messages. Client activity and
reasoning messages are retained unless the snapshot declares that role's complete
set. An activity snapshot with `replace: false` leaves an existing activity unchanged;
it does not merge content. Message collections are limited
to 256 entries and 512 KiB of encoded JSON. Unknown event types are ignored with
a warning after run start; malformed known events fail validation. Known events
outside this subset produce warnings, not an assertion of feature support.

The consumer accepts a late `RUN_ERROR` after `RUN_FINISHED`, retaining content
but correcting the execution outcome to failure. This exception is not used to
turn a separate persistence failure into an execution failure.

Structured message parts can be retained in snapshots, but these prototypes do
not add renderers, executable tools, state synchronization, or replay. Reading
an interrupt outcome is not a working human-input/resume implementation.

The writer receives the complete trusted **display history**, including safe
activities and public reasoning from earlier runs, not a page of history or the
filtered model input. Replacement snapshots preserve these earlier entries.
`agentModelInputMessages` derives the supported user/assistant text input without
forwarding activities or reasoning to the model. The writer and history readers
currently reject structured media, executable tool calls, encrypted artifacts,
and subagent attribution rather than silently dropping them; keep paths requiring
those features on their existing implementation. Unknown activities become inert
placeholders. A consumer can reopen a closed text message with the same ID and
matching speaker/owner, but cannot start an already-open ID.

## Execution and History Prototypes

`apps/api/src/lib/agui/adapter-prototype.ts` defines a common, disconnected
`describe` / `execute` / `queryRun` interface for both bridges. It accepts the same
trusted local context and validated `RunAgentInput`, checks their association,
and passes only the current user turn to an injected native transport. It does
not resend display history to a stateful backend. Transports and trusted native
bindings stay server-side; these fixtures do not implement authorization,
submission admission, model retries, or database writes.

Descriptions separate an upstream declaration (`true`, `false`, or absent) from
product availability. All prototype capabilities remain `enabled: false` with
`runtime-not-integrated`; successful fixture execution is not a user-facing
feature flag. Query results distinguish confirmed state and result completeness
from unsupported, rejected, and unknown outcomes. An unsupported or failed query
never invokes execution to find out what happened. The caller must still apply
the existing application/run authorization before a runtime adapter is enabled.

`readAgentHistoryResult` reads legacy unversioned/v1 results and the v2 public
projection, using trusted local thread/run IDs. Legacy tool summaries retain
their parent association separately; they do not invent an interleaved order
that was never saved. `mergeAgentHistoryPage` unions ordered pages by ID instead
of treating each page as a full conversation snapshot. Its caller supplies the
chronological page order and prepend/append direction.

`mergeAgentHistoryResult` prefers materialized user/assistant rows over result
copies, adds unsaved known output once, and retains result-owned activities in
their known positions. Local v2 result snapshots carry `outputMessageIds` for
the current execution segment, derived by the trusted projection from output
IDs absent from its initial display history; user inputs are excluded. This is
local persistence metadata, not an AG-UI event extension or an authorization
claim. The reader validates unique IDs, message membership, and output roles.
Only these outputs can be recovered or updated by that result, even while its
storage is pending or failed. Prior-run text and activities are not restored
from a later run's complete display snapshot.

Legacy v1 results contain only their own assistant outputs, so their scope can
be derived without changing stored data. Earlier v2 snapshots without scope
remain readable with `history-output-scope-unavailable`; the merge retains
loaded rows but does not guess which missing entries belong to the run. Runtime
integration must persist the trusted scope alongside the complete snapshot,
never obtain it from a browser as proof of message ownership.

Auxiliary entries following an unloaded saved message
are deferred until that page is available, then reconciled again in snapshot
order, rather than being placed before their missing predecessor. Saved result text absent from a loaded page is not
recreated from the result copy; load the corresponding message page. Persistence
status stays separate, and no reader executes actions or changes the immutable
result. These are bounded pure readers, not database migrations or active
history endpoints. Existing per-run text/message/tool budgets remain unchanged;
the complete-view bounds do not authorize increasing upstream execution limits.

## Negotiated Product Runtime

Authenticated product clients can POST to
`/api/internal/apps/:appId/agent/runs` with
`X-AgentifUI-Protocol: ag-ui/1.0`. The body remains
`{ submissionId, conversationId?, content }`; this is not a general AG-UI
`RunAgentInput` endpoint. Unknown protocol selections fail before admission.
Browser-supplied history, native identifiers, tools, and output scope are rejected.

The same session identity, application authorization, moderation, quota,
idempotent admission, native transport, and server-side persistence are reused.
The complete display history is loaded from the reserved local conversation up
to its current user message, restoring saved result-owned activities without
overwriting materialized text. Missing or oversized history prevents native
execution rather than silently substituting a page. Only the new user input is
sent to the stateful upstream thread.

Legacy tool-bearing history is not silently converted: if old message metadata
or v1 run results contain tool summaries whose interleaved order is unavailable,
the negotiated turn fails before native dispatch with
`AGENT_HISTORY_LEGACY_TOOLS_UNSUPPORTED` in its stored run status. Continue that
conversation through the legacy path; new AG-UI conversations and legacy
text-only history remain supported. The shared UI checks the authorized conversation
descriptor before submission and uses the legacy transport for old tool-bearing
LangChain conversations. This is a compatibility path using the same product
components and server writer, not a failed AG-UI request followed by regeneration.

The stream contains standard events only, starting with `RUN_STARTED` (or
`RUN_ERROR` if preparation fails), with local acceptance metadata. Tools are safe
activities, not executable client tools. It emits no legacy `accepted` or `status`
events. `RUN_FINISHED` confirms execution, not durable storage. Poll the existing
authorized run URL to inspect `executionStatus`, `persistenceStatus`, and the
allowlisted `agui` projection. A persistence failure cannot append another
terminal or regenerate an answer. Normal socket closure is not confirmation of
successful persistence, and a browser disconnect is not upstream cancellation.

A repeated negotiated submission returns HTTP 409 with
`code: AGENT_SUBMISSION_REPLAY` and its authorized public `run`, not a newly
started SSE run. An admission still in progress can instead return
`AGENT_SUBMISSION_IN_PROGRESS`; retain the same submission ID and do not create
a replacement task. Neither response dispatches the model again.

The existing result JSON retains its legacy assistant materialization fields
and adds the v2 snapshot at `agui`; no database migration is required for this
LangChain slice. Only snapshot-owned assistant outputs are materialized, using
the same IDs. Activities remain ordered in the snapshot; tool-only runs do not
create empty assistant placeholders. Saved projections are also available in
authorized conversation/run reads. The existing bounded history response is not
an unbounded archive export or resumable event log.

Before publishing new output, the runtime previews the projection and checks
the final serialized storage budget, including the duplicate materialized
assistant text and JSON escaping, with room for an error terminal. Over-budget
output is not published; the known partial projection is retained with an
unconfirmed execution outcome. History that cannot fit is refused before native
dispatch. If an unexpected result still cannot be normalized, storage failure
can be recorded independently with `AGENT_RESULT_UNAVAILABLE`; that record does
not claim a recoverable snapshot exists. A known unknown outcome must be checked,
not automatically regenerated.

### Dify Chatbot Scope

The same product route also accepts authorized Dify applications, but only with
explicit `ag-ui/1.0` negotiation. Creating a Dify conversation additionally requires
the administrator to select `config.interaction_protocol: "ag-ui/1.0"` on a
marketplace chatbot application (`app_metadata.app_type: "marketplace"`,
`app_metadata.dify_apptype: "chatbot"`). Default-model chat and other Dify modes
retain their existing paths. This opt-in controls new conversations only: existing trusted bindings
continue on their server-managed path even if it is later disabled. Existing
unbound Dify conversations do not import client-declared native identifiers or
change writers when their application opts in. The server selects the backend from application
configuration, not a browser profile. `agui/runtime.ts` selects the bounded
production implementation; the disconnected adapter prototype remains a fixture.
The descriptor reports the negotiated path's capabilities and server persistence,
not a global change to Dify's legacy proxy capabilities. Dify native run query,
stop, files, tools, workflow execution and human responses are not enabled here.

Before each Dify generation, the server calls `/info` with the resolved application
credential and requires `mode: chat`, then checks `/parameters` for an understood
input form and required values satisfiable by trusted inputs or native defaults.
Local application labels are not proof of
native mode. Unexpected agent/workflow/media events still fail the bounded path;
there is no automatic profile switch, legacy fallback, or second generation.
Applications requiring custom variables or attachments must use the existing
path. Optional native file, citation, and speech settings do not enable those
features in the explicitly selected text-only interaction: the admin opt-in and
chat page disclose this limitation, and the public descriptor advertises only
implemented capabilities. Leave applications needing those features on their
existing path; this is not a full-mode migration or a native configuration change.
The negotiated request body does not accept `inputs` or native identifiers.
Trusted profile inputs and the native `user` are built server-side; moderation
covers both the current query and those inputs.

Migration `20261114180000_allow_trusted_dify_conversations.sql` extends only the
binding backend-type constraint. Existing LangChain defaults, ownership, RLS,
foreign keys and immutable bindings remain in place. New Dify conversations are
explicitly tagged; legacy browser-declared `external_id` values are never imported
as trusted bindings. Continuation requires an owned binding to the same current
application target. Native conversation/message/task identities are checked before
publishing output and remain private; chatbot `message_id`, not `task_id`, is the
native run reference. This does not provide a native status-query operation.

The coordinator sends only the current query and bound native conversation to
Dify. Valid message completion followed by normal stream EOF is needed for success;
truncation, identity changes, unsupported native events and ambiguous HTTP failures
remain unknown. Complete replacements, including empty text, preserve prior local
display history. The text budget remains 64 KiB, SSE frames are bounded to 256 KiB,
the response to 2 MiB and consumption to 150 seconds. `[DONE]` and an unterminated
data frame are not substitutes for validated completion and EOF. There is no
automatic POST retry, cancellation, or resumable stream.

The negotiated path is the only writer of its bound local messages. Generic
client message writes to bound conversations are rejected; legacy unbound Dify
history still uses its existing writer. Active runs linked to a Dify submission
count once, while unbound legacy Dify admissions still consume capacity. Status
reads retry only a known immutable result's materialization, never Dify generation;
an unknown native execution cannot be resolved by pretending the local status is
native confirmation. Disconnecting the browser does not cancel server saving.

This remains a partial runtime migration, not a claim of support for every Dify
mode or native capability. Do not enable human response, stream replay, or crash
recovery merely because the schemas can represent them.

### Human Input Product Boundary

Human input is enabled only for explicitly configured LangChain applications
using the native profile in [LangChain Integration](LANGCHAIN-INTEGRATION.md#optional-native-human-input).
Dify human input and arbitrary AG-UI resume requests remain unsupported. The
trusted product API maps native interrupts into a standard `RUN_FINISHED`
interrupt outcome with a **local** interaction ID and controlled response schema.
The execution segment closes while the task remains waiting.

`GET /api/internal/apps/:appId/agent/conversations/:conversationId/interactions`
returns `{ interactions }`. Each item includes `id`, `originRunId`, `status`,
`title`, `description`, `actions`, `commentMaxLength`, `expiresAt`, and, when
available, `decision` and `resumeRunId`. All exposed identifiers are local.
Native interrupt/thread/checkpoint identifiers and credentials remain private.
Statuses are `pending`, `submitting`, `accepted`, `expired` and `unknown`;
accepted means the decision is recorded, not that the resumed execution succeeded.

The explicit response endpoint is
`POST /api/internal/apps/:appId/agent/interactions/:interactionId/respond` with
`{ submissionId, action: "approve" | "reject", comment? }`. It returns HTTP 202
with `{ run, replayed }`. Repeating the same submission and normalized content
returns the same resume run without another dispatch; competing or changed
responses conflict. A resume run has `runKind: "resume"` and `rootRunId`, and no
new ordinary user message. This endpoint is a product authorization boundary,
not a public native command proxy or general `RunAgentInput` endpoint.

Read the returned run and conversation to confirm execution and saving.
`executionStatus: "waiting"` with `persistenceStatus: "saved"` means the pending
interaction was saved; it does not mean the task completed. A pending interaction
blocks new questions and deletion on that conversation. Completed decisions and
results remain visible after refresh and through the common history entry.

If a response is lost, query the interaction and run with bounded backoff. Do not
resend a decision merely because its acceptance is unknown or the native run
reports success. Query paths reconcile known native state but never dispatch a
replacement task. The initial task is charged once under the existing submission
ledger, while resume competes for execution capacity again. Application access,
current ownership, moderation, expiry and the saved allowed actions are checked
on the server. A null expiry is not an invented automatic timeout; expired or
unresolved tasks are not silently approved, abandoned or rerun.

Resume preparation reserves capacity before native preflight. A final database
CAS checks current authorization and expiry before permitting dispatch. A
preparation attempt proven not to have crossed that persistent fence can be
saved as `error` with `AGENT_RESUME_NOT_DISPATCHED`, returning its interaction
to pending (or expired). The failed run remains in history. The same submission
still returns that failed attempt; a new explicit user response uses a new
submission ID. Once the persistent fence has been crossed, missing responses
or a failed lookup are not proof of non-dispatch and never reopen the form.
This boundary does not claim an atomic transaction spanning SQL and HTTP.

This slice adds a small RLS-protected interaction table and run-kind/root fields.
Existing turn rows retain their user message and become their own root; resume
rows cannot masquerade as ordinary turns. Additive schema is retained on rollback.
Resolve outstanding human-input tasks before reverting to an implementation that
cannot display or resume them. Do not assume an old client understands waiting
tasks, or use a destructive down migration to clear them.

## Shared Product Chat

`/apps/agent-chat/:appId` uses the database application UUID. The existing
`/apps/langchain/:appId` remains a compatible alias to the same component and
controller. Both backends render through the existing product input and message
components, with the shared canonical event projection rather than separate native
stream parsers. The browser never saves messages for this server-managed path.

The first `RUN_STARTED` must match the retained submission and selected local
conversation. Its acceptance metadata reconciles the optimistic user message.
Each event advances one projection outside React state updater callbacks; the UI
receives immutable snapshots. Execution completion and durable save status remain
separate. A missing terminal remains unknown, and status polling only queries or
retries materialization. If the response is lost before acceptance, the client
queries the retained submission ID and its authorized run instead of submitting
another generation.

The browser's loaded history can be a page of the producer's complete history.
When a replacement snapshot introduces older unloaded entries, current output
ownership stays after the trusted accepted user-message boundary; those historical
entries are not relabeled as outputs of the current run or appended to the loaded
page. This boundary is read from the incoming snapshot before reconciliation
preserves existing display order. A replacement losing
that boundary is rejected rather than guessing association. Durable output scope
is still assigned exclusively by the server's complete-history projection.

Authorized conversation lists and lookup responses derive `interaction_protocol`
from an actual trusted binding, not writable conversation metadata or the current
application opt-in. Sidebar, history, and direct conversation links select one
controller before mounting it. Existing unbound Dify routes keep their original
consumer and browser writer; no request is consumed or saved by both paths.

Conversation detail returns the latest chronological page, up to 100 messages.
Pass `before=<nextCursor>` for earlier pages, which are prepended and deduplicated
by local message ID. Relevant v2 results restore only their own output activities
and unsaved known output; materialized saved text takes precedence. A result does
not recreate saved messages outside the loaded page. This display pagination does
not relax the bounded complete history required before negotiated execution.

## Conversion Boundaries

| Input                                                            | Output and restrictions                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Trusted local acceptance                                         | `RUN_STARTED` with local thread/run IDs and versioned acceptance metadata; no private event before the standard start |
| Text fragments                                                   | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, and `TEXT_MESSAGE_END`, preserving local assistant IDs                  |
| Complete or replacement text                                     | Complete `MESSAGES_SNAPSHOT`, including earlier messages and activities; shorter and empty replacements are valid     |
| Sanitized tool summaries                                         | `ACTIVITY_SNAPSHOT` with `agentifui.tool-summary.v1`; not fabricated executable tool arguments or results             |
| Confirmed execution success/cancellation                         | `RUN_FINISHED` with the corresponding outcome                                                                         |
| Failure, partial results, unsupported pause, or missing terminal | Safe `RUN_ERROR`; incomplete streams remain unknown rather than successful                                            |

`apps/api/src/lib/agui/dify-prototype.ts` accepts an explicit native chatbot or
agent-chat profile. It is not a generic replacement for all Dify modes. Workflow
termination must be distinguished from message completion; unrecognized modes
and unverified partial/pause semantics must not be silently upgraded to success.

`apps/api/src/lib/agui/langchain-prototype.ts` consumes the existing trusted
`AgentClientEvent` stream, not arbitrary native LangGraph events. Native tool IDs
are translated into local activity IDs. Its read-only `persistenceStatus` remains
separate from protocol execution outcome: a successful run with failed storage
is not a failed model execution. Later storage updates do not emit events after
the standard terminal event.

Both prototypes are single-run objects. Neither accepts browser-supplied native
identifiers as authorization nor resubmits a model request after an unknown result.

## Runtime Integration Requirements

Before enabling a path, integrate it through the existing trusted API layer:

1. Resolve authorized application configuration and retain native identifiers
   server-side; preserve access, moderation, quota, and submission-idempotency
   checks.
2. Choose one event consumer and one message writer per path. Keep existing
   histories readable and avoid double rendering or duplicate persistence.
3. Preserve backend memory semantics. Stateful native threads must not receive
   the entire local display history as repeated user input.
4. Migrate a representative path from each backend with real-service tests, then
   enable the shared projection in the existing product components. Keep other
   modes on their existing paths until their capabilities are verified.
5. Require a genuine upstream interrupt and supported response/resume operation
   before exposing human-input actions. Synthetic fixtures alone are insufficient.

### Adding A Production Backend

Implementing `AgentExecutionPrototype` or adding a capability flag does not
register a production backend. Use Dify and LangChain as concrete examples and
update these existing integration points together:

1. Add the verified type and capabilities in
   `apps/api/src/lib/agent-backends.ts`, with the corresponding application
   configuration validation and administration controls. Preserve rejection of
   unsupported types; do not let a new backend fall through to LangChain.
2. Extend trusted configuration resolution in `apps/api/src/lib/agent-app.ts`.
   Resolve credentials, native targets and ownership on the server, and include
   the target identity in the existing submission and binding checks.
3. Implement the native adapter and explicitly select its description and
   execution in `apps/api/src/lib/agui/runtime.ts`. Connect required query and
   save coordination through the trusted run API; keep one history writer and
   never query by issuing another generation. Optional actions require their
   own verified implementation, not only a descriptor flag.
4. Review persisted backend-type constraints and shared/API types. For example,
   `database/migrations/20261114180000_allow_trusted_dify_conversations.sql`
   permits only the existing two binding types. Add a new forward migration
   where required; never edit an already applied migration. Test old bindings,
   strict RLS and concurrent admission before applying it to an installation.
5. Feed the existing shared chat controller and canonical history projection.
   Extend a renderer only for a genuinely new interaction, rather than copying
   the backend's own chat page. Declare unsupported operations explicitly.

Use `__tests__/agui` and `apps/api/src/lib/agui/adapter-prototype.test.ts` for
the common contract, and `__tests__/db/dify-agui-integration.test.ts` and
`__tests__/db/human-input-integration.test.ts` as database integration examples.
Add the new backend's transport, authorization, replay and sole-writer tests,
then verify real streaming, refresh/history and the actions actually exposed.
Existing backend acceptance is a regression baseline, not proof that the new
backend supports the same capabilities.

For focused verification, build the shared package before API tests:

```sh
pnpm build:shared
pnpm exec jest --runInBand __tests__/agui apps/api/src/lib/agui
pnpm --filter @agentifui/shared type-check
pnpm --filter @agentifui/api type-check
```

Normal application regression and production-build checks still apply before a
candidate is delivered. No additional service, gateway, or deployment stack is
required by the pure prototypes.

## Result Delivery Boundary

Frozen result delivery extends the existing shared conversation, run and history
interface; it does not add file bytes to AG-UI messages, model history or the
event projection. `phase4.result.v1` is the supported upstream profile. The
versioned public manifest (`schemaVersion: 1`) and authenticated deliverable and
artifact GET routes are AgentifUI product APIs, not additional AG-UI event types.
The shared product DTO lives in `packages/shared/src/agent-results.ts`; the native
profile is not a field of that DTO. API and Web consume the same definition, and
only the adapter restricts the initial profile to `report` and `data` IDs.
See the [service contract](LANGCHAIN-INTEGRATION.md#optional-frozen-result-profile).

The public view uses local app/conversation/run IDs. Native thread/run IDs remain
server-side. A lightweight history index merges results by local run ID across
pagination and live updates; file previews use a separate authenticated loader,
not the legacy Dify byte cache. Existing Dify files/references remain on their
original path and do not automatically gain the new profile.
Their source presentation reuses the neutral result-source view while retaining
Dify dataset and relevance metadata. The shared preview shell preserves a
non-modal desktop side panel and a modal mobile drawer.

Result discovery only registers immutable metadata. It must not repair execution
or message-saving state, release occupancy, resume a graph or regenerate output.
An upstream-ready result with a locally unknown run remains an unknown run with
readable results. Activity resumption, event replay and execution recovery are not
promised by this result interface.
