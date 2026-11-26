---
layout: default
title: Compatibility and Capabilities
parent: Getting Started
nav_order: 1
---

# Compatibility And Capability Reference

This is a summary of the **current source**, not a promise that every feature is
in every published release. Check the installed tag and its documentation.
Supported below means an implemented path subject to its documented configuration
and permissions, not a new real-service acceptance result from this document.

Three different things must agree: the upstream service supports a feature,
AgentifUI implements it for this path, and the particular application/deployment
enables it. A provider name, form option or schema-valid event establishes none
of the other two by itself.

## 1. Application Paths And History Ownership

| Path                                               | User entry point                           | Interaction                                      | Persistence boundary                                                                                   |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Dify model entry                                   | Regular chat's model selector              | Existing compatible Dify chat path               | Browser-managed local conversation/message saving                                                      |
| Dify marketplace chatbot, legacy Agent or chatflow | `/apps`                                    | Existing compatible app-specific chat            | Browser-managed local conversation/message saving                                                      |
| Dify workflow                                      | `/apps`                                    | Structured inputs and independent chat rounds    | Local conversation groups execution records; no upstream chat memory                                   |
| Dify text generation                               | `/apps`                                    | Form input and independent chat rounds           | Local conversation groups execution records; no upstream chat memory                                   |
| Opted-in Dify marketplace chatbot                  | `/apps`, shared chat                       | Negotiated AG-UI, compatible fields and uploads  | Server-managed conversation/run saving; existing unmigrated conversations retain their compatible path |
| Ordinary compatible LangChain Agent                | `/apps`, shared chat                       | Text chat with safe supported activity summaries | Server-managed conversation/run saving; legacy product stream and negotiated AG-UI compatibility       |
| LangChain input-file profile                       | Separate explicitly configured application | Supported document inputs and tool summaries     | Server-managed messages and file references; file bytes remain upstream                                |
| LangChain native human-input profile               | Separate explicitly configured application | One task and one approve/reject interruption     | Server-managed run, pending interaction, decision and result state                                     |
| LangChain frozen-result profile                    | Separate explicitly configured application | Report/CSV preview, download and source excerpts | Server-managed history/immutable manifest; frozen bytes remain at the upstream                         |

The shared Dify opt-in is for eligible marketplace **chatbots**, not model entries,
chatflows or workflows. Supported fields and uploads depend on the chatbot's
effective capabilities. It is not a
bulk migration of all Dify history. Each conversation has one persistence owner;
do not enable both browser and server writers to make an integration work.

## 2. Capability Matrix

The optional [frozen-result profile](LANGCHAIN-INTEGRATION.md#optional-frozen-result-profile)
is separate from ordinary LangChain and human input in the table below. It supports
one published report/CSV batch per thread, not general uploads, arbitrary files,
an offline file archive or execution recovery. Pausing generation retains authorized
history reads; preview/download still depend on upstream retention and availability.

**Conditional** means a documented application/mode/permission-dependent path,
not universal support. **No** means this path does not currently implement the
feature; enabling it upstream does not make it appear in AgentifUI.

| Capability                              | Existing Dify paths                                                      | Shared Dify AG-UI chatbot               | Ordinary LangChain                         | LangChain human input                               |
| --------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Streaming text                          | Conditional on mode                                                      | Supported                               | Supported                                  | Supported during task/resume                        |
| Multi-turn chat                         | Conversational modes and configured turn policy                          | Conditional on turn policy              | Conditional on turn policy                 | No; new task requires new conversation              |
| Reopen saved chat                       | Conversations and grouped task rounds; legacy task links remain readable | Supported                               | Supported                                  | Supported, including saved decision state           |
| Structured input and file upload        | Conditional on app/mode and limits                                       | Compatible fields and local file slots  | Only with the supported input-file profile | No arbitrary forms/files                            |
| Tool activity                           | Mode-specific displays, not one shared tool contract                     | No                                      | Validated names/status summaries           | Supported safe summaries, not raw arguments/results |
| Approve/reject pause                    | No supported Dify human-input profile                                    | No                                      | No                                         | Explicit native-profile opt-in                      |
| Native stop/cancellation                | Path-specific; some actions are administrator-only                       | No                                      | No                                         | No general execution cancellation                   |
| Native run-status query                 | Path-specific follow-up APIs and access restrictions                     | No native run-query capability          | Supported service contract                 | Native run/state/list reconciliation                |
| Edit/regenerate/feedback                | Only where the UI path wires the corresponding action                    | Not inherited from legacy Dify controls | Not inherited from legacy Dify controls    | Not a second decision or regeneration mechanism     |
| General durable stream/crash recovery   | Not promised                                                             | No                                      | No                                         | No                                                  |
| General managed file-artifact lifecycle | Not promised by file upload or text export                               | No                                      | No                                         | No                                                  |

Native run queries differ from authorized **local** run/save lookup. A Dify
AG-UI app can retain local saved-result state without implementing a native run
query. Save-only recovery persists an exact known result when available; it is
not another model call, upstream replay or proof of process-crash recovery.

Stopping the browser stream, closing the page and confirmed upstream cancellation
are different operations. Likewise, an execution completing is not proof its
messages were saved. Preserve unknown-outcome handling instead of adding blind
generation/resume retries.

### Execution Process Presentation

Dify workflow/chatflow steps and LangChain tool activities share process rows,
controlled state labels and a completed-activity count. This is presentation reuse,
not a new common backend event or persistence contract. It does not add Dify node
projection to the negotiated AG-UI chatbot path or imply a known task-completion
percentage. Existing workflow/chatflow iteration, loop and parallel details remain
available when the upstream supplies them.

LangChain process details are grouped by local run and preserve the original
message/tool anchors; older unordered records are labeled as summaries. Workflow
execution history can show saved node summaries, including the existing failure
snapshot formats. These summaries are read-only, not a complete nested execution
replay; unfinished snapshot nodes have unknown outcomes rather than live timers.
New native Workflow task rounds also retain their own captured iteration/loop
and parallel process hierarchy when available. The common chat UI groups these
independent executions locally; it does not add upstream conversational memory.
If a request was dispatched but no trustworthy terminal result is available,
the task is shown as unknown/interrupted, not automatically rerun. Recovering its
inputs and submitting a new run are separate user actions; recovery does not
cancel a possibly still-running upstream task.
Chatflow process tracking remains transient and is not reconstructed after refresh.
Missing snapshots show no process record, never another live task's steps.

## 3. Versions And Service Contracts

| Component           | Current target/reference                                                                                          | What is not implied                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| AgentifUI           | The selected source tag/full commit and matching documentation                                                    | A feature on `main` is not automatically in the latest release                                     |
| Dify Service API    | Compatibility work targets `1.19.0`; see [Dify integration](DIFY-INTEGRATION.md)                                  | Every Dify feature or every later version is not automatically supported                           |
| LangChain service   | [Required endpoints/events](LANGCHAIN-INTEGRATION.md#required-service-contract) and configured assistant identity | No universal compatibility claim for a LangChain/LangGraph library version or arbitrary deployment |
| Human-input service | Separate [native profile](LANGCHAIN-INTEGRATION.md#optional-native-human-input) and capability advertisement      | A generic resume endpoint does not implement the required single-interrupt contract                |
| AG-UI               | Bounded AG-UI `1.0` contract; pinned `@ag-ui/core` `1.0.4` in the shared package                                  | Not all events, state synchronization, frontend tools or standard AG-UI HTTP endpoint support      |
| Source toolchain    | Node `24.22.2`, pnpm `10.34.9`; authoritative pins in `.nvmrc` and `package.json`                                 | Host Node is not required for the source-build Docker installer                                    |
| PostgreSQL          | Current deployment/CI compatibility target `18.6` with all applicable migrations and runtime grants               | Other majors or unmigrated schemas are not certified by a successful connection                    |
| Redis and storage   | Optional Compose Redis `7.4` and pinned-source MinIO; compatible external Redis/S3 services per runbook           | No support guarantee for every service/provider, object-store release or configuration             |

The exact dependency graph is in `package.json`, workspace manifests and
`pnpm-lock.yaml`, not a separately maintained list of every library version.
Do not substitute a mutable upstream documentation page for a version-specific
contract or treat these targets as measured minimum hardware requirements.

## 4. Authentication And Deployment Boundaries

| Mechanism            | Current setup                                                              | Important distinction                                                                    |
| -------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Email/password       | Better Auth server runtime, optional signup/verification/reset email flows | Disabling authentication email does not disable existing password sign-in                |
| GitHub               | Private OAuth App client ID/secret plus rebuilt public button flag         | Repository access credentials are unrelated; matching callback authorization is required |
| Database-managed CAS | Enabled CAS provider record and matching identity-provider authorization   | A saved record/button does not prove the origin is authorized                            |
| OIDC / generic OAuth | Supported Better Auth private runtime provider configuration               | Not automatically enabled by an arbitrary database SSO editor choice                     |
| SAML editor choice   | May appear in provider configuration UI                                    | Not evidence of a supported end-to-end database-managed SAML login path                  |
| Phone OTP            | Runtime flag and a configured supported delivery mechanism                 | Code defaults and Compose defaults differ; `dev-log` is not real SMS delivery            |

Use [configuration](CONFIGURATION.md#better-auth-and-sso), not table names or
editor options, as the operational setup reference. User identity linking is
restricted; an email match is not permission to merge accounts across providers.

Docker Compose and host/PM2 are supported application installation paths, with
optional manual Docker capacity as a separate topology. The same source can
produce different environment-specific Web builds because public origin,
branding and interface translation inputs are compiled. Stage acceptance of a
PM2 build is not proof of an untested Docker image, and container health is not
proof of real Agent, mail or SSO acceptance.

## 5. Choose Documentation And Plan An Upgrade

1. Identify the installed tag/full commit and actual build/image. Read the
   [release notes](https://github.com/iflabx/agentifui/releases) from that version
   through the target version, not just the last commit's diff.
2. Read the target tag's runbook and integration requirements. If a feature is
   documented only on a newer branch, treat it as unavailable on the older tag
   until a release or specifically validated candidate includes it.
3. Review pending SQL, runtime grants, environment/build changes, backend contract
   changes and persistent content. Current generation/human-input storage needs
   migrations even when using only one backend. Keep API/browser versions aligned.
4. Back up according to [operations](OPERATIONS.md#6-backups-and-recovery), prepare
   a separate release and follow [Docker upgrades](DOCKER.md#5-upgrade-and-rollback)
   or [host deployment](QUICK-DEPLOYMENT.md#6-deploy). Never replay fresh database
   initialization or discard volumes as an upgrade technique.
5. Check affected workflows and record what passed, failed or was not tested.
   Reconcile pending human interactions before code rollback to a version unable
   to display/resume them; keeping additive SQL is not equivalent to restoring data.

The project uses GitHub Releases for published change notes; this document is not
a second release log or a promise of an LTS/older-version backport schedule.
General DSH integration, arbitrary human-input forms, A2UI/MCP Apps and universal
crash recovery are not current capabilities of these documented paths.
