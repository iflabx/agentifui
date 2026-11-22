---
layout: default
title: Database Design
parent: Development
nav_order: 2
---

# AgentifUI Database Design

## Scope

This document summarizes the current PostgreSQL schema used by AgentifUI as of November 15, 2026, including multi-backend conversation runs, generation governance and native human input.

The source of truth is the SQL migration set under `database/migrations/`. This document intentionally describes the current schema shape and operating model rather than copying every column from every table.

## Current Migration Set

The repository currently bootstraps and evolves the schema with these public SQL migrations:

- `20260214010100_add_missing_rpc_functions.sql`
- `20260214020100_create_local_pg_baseline_schema.sql`
- `20260214061000_add_external_identity_profile_tables.sql`
- `20260214133000_enforce_single_idp_binding.sql`
- `20260214153000_create_better_auth_tables.sql`
- `20260214161000_add_local_login_policy_controls.sql`
- `20260214192000_add_better_auth_phone_fields.sql`
- `20260214201000_add_fallback_password_profile_metadata.sql`
- `20260215030000_m4_rpc_rls_guc_hardening.sql`
- `20260215050000_m4_table_rls_phase2.sql`
- `20260215070000_m4_table_rls_phase3.sql`
- `20260215080000_m4_rls_strict_mode_switch.sql`
- `20260215170000_m6_realtime_outbox_cdc.sql`
- `20260216012000_create_migration_sync_checkpoints.sql`
- `20260216023000_preserve_explicit_updated_at_in_trigger.sql`
- `20260217153000_add_error_events_table.sql`
- `20261110113000_create_better_auth_sso_providers.sql`
- `20261113150000_add_backend_conversation_runs.sql`
- `20261114160000_add_agent_submission_governance.sql`
- `20261114170000_protect_pending_agent_credentials_and_quota.sql`
- `20261114180000_allow_trusted_dify_conversations.sql`
- `20261115090000_add_agent_human_input.sql`
- `20261115100000_add_agent_resume_dispatch_fence.sql`

This is a schema inventory, not an instruction to replay initialization SQL on
an existing database. Apply only reviewed pending migrations during upgrades;
see [deployment](QUICK-DEPLOYMENT.md#6-deploy) or
[Docker upgrades](DOCKER.md#5-upgrade-and-rollback).

## Key Design Facts

- The project no longer relies on Supabase-managed auth tables such as `auth.users`.
- Auth persistence lives in local PostgreSQL tables created for better-auth.
- Business data, auth data, external identity data, and operational telemetry are stored in separate table groups.
- RLS is part of the current design, not a future plan.
- Redis and MinIO are important runtime dependencies, but they are not part of the PostgreSQL schema itself.

## Table Groups

### 1. Authentication and Identity

#### better-auth persistence tables

- `auth_users`
- `auth_sessions`
- `auth_accounts`
- `auth_verifications`
- `auth_sso_providers`

Purpose:

- store authenticated users, sessions, provider accounts, verification tokens, and optional phone-number fields
- support email, SSO, and phone-oriented auth flows in application code

Notes:

- `auth_users.email` is unique
- `auth_sessions.token` is unique
- `auth_accounts(provider_id, account_id)` is unique
- phone-number support is added by `20260214192000_add_better_auth_phone_fields.sql`
- `auth_sso_providers` is the Better Auth SSO plugin's persistence table, added by `20261110113000_create_better_auth_sso_providers.sql`; it is distinct from the application's `sso_providers` table and does not replace it

#### Business-facing identity tables

- `profiles`
- `user_identities`
- `profile_external_attributes`
- `sso_providers`
- `domain_sso_mappings`
- `auth_settings`
- `auth_local_login_audit_logs`

Purpose:

- `profiles` stores business-facing user metadata, role, status, and login state
- `user_identities` binds external issuer/subject identities to internal users
- `profile_external_attributes` stores IdP/HR-style immutable attributes under a guarded update model
- `sso_providers` and `domain_sso_mappings` define SSO configuration
- `auth_settings` holds login-policy data, including the active local-login mode; legacy fields are not proof that every flag is enforced by the current authentication runtime
- `auth_local_login_audit_logs` records local-password fallback decisions and outcomes

Important details:

- `profiles.id` is the application user key used across business tables
- `user_identities` is constrained to at most one identity row per user after `20260214133000_enforce_single_idp_binding.sql`
- `profile_external_attributes` is protected by a trigger so business-side updates cannot casually overwrite identity-sync fields
- `profiles` also stores fallback password metadata added in `20260214201000_add_fallback_password_profile_metadata.sql`

### 2. App Catalog and Access Control

- `providers`
- `service_instances`
- `api_keys`
- `groups`
- `group_members`
- `group_app_permissions`
- `ai_configs`

Purpose:

- `providers` and `service_instances` define upstream AI/provider targets and app entries
- `api_keys` stores encrypted credentials and usage metadata
- `groups`, `group_members`, and `group_app_permissions` model group-based access control
- `ai_configs` remains available for app/provider configuration state

Important relationships:

- `service_instances.provider_id -> providers.id`
- `api_keys.provider_id -> providers.id`
- `api_keys.service_instance_id -> service_instances.id`
- `group_members.group_id -> groups.id`
- `group_members.user_id -> profiles.id`
- `group_app_permissions.group_id -> groups.id`
- `group_app_permissions.service_instance_id -> service_instances.id`

### 3. User Content and Execution Data

- `conversations`
- `messages`
- `app_executions`
- `user_preferences`
- `api_logs`

Purpose:

- `conversations` stores user conversation sessions
- `messages` stores ordered conversation messages
- `app_executions` tracks workflow/text-generation execution state and outputs
- `user_preferences` stores per-user UI preferences
- `api_logs` stores provider call metadata

Important details:

- `conversations.user_id -> profiles.id`
- `messages.conversation_id -> conversations.id`
- `messages.user_id -> profiles.id`
- `app_executions.user_id -> profiles.id`
- `app_executions.service_instance_id -> service_instances.id`
- `app_executions.conversation_id -> conversations.id` is nullable for legacy
  executions and cascades on physical conversation deletion. Task conversations
  use server-managed `metadata.runtime = "dify-task"`; execution inputs, outputs
  and process snapshots are projected as chat rounds, not copied into `messages`.
- New task submissions have a `submission_id` unique per user and application.
  Conversation history pages by `(created_at, id)` rather than mutable status time.
- Task conversation soft deletion also soft-deletes its executions transactionally.
  Late results cannot restore deleted executions or their input-file access.
- message ordering uses `created_at`, `sequence_index`, and `id` for stable sorting
- indexes exist for conversation timelines, app execution lookup, and provider usage tracing

### 4. Trusted Backend Runs And Generation Governance

- `backend_conversations`
- `backend_runs`
- `agent_submissions`
- `backend_run_interactions`

Purpose and relationships:

- `backend_conversations.conversation_id -> conversations.id` binds a local
  conversation to a service instance, backend type, configuration fingerprint
  and server-observed native thread. It supports LangChain and explicitly
  negotiated Dify conversations; it is not a client-writable metadata field.
- `backend_runs` belongs to that conversation/instance binding and records the
  website user, submission identity, native run mapping and bounded result.
  Execution and persistence statuses are separate, so upstream success is not
  automatically a saved result. Ordinary turn runs and human-input resume runs
  share a root run; resume segments do not create fake user questions.
- `agent_submissions` is the cross-backend generation admission/identity ledger,
  with request/target fingerprints, credential versions, task state and quota
  reservation/counting state. It links the effective group permission when one
  supplies the allowance. It is not an exactly-once execution guarantee or a
  general billing/audit system.
- `backend_run_interactions.origin_run_id -> backend_runs.id` stores one
  controlled native interruption per origin run, including its prompt,
  expiration, decision and associated resume run. Native checkpoint and interrupt
  identifiers are server-owned; browser-visible IDs do not grant access.

All four tables enable and force RLS with explicit system-actor policies. Public
product routes must authorize the website user and application before performing
the required server-context operations. Generic data APIs must not become an
alternative writer for trusted bindings, runs or messages.

Database constraints/triggers protect conversation identity, one active run per
conversation, root/resume relationships, pending credentials and quota records.
The human-input migrations add `waiting` to execution status and a guarded
pre-dispatch claim-release path. A waiting task, a closed event-stream segment
and a completed task are not interchangeable states.

Legacy Dify conversations retain their compatible browser-managed persistence;
the negotiated Dify and LangChain paths use the server writer. Read/refresh/history
does not dispatch a generation or a human decision. See
[generation governance](AGENT-GOVERNANCE.md),
[AG-UI integration](AGUI-INTEGRATION.md) and
[LangChain integration](LANGCHAIN-INTEGRATION.md) for exact supported states and
reconciliation boundaries. Native thread/run data and bounded result/checkpoint
payloads can contain sensitive information; include them in restricted database
backups, not public diagnostic exports.

### 5. Operational Tables

- `realtime_outbox_events`
- `migration_sync_checkpoints`
- `error_events`

Purpose:

- `realtime_outbox_events` captures DB changes for the realtime pipeline
- `migration_sync_checkpoints` supports migration/incremental-sync workflows
- `error_events` persists normalized error envelopes and aggregation metadata

Important details:

- `realtime_outbox_events` is filled by triggers on key business tables
- `error_events` stores fingerprint, code, source, severity, request metadata, and occurrence counters

## Enum Types

The baseline schema defines these enums:

- `user_role`
- `account_status`
- `message_role`
- `message_status`
- `execution_type`
- `execution_status`
- `sso_protocol`

These are part of the durable contract and are referenced by business tables.

The newer backend-run, submission and interaction states use their own checked
text columns; they are not all values of the baseline `execution_status` enum.
Inspect the later migrations before changing lifecycle queries or constraints.

## Security Model

### RLS

RLS is enabled and forced on the main business tables through the M4 migrations.

The application sets request-scoped PostgreSQL settings such as:

- `app.current_user_id`
- `app.current_user_role`
- `app.rls_system_actor`
- `app.rls_strict_mode`

Relevant runtime code:

- `lib/server/pg/session-options.ts`
- `lib/server/pg/user-context.ts`
- `lib/server/pg/pool.ts`

### Strict Mode

`APP_RLS_STRICT_MODE=1` changes legacy behavior so an implicit no-actor context no longer bypasses RLS checks. Only an explicit system actor can do that.

### Encrypted Secrets

Provider/API keys are not stored in plaintext by design. The application encrypts them before writing to `api_keys`, using `API_ENCRYPTION_KEY`.

## Operational Patterns

### Auth/Profile synchronization

The auth system and business profile system are related but intentionally separate.

In practice:

- authenticated users persist in `auth_users`
- session resolution ensures a corresponding `profiles` row exists for business logic
- external identity and immutable HR-style metadata are stored in dedicated side tables

This avoids overloading the auth tables with business-specific profile concerns.

### Realtime pipeline

`realtime_outbox_events` is the supported foundation for reliable realtime delivery. It decouples DB commits from downstream broker publication and is the mode expected by current Fastify realtime routes.

### Error telemetry

`error_events` is the durable store for normalized application errors, including the frontend client error-event path that now terminates in Fastify.

## Bootstrap and Migration Guidance

For a fresh environment, apply the SQL files in lexical order:

```bash
set -euo pipefail
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Use isolated databases for `dev`, `test`, and `prod`. Do not point those profiles at the same PostgreSQL database.

Use the migration-owner connection for schema changes, then confirm the
non-superuser runtime role's grants/default privileges and strict-RLS behavior.
The [Docker initializer](DOCKER.md#2-build-and-initialize-once) is the supported
one-shot path for a fresh Docker database; the loop above is a host-side fresh
schema example, not a replacement for role/storage/content bootstrap. Application
startup does not run migrations. For an existing installation, use only the
pending ordered files and preserve additive tables on compatible code rollback;
check unresolved work before changing the deployed interaction implementation.

## What This Document Does Not Claim

This document does not attempt to replace the SQL files.

If a code review, migration, or production issue depends on exact column definitions or trigger bodies, inspect the corresponding file under `database/migrations/` directly.
