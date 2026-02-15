# AgentifUI 数据库设计文档

# AgentifUI Database Design Document

This document provides a detailed description of the AgentifUI platform's database design, including table structures, relationships, security mechanisms, and features. This document is fully synchronized with the current database state and includes all applied migration files.

**Document Update Date**: 2025-07-12
**Database Version**: Includes all migrations up to `20250712133249_add_sequence_index_column.sql`

## Table of Contents

1. [Core Table Structure](#core-table-structure)
   - [User and Identity Management](#user-and-identity-management)
   - [Group and Member Management](#group-and-member-management)
   - [Chat and Messages](#chat-and-messages)
   - [API Key Management](#api-key-management)
   - [SSO Authentication](#sso-authentication)
   - [Storage and File Management](#storage-and-file-management)
   - [Other Tables](#other-tables)
2. [Database Features](#database-features)
   - [Security Mechanisms](#security-mechanisms)
   - [Data Integrity](#data-integrity)
   - [Automation Features](#automation-features)
3. [User Management System](#user-management-system)
   - [Admin View](#admin-view)
   - [Permission Protection Mechanism](#permission-protection-mechanism)
   - [Security Functions](#security-functions)
4. [Initial Data](#initial-data)
5. [Design Features](#design-features)
6. [ER Diagram](#er-diagram)

## Core Table Structure

### User and Identity Management

#### profiles

Extends `auth.users` and contains basic user information and status.

| Field Name      | Type                     | Description           | Constraints                                                     |
| --------------- | ------------------------ | --------------------- | --------------------------------------------------------------- |
| id              | UUID                     | User ID               | Primary Key, references `auth.users(id)`                        |
| full_name       | TEXT                     | User's full name      |                                                                 |
| username        | TEXT                     | Username              | UNIQUE                                                          |
| avatar_url      | TEXT                     | Avatar URL            |                                                                 |
| email           | TEXT                     | User's email          | Synced from `auth.users`                                        |
| phone           | TEXT                     | User's phone number   | Synced from `auth.users`                                        |
| role            | user_role                | User role             | DEFAULT `'user'::user_role`                                     |
| status          | account_status           | Account status        | DEFAULT `'active'::account_status`                              |
| created_at      | TIMESTAMP WITH TIME ZONE | Creation time         | DEFAULT `CURRENT_TIMESTAMP`                                     |
| updated_at      | TIMESTAMP WITH TIME ZONE | Update time           | DEFAULT `CURRENT_TIMESTAMP`                                     |
| last_login      | TIMESTAMP WITH TIME ZONE | Last login time       |                                                                 |
| auth_source     | TEXT                     | Authentication source | DEFAULT `'email'`, supports `email/google/github/phone/cas_sso` |
| sso_provider_id | UUID                     | SSO Provider ID       | References `sso_providers(id)`                                  |
| employee_number | TEXT                     | Employee number       | SSO unified identity identifier, UNIQUE constraint              |

**Enum Type Definitions:**

- `user_role`: ENUM ('admin', 'manager', 'user')
- `account_status`: ENUM ('active', 'suspended', 'pending')

#### user_preferences

Stores user interface and feature preference settings.

| Field Name            | Type                     | Description            | Constraints                         |
| --------------------- | ------------------------ | ---------------------- | ----------------------------------- |
| id                    | UUID                     | Preference ID          | Primary Key                         |
| user_id               | UUID                     | User ID                | References `auth.users(id)`, UNIQUE |
| theme                 | TEXT                     | UI Theme               | DEFAULT `'light'`                   |
| language              | TEXT                     | UI Language            | DEFAULT `'zh-CN'`                   |
| notification_settings | JSONB                    | Notification settings  | DEFAULT `'{}'`                      |
| ai_preferences        | JSONB                    | AI preference settings | DEFAULT `'{}'`                      |
| updated_at            | TIMESTAMP WITH TIME ZONE | Update time            | DEFAULT `CURRENT_TIMESTAMP`         |

### Group and Member Management

#### groups

Stores group information, replacing complex organizational structures.

| Field Name  | Type                     | Description       | Constraints                 |
| ----------- | ------------------------ | ----------------- | --------------------------- |
| id          | UUID                     | Group ID          | Primary Key                 |
| name        | TEXT                     | Group name        | NOT NULL                    |
| description | TEXT                     | Group description |                             |
| created_by  | UUID                     | Creator ID        | References `auth.users(id)` |
| created_at  | TIMESTAMP WITH TIME ZONE | Creation time     | DEFAULT `CURRENT_TIMESTAMP` |

#### group_members

Stores group membership relationships for simplified member management.

| Field Name | Type                     | Description     | Constraints                         |
| ---------- | ------------------------ | --------------- | ----------------------------------- |
| id         | UUID                     | Relationship ID | Primary Key                         |
| group_id   | UUID                     | Group ID        | References `groups(id)`, NOT NULL   |
| user_id    | UUID                     | User ID         | References `profiles(id)`, NOT NULL |
| created_at | TIMESTAMP WITH TIME ZONE | Creation time   | DEFAULT `CURRENT_TIMESTAMP`         |
|            |                          |                 | UNIQUE(`group_id`, `user_id`)       |

### Group App Permission Management

#### group_app_permissions

Stores group-level application access permissions, implementing simplified permission control.

| Field Name          | Type                     | Description         | Constraints                                  |
| ------------------- | ------------------------ | ------------------- | -------------------------------------------- |
| id                  | UUID                     | Permission ID       | Primary Key                                  |
| group_id            | UUID                     | Group ID            | References `groups(id)`, NOT NULL            |
| service_instance_id | UUID                     | Service Instance ID | References `service_instances(id)`, NOT NULL |
| is_enabled          | BOOLEAN                  | Is enabled          | DEFAULT `TRUE`                               |
| usage_quota         | INTEGER                  | Usage quota         | `NULL` means unlimited                       |
| used_count          | INTEGER                  | Times used          | DEFAULT `0`                                  |
| created_at          | TIMESTAMP WITH TIME ZONE | Creation time       | DEFAULT `CURRENT_TIMESTAMP`                  |
|                     |                          |                     | UNIQUE(`group_id`, `service_instance_id`)    |

**Permission Control Explanation:**

- **Simplified Design**: Group-based binary permission control (enabled/disabled).
- **Quota Management**: Supports group-level usage quota limits.
- **Permission Logic**: `public` (all users) | `group_only` (group members) | `private` (administrators).

**Foreign Key Relationship Fix (20250630034523):**

- **Issue Fixed**: `group_members.user_id` foreign key was changed from `auth.users(id)` to `profiles(id)`.
- **Reason for Fix**: To ensure that queries for group members can correctly join with the `profiles` table to fetch user information.
- **Impact Scope**: Fixed a relationship query error in the group member list query.
- **Security Guarantee**: Maintains cascade delete behavior, ensuring group member relationships are cleaned up when a user is deleted.

### Chat and Messages

#### conversations

Stores conversation sessions between users and the AI.

| Field Name   | Type                     | Description           | Constraints                           |
| ------------ | ------------------------ | --------------------- | ------------------------------------- |
| id           | UUID                     | Conversation ID       | Primary Key                           |
| user_id      | UUID                     | User ID               | References `auth.users(id)`, NOT NULL |
| ai_config_id | UUID                     | AI Config ID          | References `ai_configs(id)`           |
| title        | TEXT                     | Conversation title    | NOT NULL                              |
| summary      | TEXT                     | Conversation summary  |                                       |
| settings     | JSONB                    | Conversation settings | DEFAULT `'{}'`                        |
| created_at   | TIMESTAMP WITH TIME ZONE | Creation time         | DEFAULT `CURRENT_TIMESTAMP`           |
| updated_at   | TIMESTAMP WITH TIME ZONE | Update time           | DEFAULT `CURRENT_TIMESTAMP`           |
| status       | TEXT                     | Conversation status   | DEFAULT `'active'`                    |

#### messages

Stores messages within a conversation.

| Field Name      | Type                     | Description     | Constraints                                    |
| --------------- | ------------------------ | --------------- | ---------------------------------------------- |
| id              | UUID                     | Message ID      | Primary Key                                    |
| conversation_id | UUID                     | Conversation ID | References `conversations(id)`, NOT NULL       |
| user_id         | UUID                     | User ID         | References `auth.users(id)`                    |
| role            | message_role             | Message role    | NOT NULL                                       |
| content         | TEXT                     | Message content | NOT NULL                                       |
| metadata        | JSONB                    | Metadata        | DEFAULT `'{}'`                                 |
| created_at      | TIMESTAMP WITH TIME ZONE | Creation time   | DEFAULT `CURRENT_TIMESTAMP`                    |
| status          | message_status           | Message status  | DEFAULT `'sent'`                               |
| sequence_index  | INT                      | Sequence Index  | DEFAULT `0`, supports high-performance sorting |

**Index Explanation:**

- `idx_messages_conversation_time_sequence`: (`conversation_id`, `created_at` ASC, `sequence_index` ASC)
- `idx_messages_conversation_stable_sort`: (`conversation_id`, `created_at` ASC, `sequence_index` ASC, `id` ASC)

**Sorting Requirement:**

- When querying messages, you must use `ORDER BY created_at ASC, sequence_index ASC, id ASC` to ensure stable and high-performance ordering.

### API Key Management

#### providers

Stores API service provider information.

| Field Name | Type                     | Description         | Constraints                                            |
| ---------- | ------------------------ | ------------------- | ------------------------------------------------------ |
| id         | UUID                     | Provider ID         | Primary Key                                            |
| name       | TEXT                     | Provider name       | NOT NULL, UNIQUE                                       |
| type       | TEXT                     | Provider type       | NOT NULL                                               |
| base_url   | TEXT                     | Base URL            | NOT NULL                                               |
| auth_type  | TEXT                     | Authentication type | NOT NULL                                               |
| is_active  | BOOLEAN                  | Is active           | DEFAULT `TRUE`                                         |
| is_default | BOOLEAN                  | Is default provider | DEFAULT `FALSE`                                        |
| created_at | TIMESTAMP WITH TIME ZONE | Creation time       | DEFAULT `NOW()`                                        |
| updated_at | TIMESTAMP WITH TIME ZONE | Update time         | DEFAULT `NOW()`                                        |
|            |                          |                     | UNIQUE INDEX: Only one default provider in the system. |

#### service_instances

Stores service instance information.

| Field Name   | Type                     | Description              | Constraints                                                            |
| ------------ | ------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| id           | UUID                     | Instance ID              | Primary Key                                                            |
| provider_id  | UUID                     | Provider ID              | References `providers(id)`                                             |
| display_name | TEXT                     | Display name             | DEFAULT `''`                                                           |
| description  | TEXT                     | Description              | DEFAULT `''`                                                           |
| instance_id  | TEXT                     | Instance identifier      | NOT NULL                                                               |
| api_path     | TEXT                     | API path                 | DEFAULT `''`                                                           |
| is_default   | BOOLEAN                  | Is default               | DEFAULT `FALSE`                                                        |
| visibility   | TEXT                     | Application Visibility   | DEFAULT `'public'`, CHECK IN (`'public'`, `'group_only'`, `'private'`) |
| config       | JSONB                    | Configuration parameters | DEFAULT `'{}'`                                                         |
| created_at   | TIMESTAMP WITH TIME ZONE | Creation time            | DEFAULT `NOW()`                                                        |
| updated_at   | TIMESTAMP WITH TIME ZONE | Update time              | DEFAULT `NOW()`                                                        |
|              |                          |                          | UNIQUE(`provider_id`, `instance_id`)                                   |
|              |                          |                          | UNIQUE INDEX: At most one default app per provider.                    |

**Application Visibility Explanation:**

- `public`: Public application, visible to all users.
- `group_only`: Group application, visible only to group members.
- `private`: Private application, visible only to administrators.

#### api_keys

Stores API keys.

| Field Name          | Type                     | Description         | Constraints                        |
| ------------------- | ------------------------ | ------------------- | ---------------------------------- |
| id                  | UUID                     | Key ID              | Primary Key                        |
| provider_id         | UUID                     | Provider ID         | References `providers(id)`         |
| service_instance_id | UUID                     | Service Instance ID | References `service_instances(id)` |
| user_id             | UUID                     | User ID             | References `auth.users(id)`        |
| key_value           | TEXT                     | Encrypted key value | NOT NULL                           |
| is_default          | BOOLEAN                  | Is default          | DEFAULT `FALSE`                    |
| usage_count         | INTEGER                  | Usage count         | DEFAULT `0`                        |
| last_used_at        | TIMESTAMP WITH TIME ZONE | Last used time      |                                    |
| created_at          | TIMESTAMP WITH TIME ZONE | Creation time       | DEFAULT `NOW()`                    |
| updated_at          | TIMESTAMP WITH TIME ZONE | Update time         | DEFAULT `NOW()`                    |

### SSO Authentication

#### sso_providers

Stores SSO provider information, supporting multiple single sign-on protocols and dynamic configuration management.

| Field Name    | Type                     | Description                     | Constraints                                                                                    |
| ------------- | ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| id            | UUID                     | Provider ID                     | Primary Key, used for API routing (`/api/sso/{id}/*`) and service instance caching.            |
| name          | TEXT                     | Provider Name                   | NOT NULL, used for management UI display and logging.                                          |
| protocol      | sso_protocol             | Protocol Type                   | NOT NULL, determines which service implementation class to use.                                |
| settings      | JSONB                    | Unified Configuration Structure | NOT NULL, DEFAULT `'{}'`, contains `protocol_config`, `security`, and `ui` sections.           |
| client_id     | TEXT                     | Client ID                       | Used by OAuth2/OIDC protocols; not used by CAS protocol.                                       |
| client_secret | TEXT                     | Client Secret                   | Used by OAuth2/OIDC protocols; encrypted storage is recommended.                               |
| metadata_url  | TEXT                     | Metadata URL                    | Used by SAML protocol for automatic endpoint configuration.                                    |
| enabled       | BOOLEAN                  | Is Enabled                      | DEFAULT `TRUE`, if `false`, will not be displayed on the login page and APIs will deny access. |
| display_order | INTEGER                  | Display Order                   | DEFAULT `0`, order of buttons on the login page (smaller numbers appear first).                |
| button_text   | TEXT                     | Button Text                     | Text displayed on the login button; uses `name` field if empty; supports i18n.                 |
| created_at    | TIMESTAMP WITH TIME ZONE | Creation time                   | DEFAULT `CURRENT_TIMESTAMP`                                                                    |
| updated_at    | TIMESTAMP WITH TIME ZONE | Update time                     | DEFAULT `CURRENT_TIMESTAMP`                                                                    |

**Enum Type Definition:**

- `sso_protocol`: ENUM ('OIDC', 'SAML', 'CAS')

#### SSO Secure Access Functions (2025-07-09)

To address access permission issues for the SSO login page, several secure access functions have been added:

**1. `filter_sensitive_sso_settings(settings_input JSONB)`**

- Filters sensitive information from SSO configurations.
- Removes sensitive settings like OAuth2/OIDC client secret, client ID, and redirect hosts.
- Ensures no sensitive information is exposed during public access.

**2. `get_public_sso_providers()`**

- Provides a list of SSO providers for the login page.
- Automatically filters sensitive information.
- Supports sorting by `display_order`.
- Returns only enabled providers.

**3. `get_sso_provider_config(provider_id UUID)`**

- Provides the complete SSO configuration for server-side APIs.
- Includes sensitive information, for server-side use only.
- Supports checking the provider's enabled status.

**4. `get_enabled_sso_providers(protocol_filter TEXT)`**

- Gets a list of enabled SSO providers.
- Supports filtering by protocol type.
- Filters sensitive information, suitable for frontend display.

**Permission Settings:**

- `anon` users can access public functions and views.
- `authenticated` users can access all functions.
- `service_role` can access all functions, including the full configuration.

#### domain_sso_mappings

Stores mappings from domains to SSO providers.

| Field Name      | Type                     | Description     | Constraints                              |
| --------------- | ------------------------ | --------------- | ---------------------------------------- |
| id              | UUID                     | Mapping ID      | Primary Key                              |
| domain          | TEXT                     | Domain          | NOT NULL, UNIQUE                         |
| sso_provider_id | UUID                     | SSO Provider ID | References `sso_providers(id)`, NOT NULL |
| enabled         | BOOLEAN                  | Is enabled      | DEFAULT `TRUE`                           |
| created_at      | TIMESTAMP WITH TIME ZONE | Creation time   | DEFAULT `CURRENT_TIMESTAMP`              |
| updated_at      | TIMESTAMP WITH TIME ZONE | Update time     | DEFAULT `CURRENT_TIMESTAMP`              |

#### auth_settings

Stores global authentication settings.

| Field Name                 | Type                     | Description                | Constraints                      |
| -------------------------- | ------------------------ | -------------------------- | -------------------------------- |
| id                         | UUID                     | Setting ID                 | Primary Key                      |
| allow_email_registration   | BOOLEAN                  | Allow email registration   | DEFAULT `FALSE`                  |
| allow_phone_registration   | BOOLEAN                  | Allow phone registration   | DEFAULT `FALSE`                  |
| allow_password_login       | BOOLEAN                  | Allow password login       | DEFAULT `TRUE`                   |
| require_email_verification | BOOLEAN                  | Require email verification | DEFAULT `TRUE`                   |
| password_policy            | JSONB                    | Password policy            | DEFAULT `{"min_length": 8, ...}` |
| created_at                 | TIMESTAMP WITH TIME ZONE | Creation time              | DEFAULT `CURRENT_TIMESTAMP`      |
| updated_at                 | TIMESTAMP WITH TIME ZONE | Update time                | DEFAULT `CURRENT_TIMESTAMP`      |

### Storage and File Management

AgentifUI uses S3-compatible object storage (MinIO in local/test) for file management. The storage layer is decoupled from database migrations and managed by internal APIs plus object-path ownership rules.

#### Bucket Configuration

**`avatars` Bucket**

| Configuration Item  | Value                                                    | Description                       |
| ------------------- | -------------------------------------------------------- | --------------------------------- |
| Bucket ID           | `avatars`                                                | Unique identifier for the bucket  |
| Bucket Name         | `avatars`                                                | Display name for the bucket       |
| Public Access       | Controlled by `S3_PUBLIC_READ_ENABLED`                   | `1` public-read, `0` private-read |
| File Size Limit     | `5242880` (5MB)                                          | Maximum size for a single file    |
| Allowed MIME Types  | `['image/jpeg', 'image/jpg', 'image/png', 'image/webp']` | Supported image formats           |
| File Path Structure | `user-{userID}/{timestamp}.{extension}`                  | User-isolated file path structure |

**`content-images` Bucket**

| Configuration Item  | Value                                                                 | Description                       |
| ------------------- | --------------------------------------------------------------------- | --------------------------------- |
| Bucket ID           | `content-images`                                                      | Unique identifier for the bucket  |
| Public Access       | Controlled by `S3_PUBLIC_READ_ENABLED`                                | Same read model as avatars        |
| File Size Limit     | `10485760` (10MB)                                                     | Maximum size for a single file    |
| Allowed MIME Types  | `['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']` | Supported image formats           |
| File Path Structure | `user-{userID}/{timestamp}.{extension}`                               | User-isolated file path structure |

#### Storage API Workflow

1. Upload presign: server validates MIME/size/actor and issues PUT presigned URL.
2. Direct PUT to object storage.
3. Commit step: server re-checks object ownership + `HeadObject` metadata, then returns canonical object URL.
4. Download presign: server re-checks object existence, and in private mode enforces ownership.
5. Delete: server enforces ownership and removes object.

### Other Tables

#### ai_configs

Stores AI service configurations.

| Field Name | Type                     | Description     | Constraints                 |
| ---------- | ------------------------ | --------------- | --------------------------- |
| id         | UUID                     | Config ID       | Primary Key                 |
| provider   | TEXT                     | Provider        | NOT NULL                    |
| app_id     | TEXT                     | App ID          |                             |
| api_key    | TEXT                     | API Key         | NOT NULL                    |
| api_url    | TEXT                     | API URL         | NOT NULL                    |
| settings   | JSONB                    | Config settings | DEFAULT `'{}'`              |
| enabled    | BOOLEAN                  | Is enabled      | DEFAULT `TRUE`              |
| created_at | TIMESTAMP WITH TIME ZONE | Creation time   | DEFAULT `CURRENT_TIMESTAMP` |
| updated_at | TIMESTAMP WITH TIME ZONE | Update time     | DEFAULT `CURRENT_TIMESTAMP` |

#### api_logs

Stores API call logs.

| Field Name      | Type                     | Description      | Constraints                    |
| --------------- | ------------------------ | ---------------- | ------------------------------ |
| id              | UUID                     | Log ID           | Primary Key                    |
| user_id         | UUID                     | User ID          | References `auth.users(id)`    |
| conversation_id | UUID                     | Conversation ID  | References `conversations(id)` |
| provider        | TEXT                     | Provider         | NOT NULL                       |
| endpoint        | TEXT                     | Endpoint         | NOT NULL                       |
| request         | JSONB                    | Request content  | DEFAULT `'{}'`                 |
| response        | JSONB                    | Response content | DEFAULT `'{}'`                 |
| status_code     | INTEGER                  | Status code      |                                |
| latency_ms      | INTEGER                  | Latency (ms)     |                                |
| created_at      | TIMESTAMP WITH TIME ZONE | Creation time    | DEFAULT `CURRENT_TIMESTAMP`    |

## Database Features

### Security Mechanisms

#### Row-Level Security (RLS)

All tables have Row-Level Security (RLS) policies enabled to ensure secure data access:

1.  **User Data**
    - Users can only view and update their own profiles.
    - Users can only view and update their own preference settings.

2.  **Group Data**
    - Group members can view group information.
    - Only administrators can manage groups.
    - Group members can view the member list.

3.  **Conversations and Messages**
    - Users can only view, update, and delete their own conversations.
    - Users can only view messages in their own conversations.

4.  **API Keys and Configurations**
    - Administrators can perform all operations (CRUD).
    - The server (unauthenticated requests) and authenticated users can read configuration information.
    - This design supports API routes accessing Dify configurations while maintaining security controls.

5.  **SSO Configuration**
    - Only administrators can access and manage SSO provider configurations.
    - Anonymous users can access a filtered list of SSO providers through secure functions.
    - The server can retrieve complete SSO configuration information.

6.  **Group App Permissions**
    - Users can only view the app permissions of groups they belong to.
    - Administrators can manage the app permissions of all groups.
    - Permission checks are based on the user's group membership.

#### Encrypted Storage

API keys are stored using the AES-256-GCM encryption algorithm in the format `"iv:authTag:encryptedData"`, ensuring that even if the database is compromised, the keys will not be directly accessible.

### Data Integrity

#### Foreign Key Constraints

Relationships between tables are maintained through foreign key constraints to ensure data consistency:

- **Cascade Delete**: When a parent record is deleted, related child records are also deleted.
- **Set to NULL**: In some cases, when a parent record is deleted, the foreign key field in child records is set to `NULL`.

#### Unique Constraints

Several tables include unique constraints to ensure data uniqueness:

- Username uniqueness constraint.
- Domain name uniqueness constraint.
- Service instance ID is unique within the same provider.
- Group members are unique within the same group.
- **Default App Uniqueness Constraint**: Each provider can have at most one default service instance (implemented via a partial unique index).

### Automation Features

#### Triggers

The system uses multiple triggers to implement automation and data integrity protection:

1.  **User Management Triggers**
    - `handle_new_user`: Automatically creates a `profiles` record when a user registers, prioritizing the user-provided `username`.
    - `handle_user_deletion_prep`: Handles permission transfers before user deletion to prevent orphan data.

2.  **Group Management Triggers**
    - `handle_group_member_deletion`: Automatically cleans up orphan groups after a group member is deleted.
    - `validate_group_member_operations`: Validates group member operations to ensure the last creator is not removed.

3.  **Message Management Triggers**
    - `set_message_synced_on_update`: Automatically maintains message sync status and timestamps.
    - `update_conversation_last_message_preview`: Automatically updates the last message preview for a conversation.

4.  **Update Timestamp Triggers**
    - Automatically updates the `updated_at` field of table records.
    - Applied to all major tables.

5.  **Data Cleanup and Maintenance Functions**
    - `cleanup_orphan_data`: Cleans up orphan data (groups, AI configs, messages).
    - `safe_cleanup_orphan_data`: Safe batch cleanup, supports a `dry_run` mode.

6.  **Service Instance Management Functions**
    - `set_default_service_instance(target_instance_id uuid, target_provider_id uuid)`: Atomically sets the default service instance, ensuring only one default instance per provider.

7.  **Group Permission Management Functions**
    - `get_user_accessible_apps(user_id UUID)`: Gets the list of apps accessible to a user, based on group permissions and app visibility.
    - `check_user_app_permission(user_id UUID, app_instance_id TEXT)`: Checks a user's access permission for a specific app.
    - `increment_app_usage(user_id UUID, app_instance_id TEXT)`: Increments the app usage count, supporting quota management.

## User Management System

### Admin View

#### User Data Access

Admin functionality for user data access is implemented as follows:

**Admin Functionality Implementation:**

- Administrators use the `getUserList` function in `lib/db/users.ts` to fetch user data.
- RLS policies control data access permissions.
- Administrators can access sensitive information from the `auth.users` table, such as email and phone numbers.
- Regular users can only access their own data.

### Permission Protection Mechanism

#### Role Update Protection

**Trigger Function:** `validate_role_update()`

Prevents administrators from performing dangerous role operations:

1.  **Self-protection**: Administrators cannot change their own role.
2.  **Admin protection**: Cannot downgrade the permissions of other administrators.
3.  **Permission validation**: Only administrators can change user roles.

#### User Deletion Protection

**Trigger Function:** `validate_user_deletion()`

Prevents the deletion of critical users:

1.  **Self-protection**: Administrators cannot delete their own accounts.
2.  **Admin protection**: Cannot delete other administrator accounts.
3.  **Permission validation**: Only administrators can delete users.

### Security Functions

#### Admin Permission Check

**Function:** `public.is_admin()`

#### Batch Role Update

**Function:** `safe_batch_update_role(target_user_ids UUID[], target_role user_role)`

A secure batch role update function that includes comprehensive permission checks.

#### User Statistics Function

**Function:** `get_user_stats()`

Provides user statistics for administrators.

#### SSO User Management

**Function:** `find_user_by_employee_number(emp_num TEXT)`

Finds user information by employee number, specifically for CAS SSO login.

**Function:** `create_sso_user(emp_number TEXT, user_name TEXT, sso_provider_uuid UUID)`

Creates a new account for an SSO user on their first login.

## Initial Data

Due to a simplified architecture, the system no longer presets initial data. After registration, users can:

1.  Create groups on their own.
2.  Administrators can configure SSO providers.
3.  Administrators can configure application instances and API keys.

## Design Features

### Modular Design

The database design adopts a modular approach, clearly separating different functional areas:

- User and Identity Management
- Group and Member Management
- Chat and Messages
- API Key Management
- SSO Authentication

### Simplified Architecture

The system uses a simplified group permission architecture:

- Each group has a simple membership relationship.
- Groups have binary permission control over applications.
- Supports three application visibilities: `public`, `group_only`, and `private`.

### Flexible API Key Management

The API key management system is designed to be flexible and support various scenarios:

- Supports multiple providers and service instances.
- Encrypted storage ensures security.
- Supports user-level configuration.
- Extendable configuration parameters.

### Comprehensive SSO Integration

The SSO authentication system supports multiple authentication methods:

- Supports SAML, OAuth2, and OIDC protocols.
- Domain-based automatic routing.
- Configurable authentication policies.
- Seamless integration with user profiles.
- Secure configuration information filtering mechanism.

### Scalability

The database design considers future expansion needs:

- JSON/JSONB fields are used to store flexible configurations.
- Reserved fields and settings for future extensions.
- The modular design facilitates the addition of new features.

## ER Diagram

```
+---------------+       +----------------+       +---------------+
| profiles      |       | groups         |       | group_members |
+---------------+       +----------------+       +---------------+
| id            |<---+  | id             |<------| group_id      |
| full_name     |    |  | name           |       | user_id       |
| username      |    |  | description    |       | created_at    |
| avatar_url    |    |  | created_by     |       +---------------+
| role          |    |  | created_at     |       |               |
| status        |    |  |                |       | group_app_permissions |
| created_at    |    |  |                |       +---------------+
| updated_at    |    |  |                |       | id            |
| last_login    |    |  |                |<------| group_id      |
| auth_source   |    |  |                |       | service_instance_id |
| sso_provider_id|    |  |                |       | is_enabled    |
| employee_number|    |  |                |       | usage_quota   |
+---------------+    |  |                |       | used_count    |
                     |  |                |       | created_at    |
                     |  |                |       +---------------+
+---------------+    |  |                |       |               |
| conversations |    |  |                |       | ai_configs    |
+---------------+    |  |                |       +---------------+
| id            |    |  |                |       | id            |
| user_id       |----+  |                |       | provider      |
| ai_config_id  |       |                |       | app_id        |
| title         |       |                |       | api_key       |
| summary       |       |                |       | api_url       |
| settings      |       |                |       | settings      |
| created_at    |       |                |       | enabled       |
| updated_at    |       |                |       | created_at    |
| status        |       |                |       | updated_at    |
+---------------+       |                |       +---------------+
      |               |                |       |               |
      |               |                |       | providers     |
      v               |                |       +---------------+
+---------------+       |                |       | id            |
| messages      |       |                |       | name          |
+---------------+       |                |       | type          |
| id            |       |                |       | base_url      |
| conversation_id|       |                |       | auth_type     |
| user_id       |       |                |       | is_active     |
| role          |       |                |       | created_at    |
| content       |       |                |       | updated_at    |
| metadata      |       |                |       +---------------+
| created_at    |       |                |       |               |
| status        |       |                |       | service_instances|
| sequence_index|       |                |       +---------------+
+---------------+       |                |
                       |                |       | id            |
+---------------+       |                |       | provider_id   |
| user_preferences|       |                |       | display_name  |
+---------------+       |                |       | description   |
| id            |       |                |       | instance_id   |
| user_id       |       |                |       | api_path      |
| theme         |       |                |       | is_default    |
| language      |       |                |       | visibility    |
| notification_settings|       |                |       | config        |
| ai_preferences|       |                |       | created_at    |
| updated_at    |       |                |       | updated_at    |
+---------------+       |                |       +---------------+
                       |                |       |               |
+---------------+       |                |       | api_keys      |
| sso_providers |       |                |       +---------------+
+---------------+       |                |       | id            |
| id            |       |                |       | provider_id   |
| name          |       |                |       | service_instance_id|
| protocol      |       |                |       | user_id       |
| settings      |       |                |       | key_value     |
| client_id     |       |                |       | is_default    |
| client_secret |       |                |       | usage_count   |
| metadata_url  |       |                |       | last_used_at  |
| enabled       |       |                |       | created_at    |
| display_order |       |                |       | updated_at    |
| button_text   |       |                |       +---------------+
| created_at    |       |                |       |               |
| updated_at    |       |                |       | domain_sso_mappings|
+---------------+       |                |       +---------------+
      |               |                |       | id            |
      |               |                |       | domain        |
      v               |                |       | sso_provider_id|
+---------------+       |                |       | enabled       |
| domain_sso_mappings|               |                |       | created_at    |
+---------------+               |                |       | updated_at    |
| id            |               |                |       +---------------+
| domain        |               |                |       |               |
| sso_provider_id|               |                |       | auth_settings |
| enabled       |               |                |       +---------------+
| created_at    |               |                |       | id            |
| updated_at    |               |                |       | allow_email_registration|
+---------------+               |                |       | allow_phone_registration|
                               |                |       | allow_password_login|
                               |                |       | require_email_verification|
                               |                |       | password_policy|
                               |                |       | created_at    |
                               |                |       | updated_at    |
                               |                |       +---------------+
```

This database design provides a streamlined yet comprehensive foundation for AgentifUI, supporting user management, group collaboration, AI chat, SSO authentication, and API integration. It emphasizes simplicity, security, and extensibility for future growth and maintenance.
