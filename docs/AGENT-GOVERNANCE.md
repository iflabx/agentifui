# Generation Governance

The Fastify API shares backend selection, input moderation, quota reservation
and submission identity across Dify and LangChain. Only a missing backend type
defaults to Dify; explicitly unsupported types are rejected. Public capabilities
come from the implemented backend registry, not arbitrary configuration claims.
This boundary does not implement AG-UI resume, human input, token billing or a
general policy platform.

## Deployment And Request Contract

Apply `20261113150000_add_backend_conversation_runs.sql` before
`20261114160000_add_agent_submission_governance.sql`, using the normal migration
process. The latter is required for both backends, including Dify-only use.
Deploy API and browser changes together; already cached pages must refresh.
Missing governance storage fails closed with 503 rather than invoking upstream.
Do not apply migrations without an isolated PostgreSQL upgrade/RLS/concurrency
check and the deployment's database approval.

- Dify generation requires `x-agentifui-submission-id: <UUID>`. The five browser
  chat/workflow/completion helpers supply it without changing request payloads.
  Their final optional `{ submissionId }` argument supports an explicit replay.
- LangChain continues to accept the existing body `submissionId` UUID.
- A LangChain replay while registration has no run binding returns 409
  `AGENT_SUBMISSION_IN_PROGRESS`; it never starts another execution. Once bound,
  an explicit replay with identical input returns the existing run and local
  conversation, including its current or saved result. Do not automatically
  resend a generation request after an ambiguous response.
- New question: new UUID. Same operation/network replay: same UUID and input.
  Never automatically resend after an ambiguous failure. Reusing an ID with
  different input or target returns 409 without calling the service.
- `x-agentifui-root-task-id` identifies the common task. For Dify, a repeated
  submission returns 409, not a reconstructed stream. Query
  `GET /api/internal/apps/:appId/submissions/:submissionId` using the canonical
  local application UUID and the same signed-in actor. It returns task/quota
  state, local run ID and a safe error code, never the submitted text or keys.
- Dify native `user` remains bound to the session actor. Its local conversation
  and messages are still saved by the browser after streaming. LangChain keeps
  its existing server-side history and save-only retry path.

## Existing Policy, Now Enforced Before Dispatch

No new administrator exemption is introduced. Public applications and private
applications available to administrators do not consume group quota, as in the
existing SQL. For group-only applications, use the first enabled membership
permission ordered by `created_at, id`, including for administrators. An
administrator without group membership may see the application under the old
visibility rule but cannot generate under its existing group-quota rule. Do not
fall through to another group when that first group's quota is exhausted.
Unlimited group permissions still record usage. These are the existing
`check_user_app_permission` / `increment_app_usage` semantics, not new grants.

Input moderation retains the previous configuration behavior: disabled or
missing configuration skips moderation; configured service failure or an
unparseable result rejects with 503, unsafe input with 400. Both backends and
workflow generation aliases pass through this gate. Platform rejection consumes
no usage. Client-driven `groups.incrementAppUsage` now returns 409; only the
server acceptance path increments usage, preventing duplicate client charging.

## Task State And Counting

| State      | Quota                                | Computing slot / replay                     |
| ---------- | ------------------------------------ | ------------------------------------------- |
| registered | none                                 | No slot; moderation/validation not finished |
| admitted   | reserved for group, otherwise exempt | Slot held; one dispatch claim               |
| submitting | unchanged                            | Slot held; native acceptance not yet proven |
| accepted   | counted once for group               | Slot held until native terminal evidence    |
| finished   | counted/exempt                       | Slot released; saving is independent        |
| rejected   | none/released/exempt                 | No slot; never dispatch this ID again       |
| unknown    | reserved or already counted          | Slot retained; never auto-release/resend    |

Admission locks the user and app across replicas, rechecks active identity,
current visibility/backend/target and group quota, and reserves atomically.
`used_count + pending reservations` must stay within a finite quota. Confirmation
increments `used_count` once, atomically with marking the task counted. Existing
active LangChain runs and active Dify tasks share computing limits without
counting a LangChain task twice. Existing per-user/per-app admission settings
apply to both. Saving/retrying history never constitutes a second generation.

Native task/message/workflow identifiers prove acceptance, not HTTP 200 alone.
Native completion or an accepted SSE `error` ends execution, including failures.
Known pre-acceptance HTTP 400/401/403/404/405/413/415/422 releases reservation.
An identified native refusal inside a successful blocking response also releases
it; bare `error`/`code` fields do not prove rejection. HTTP 429/5xx, broken streams,
paused workflows and uncertain dispatch stay unknown unless stronger native
evidence exists. This P2 path does not reconcile unknown tasks automatically;
operational resolution requires verifying native execution, never blind retry.

LangChain setup failures before the generation dispatch boundary are terminal
errors and release both the governance reservation and the run's computing
slot. Creating an empty native thread is not evidence that generation started.
When replay attaches governance to a pre-upgrade active LangChain run, its
existing native execution remains the only execution. A terminal write from
the older API also finishes that legacy association without charging historical
usage again.

Only undispatched `registered` records expire opportunistically on a later
registration after 15 minutes; a user can have at most eight such pending
registrations. There is no background cleanup or timeout release of unknown.
Rejected records remain queryable and the same ID remains non-executable.

## Storage And Extension Boundary

`agent_submissions.root_task_id` is the single P2 quota/idempotency identity;
nullable `run_id` links LangChain execution. Dify does not need local messages
or `backend_runs` before invoking the native service. P2 does not add
`root_run_id`, `run_kind` or interaction tables: a future common-run migration
must preserve/backfill this task identity rather than introduce another ledger.

Deleting a resolved quota permission nulls its historical task association;
counted history does not permanently block revocation or group deletion.
Unconfirmed reserved quota cannot lose its permission row. Active/unknown task
deletion and target identity changes are guarded in the database; ordinary
display edits and provider disabling remain available. User/app historical
deletion keeps existing cascade behavior where other existing constraints allow
it. The scoped trigger system context sees system-only tasks under strict RLS;
it does not relax application-visible RLS policies.

Reserved permission deletion is rejected before foreign-key updates can wait
on task confirmation. Target configuration edits use nonblocking admission-lock
checks and reject competing edits as busy rather than reversing the admission
lock order. Retry the administrative edit only after the active operation has
been verified; this is not authorization to resend a generation request.

Before deployment, test the migration with an application role without
SUPERUSER/BYPASSRLS: counted permission deletion, reserved deletion/reset
rejection, active deletion protection, display/config changes, RLS isolation,
two-client last-quota admission, acceptance replay, and failed-save replay.
Unit tests with fake PostgreSQL clients do not establish these DB properties.

## Adding Another Backend

The current registry supports Dify and LangChain only. A future integration
must add an implemented backend, not an unknown type that falls back to Dify.
Use the existing integrations as examples, without copying an entire chat UI
or adding another authentication or quota system:

1. Extend `apps/api/src/lib/agent-backends.ts` and application configuration
   validation with the backend's verified capabilities and persistence owner.
   Resolve credentials and application access on the server; never accept an
   arbitrary endpoint, native user or credential from a generation request.
2. Reuse moderation, submission registration and atomic admission. Define the
   target fingerprint, native acceptance and terminal evidence, uncertain
   dispatch handling and replay contract before enabling generation.
3. Keep native threads, conversations, runs and control requests inside the
   adapter. Bind them to the current actor and local application/conversation;
   do not treat a vendor ID or thread memory as local history authorization.
4. Feed the shared `ChatInputView`, `UserMessage` and `AssistantMessage` through
   a thin controller. Keep global history as the entry point, designate exactly
   one history writer, and show only actions the integration actually supports.
   The current private stream events are not a replacement for the planned
   common AG-UI interaction contract.
5. Add transport/contract tests, strict-role PostgreSQL ownership, quota and
   cross-instance replay tests, then real two-turn streaming, refresh/history,
   navigation and failure acceptance. An existing integration's success does
   not establish another backend's support for files, cancellation, human input
   or stream resumption.
