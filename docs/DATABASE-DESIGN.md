# AgentifUI Database Design

## Scope

This document summarizes the current PostgreSQL schema used by AgentifUI as of March 12, 2026.

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

Purpose:

- store authenticated users, sessions, provider accounts, verification tokens, and optional phone-number fields
- support email, SSO, and phone-oriented auth flows in application code

Notes:

- `auth_users.email` is unique
- `auth_sessions.token` is unique
- `auth_accounts(provider_id, account_id)` is unique
- phone-number support is added by `20260214192000_add_better_auth_phone_fields.sql`

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
- `auth_settings` controls login policy flags
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
- message ordering uses `created_at`, `sequence_index`, and `id` for stable sorting
- indexes exist for conversation timelines, app execution lookup, and provider usage tracing

### 4. Operational Tables

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
shopt -s nullglob
for migration in database/migrations/*.sql; do
  psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Use isolated databases for `dev`, `test`, and `prod`. Do not point those profiles at the same PostgreSQL database.

## What This Document Does Not Claim

This document does not attempt to replace the SQL files.

If a code review, migration, or production issue depends on exact column definitions or trigger bodies, inspect the corresponding file under `database/migrations/` directly.
