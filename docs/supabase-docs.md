# Supabase Database Documentation

This document records the database structure, functions, and usage methods for the AgentifUI project. This document is fully synchronized with the current state of the database.

**Document Update Date**: 2025-07-12
**Database Version**: Includes all migrations up to `20250712133249_add_sequence_index_column.sql`

## Current System Status

- ✅ **Group Permission Management**: Simplified group-level application permission control system with a binary permission design.
- ✅ **RLS Security Policies**: All permission issues and infinite recursion problems have been fully fixed; the system is running stably.
- ✅ **Security View Optimization**: Fixed `security_definer` view warnings, clarifying permission control.
- ✅ **User Management**: Replaced outdated admin views with function-based methods.
- ✅ **Middleware Permissions**: Admin permission verification at the front-end routing level.
- ✅ **Application Access Control**: Group-based application visibility management, simplifying permission logic.
- ✅ **CAS SSO Integration**: Complete CAS 2.0 Single Sign-On system, supporting unified authentication.
- ✅ **Employee Number Management**: Supports employee number field and authentication, with complete type definitions.
- ✅ **SSO User Management**: Automatic creation of SSO user accounts with secure identity mapping.
- ✅ **SSO Function Fix**: Fixed database function return type mismatch issues, ensuring SSO login works correctly.
- ✅ **SSO Type Conversion Fix**: Fixed the UUID type conversion issue in the `create_sso_user` function, ensuring the SSO user creation feature works correctly.
- ✅ **Database Stability**: Fixed the infinite recursion issue in the `profiles` table RLS policy, ensuring the system operates normally.
- ✅ **Dynamic SSO Configuration Management**: Extended the SSO provider table to support UI configuration, protocol templates, and a unified configuration structure.
- ✅ **SSO Protocol Template System**: Manages SSO protocol templates using a TypeScript configuration file, enhancing type safety and development experience.
- ✅ **Avatar Storage System**: Complete Supabase Storage avatar upload functionality, supporting public access and secure permission control.
- ✅ **Architecture Simplification**: Migrated from a complex organization + department architecture to a simple group permission system.
- ✅ **Foreign Key Relationship Fix**: Fixed the foreign key relationship in the group members table, ensuring correct relational queries.
- ✅ **SSO Secure Access**: Added new security functions to support permissioned access for the SSO login page, filtering sensitive information.
- ✅ **Data Cleanup**: Removed outdated initial data configurations to support dynamic configuration management.

## Database Overview

This system uses Supabase as its backend database service, incorporating multiple functional modules such as user management, conversation management, and API key management. The database design follows the best practices of relational databases and uses Row-Level Security (RLS) policies to ensure data security.

## Core Data Table Structures

### User and Identity Management

1.  `profiles` Table:
    - **Main Fields**: `id`, `full_name`, `username`, `avatar_url`, `email`, `phone`, `role`, `status`, `created_at`, `updated_at`, `last_login`, `auth_source`, `sso_provider_id`, `employee_number`
    - The `email` and `phone` fields are synchronized from the `auth.users` table to ensure data consistency.
    - The `role` field is of type `user_role` enum, with possible values `'admin'`, `'manager'`, `'user'`, and a default value of `'user'`.
    - The `status` field is of type `account_status` enum, with possible values `'active'`, `'suspended'`, `'pending'`, and a default value of `'active'`.
    - The `auth_source` field supports multiple authentication methods: `email`, `google`, `github`, `phone`, `cas_sso`, etc., with a default value of `'email'`.
    - `employee_number` field: Employee ID, with a unique constraint, used for SSO identity recognition.

2.  `user_preferences` Table:
    - **Main Fields**: `id`, `user_id`, `theme`, `language`, `notification_settings`, `ai_preferences`, `updated_at`
    - Stores user's personalized settings and preferences.

### User Management System

#### Admin User Management

**User Data Access Mechanism** - Admins securely access user data through functions:

- **Data Access**: Admins retrieve user data via the `getUserList` function in `lib/db/users.ts`.
- **Permission Control**: RLS policies control data access, allowing admins to access sensitive information.
- **Security Guarantee**: All operations require admin permission verification.

**Supported Management Functions:**

- View basic information of all users (name, username, avatar, etc.).
- View user email addresses and phone numbers.
- View user login status and last login time.
- Manage user roles and account statuses.

#### Permission Protection Mechanisms

1.  **Role Update Protection** (`validate_role_update` trigger):
    - Prevents an admin from modifying their own role.
    - Prevents demoting the permissions of other admins.
    - Only admins can modify user roles.

2.  **User Deletion Protection** (`validate_user_deletion` trigger):
    - Prevents an admin from deleting their own account.
    - Prevents the deletion of other admin accounts.
    - Only admins can delete users.

3.  **Batch Operation Protection** (`safe_batch_update_role` function):
    - Secure batch role updates.
    - Includes complete permission checks and self-protection.
    - Atomic operations ensure data consistency.

### Conversation and Message Management

1.  `conversations` Table:
    - **Main Fields**: `id`, `user_id`, `ai_config_id`, `title`, `summary`, `settings`, `created_at`, `updated_at`, `status`
    - **Dify Integration Fields**: `external_id`, `app_id`, `last_message_preview`, `metadata`
    - `metadata` field (JSONB type): Stores extra metadata for the conversation, such as pinned status, tags, archived status, last active time, etc. Example: `{"pinned":true,"tags":["Important"],"archived":false,"last_active_at":"2024-05-22T12:00:00Z"}`. This field allows for flexible extension, facilitating front-end customization of conversation attributes.
    - `last_message_preview` field: Used to display a summary of the last message in the conversation in places like the sidebar. After the `20250522193000` migration, this field's format was changed to JSONB, including `content` (message content preview), `role` (message role), and `created_at` (message time). For example: `{"content":"Hello, how can I help you?","role":"assistant","created_at":"2024-05-22T19:30:00Z"}`. This makes it easier for the front-end to directly render message previews with different roles and times.

2.  `messages` Table:
    - **Main Fields**: `id`, `conversation_id`, `user_id`, `role`, `content`, `metadata`, `created_at`, `status`, `sequence_index`
    - `sequence_index` field: `INT` type, default `0`. Used for sequential ordering of messages, e.g., 0=user message, 1=assistant message, 2=system message.
    - **Index Optimization**:
      - `idx_messages_conversation_time_sequence`: (`conversation_id`, `created_at` ASC, `sequence_index` ASC)
      - `idx_messages_conversation_stable_sort`: (`conversation_id`, `created_at` ASC, `sequence_index` ASC, `id` ASC)
    - **Sorting Requirement**:
      - When querying messages, you must use `ORDER BY created_at ASC, sequence_index ASC, id ASC` to ensure stable order and high performance.
    - **Dify Integration Fields**: `external_id`, `token_count`, `is_synced`
    - `role` field possible values are `'user'`, `'assistant'`, or `'system'`.
    - `status` field possible values are `'sent'`, `'delivered'`, or `'error'`.
    - `metadata` field (JSONB type): Used to store additional information about the message, such as message source, edit history, referenced content, etc. This field is optional and facilitates future feature extensions.
    - **Trigger Explanation**: Since `20250521125100_add_message_trigger.sql`, the `messages` table has added triggers (e.g., `set_message_synced_on_update`, `update_conversation_last_message_preview`) to automatically maintain message sync status, update timestamps, and automatically refresh the `conversations.last_message_preview` field when a new message is inserted or updated. These triggers ensure data consistency and real-time display on the front-end without manual maintenance.

### Application Execution Record Management

**`app_executions` Table** - Used to store execution records for workflow and text-generation applications:

#### Table Structure Design

1.  **Base Fields**:
    - `id`: Primary key, UUID type.
    - `user_id`: User ID, referencing the `auth.users` table.
    - `service_instance_id`: Service instance ID, referencing the `service_instances` table.
    - `execution_type`: Execution type enum, supporting 'workflow' and 'text-generation'.

2.  **Dify Integration Fields**:
    - `external_execution_id`: Execution ID returned by the Dify API (`workflow_run_id` or `message_id`).
    - `task_id`: Task ID returned by Dify (mainly for workflow types).

3.  **Execution Content Fields**:
    - `title`: Execution title, user-defined or auto-generated.
    - `inputs`: Input parameters, stored in JSONB format.
    - `outputs`: Output results, stored in JSONB format.
    - `status`: Execution status enum (pending, running, completed, failed, stopped).
    - `error_message`: Error message.

4.  **Statistics Fields**:
    - `total_steps`: Total number of steps (used by workflow, 0 for text-generation).
    - `total_tokens`: Total token count.
    - `elapsed_time`: Execution time (in seconds).

5.  **Metadata and Timestamps**:
    - `metadata`: Extended metadata, JSONB format.
    - `created_at`, `updated_at`, `completed_at`: Timestamp fields.

#### Design Features

1.  **Application Type Distinction**:
    - **Conversational Apps** (chatbot, agent, chatflow): Use `conversations` + `messages` tables.
    - **Task-based Apps** (workflow, text-generation): Use the `app_executions` table.

2.  **Data Isolation**:
    - Each execution is an independent task record.
    - Different from the continuous nature of conversational apps.
    - Avoids conceptual confusion and data pollution.

3.  **Flexible Extension**:
    - Supports new task-based application types in the future.
    - JSONB fields support complex input/output structures.
    - Metadata field supports custom extensions.

#### Index Optimization

```sql
-- Optimize user execution record queries
CREATE INDEX idx_app_executions_user_created ON app_executions(user_id, created_at DESC);

-- Optimize queries related to service instances
CREATE INDEX idx_app_executions_service_instance ON app_executions(service_instance_id);

-- Optimize filtering by type and status
CREATE INDEX idx_app_executions_type_status ON app_executions(execution_type, status);

-- Optimize queries by external ID (for syncing with Dify)
CREATE INDEX idx_app_executions_external_id ON app_executions(external_execution_id) WHERE external_execution_id IS NOT NULL;
```

#### Row-Level Security Policies

```sql
-- Users can only access their own execution records
CREATE POLICY "Users can view their own execution records" ON app_executions
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all execution records (for system management)
CREATE POLICY "Admins can view all execution records" ON app_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
```

#### Use Cases

1.  **Workflow Execution**:
    - Store workflow input parameters and output results.
    - Record execution status and step progress.
    - Support execution history queries and re-executions.

2.  **Text Generation**:
    - Store input prompts for generation requests.
    - Record the generated text content.
    - Support generation history management.

3.  **Execution Monitoring**:
    - Real-time tracking of execution status.
    - Statistics on token usage.
    - Performance analysis and optimization.

### API Key Management

1.  `providers` Table:
    - **Main Fields**: `id`, `name`, `type`, `base_url`, `auth_type`, `is_active`, `is_default`, `created_at`, `updated_at`
    - Stores information about API service providers, such as Dify.
    - **Default Provider Management**: Ensures only one default provider exists in the system via the `is_default` field and a unique constraint.
    - **Automatic Management Mechanism**: Triggers automatically maintain the uniqueness and deletion protection of the default provider.

2.  `service_instances` Table:
    - **Main Fields**: `id`, `provider_id`, `name`, `display_name`, `description`, `instance_id`, `api_path`, `is_default`, `visibility`, `config`, `created_at`, `updated_at`
    - Stores instance configurations for specific service providers.
    - The combination of `provider_id` and `instance_id` has a unique constraint.
    - **Default Application Uniqueness Constraint**: A partial unique index ensures that each provider can have at most one default application (`is_default = TRUE`).
    - `visibility` field: Application visibility control ('public', 'group_only', 'private'), defaults to 'public'.

3.  `api_keys` Table:
    - **Main Fields**: `id`, `provider_id`, `service_instance_id`, `user_id`, `key_value`, `is_default`, `usage_count`, `last_used_at`, `created_at`, `updated_at`
    - Stores keys used to access external APIs.

### Group and Member Management

1.  `groups` Table:
    - **Main Fields**: `id`, `name`, `description`, `created_by`, `created_at`, `updated_at`
    - Simplified group management, supporting basic group information and creator tracking.

2.  `group_members` Table:
    - **Main Fields**: `id`, `user_id`, `group_id`, `created_at`
    - `user_id` field: References `profiles(id)` to ensure correct relational queries (fixed in 20250630034523).
    - Simplified group member relationship, removing complex departmental concepts and role hierarchies.
    - **Foreign Key Fix**: Changed from referencing `auth.users(id)` to `profiles(id)` to resolve relational query issues.

### Group Application Permission Management

**`group_app_permissions` Table** - Implements group-level application access control:

#### Table Structure Design

1.  **Permission Control Fields**:
    - `id`: Primary key, UUID type.
    - `group_id`: Group ID, referencing the `groups` table.
    - `app_id`: Application ID, referencing the `service_instances` table.
    - `granted_at`: Time the permission was granted.

#### Permission Control Mechanism

1.  **Simplified Permission Control**:
    - Binary permission control based on `(group_id + app_id)`.
    - A unique constraint ensures a group has only one permission record per application.

2.  **Application Visibility Management**:
    - `public`: Public application, visible to all users.
    - `group_only`: Group application, visible only to group members.
    - `private`: Private application, visible only to admins.

#### Core Database Functions

1.  **`get_user_accessible_apps(user_id UUID)`**:
    - Gets the list of applications accessible to a user.
    - Based on the permission configuration of the user's groups.
    - Supports application visibility filtering.

2.  **`check_user_app_permission(user_id UUID, app_id UUID)`**:
    - Checks a user's access permission for a specific application.
    - Simplified permission check logic.

3.  **`increment_app_usage(user_id UUID, app_id UUID, increment_value INTEGER)`**:
    - Increments the usage count of an application.
    - Simplified usage statistics.

#### Row-Level Security Policies

```sql
-- Users can view the application permissions of their own groups
CREATE POLICY "Users can view their own group's app permissions" ON group_app_permissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = group_app_permissions.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Admins can manage the application permissions of all groups
CREATE POLICY "Admins can manage group app permissions" ON group_app_permissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
```

### SSO Authentication

1.  `sso_providers` Table:
    - **Main Fields**: `id`, `name`, `protocol`, `settings`, `client_id`, `client_secret`, `metadata_url`, `enabled`, `display_order`, `button_text`, `created_at`, `updated_at`
    - `protocol` field possible values are `'SAML'`, `'OAuth2'`, `'OIDC'`, `'CAS'`.
    - Supports multiple Single Sign-On protocols, including the standard CAS 2.0 authentication system.
    - `display_order` field: Controls the display order of buttons on the login page (smaller numbers appear first).
    - `button_text` field: Display text for the login button; uses the `name` field if empty.
    - `settings` field: A unified JSONB configuration structure containing `protocol_config`, `security`, and `ui` main parts.
    - **SSO Secure Access Functions**: Added multiple security functions to support permissioned access for the login page and filtering of sensitive information.

2.  **SSO Protocol Template Configuration** (Managed by TypeScript):
    - Protocol templates are now managed via a TypeScript configuration file: `@lib/config/sso-protocol-definitions.ts`.
    - Supports standard configuration templates and validation rules for CAS, OIDC, and SAML protocols.
    - Provides type-safe protocol configuration definitions and default settings.
    - Simplifies the system architecture, enhancing development experience and type safety.
    - The configuration file includes JSON Schema validation rules and default configuration templates for each protocol.

3.  `domain_sso_mappings` Table:
    - **Main Fields**: `id`, `domain`, `sso_provider_id`, `enabled`, `created_at`, `updated_at`

#### SSO User Management Functions

**`find_user_by_employee_number(emp_num TEXT)`**

- Finds user information by employee number, specifically for CAS SSO login.
- Returns the user's complete profile information, including correct enum types and TEXT type fields.
- Uses `SECURITY DEFINER` mode to ensure permission security.
- **Latest Fix**: Corrected the enum type matching issue for the `status` field in the return type.

**`create_sso_user(emp_number TEXT, user_name TEXT, sso_provider_uuid UUID)`**

- Creates an account for a user logging in via SSO for the first time.
- Automatically sets the authentication source to `cas_sso` (TEXT type).
- Generates a unique username and complete user information.
- **Latest Fix (2025-06-18)**:
  - Fixed the UUID type conversion issue for the `sso_provider_id` field.
  - Uses the UUID type value directly instead of an incorrect TEXT conversion.
  - Resolved the "column sso_provider_id is of type uuid but expression is of type text" error.
  - Ensures all field data types correctly match the database table structure.

#### SSO Secure Access Functions (2025-07-09)

To resolve access permission issues on the SSO login page, the system has added several secure access functions:

**`filter_sensitive_sso_settings(settings_input JSONB)`**

- Filters sensitive information from the SSO configuration.
- Removes sensitive settings like OAuth2/OIDC client secret, client ID, and redirect host.
- Uses `SECURITY DEFINER` to ensure secure execution.

**`get_public_sso_providers()`**

- Provides a list of SSO providers for the login page.
- Automatically filters sensitive information.
- Supports sorting by `display_order`.
- Only returns enabled providers.
- Supports anonymous user access.

**`get_sso_provider_config(provider_id UUID)`**

- Provides the complete SSO configuration for server-side APIs.
- Includes sensitive information, for server-side use only.
- Supports checking the provider's enabled status.
- Includes parameter validation and error handling.

**`get_enabled_sso_providers(protocol_filter TEXT)`**

- Gets a list of enabled SSO providers.
- Supports filtering by protocol type.
- Filters sensitive information, suitable for front-end display.
- Supports anonymous access.

### Storage and File Management

This section reflects the current migration baseline: storage is no longer backed by Supabase Storage. AgentifUI now uses S3-compatible object storage (MinIO in local/test) through internal storage APIs.

#### Bucket Configuration

**`avatars`**

| Configuration Item  | Value                                                    | Description                       |
| ------------------- | -------------------------------------------------------- | --------------------------------- |
| Bucket ID           | `avatars`                                                | Unique identifier for the bucket  |
| Bucket Name         | `avatars`                                                | Display name for the bucket       |
| Public Access       | `S3_PUBLIC_READ_ENABLED`                                 | `1` public-read, `0` private-read |
| File Size Limit     | `5242880` (5MB)                                          | Maximum size for a single file    |
| Allowed MIME Types  | `['image/jpeg', 'image/jpg', 'image/png', 'image/webp']` | Supported image formats           |
| File Path Structure | `user-{userID}/{timestamp}.{extension}`                  | User-isolated file path           |

**`content-images`**

| Configuration Item  | Value                                                                 | Description                      |
| ------------------- | --------------------------------------------------------------------- | -------------------------------- |
| Bucket ID           | `content-images`                                                      | Unique identifier for the bucket |
| Public Access       | `S3_PUBLIC_READ_ENABLED`                                              | Same read model as avatars       |
| File Size Limit     | `10485760` (10MB)                                                     | Maximum size for a single file   |
| Allowed MIME Types  | `['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']` | Supported image formats          |
| File Path Structure | `user-{userID}/{timestamp}.{extension}`                               | User-isolated file path          |

#### Secure Design Features

**Permission Control Model:**

- **Upload Permission Control**: Only authenticated and active users can get presigned upload URLs.
- **Ownership Verification**: Upload commit/delete/download (private mode) enforce `user-{userId}/...` ownership.
- **Read Mode Switch**: `S3_PUBLIC_READ_ENABLED=1` allows public object reads; `0` enforces authenticated download-presign checks.
- **Path Security**: The application layer validates namespace path ownership and blocks path traversal payloads.

**File Management Strategy:**

- **Automatic Cleanup**: Avatar update deletes old avatar file; commit failures trigger best-effort object rollback.
- **Uniqueness Guarantee**: Uses timestamp + UUID to ensure object name uniqueness.
- **Two-step Validation**: Validate payload at presign time and re-validate object metadata at commit time.
- **Size Limitation**: 5MB avatar / 10MB content image limits.

#### Application Layer Integration

**Storage API Endpoints**:

1.  Avatar upload: `POST /api/internal/storage/avatar/presign` -> PUT -> `POST /api/internal/storage/avatar` commit.
2.  Content image upload: `POST /api/internal/storage/content-images/presign` -> PUT -> `POST /api/internal/storage/content-images` commit.
3.  Download URL: `GET /api/internal/storage/*/presign?path=...`.
4.  Legacy relay upload remains for compatibility fallback.

#### React Hook Integration

Hook/service:

- Avatar: `lib/hooks/use-avatar-upload.ts`
- Content image: `lib/services/content-image-upload-service.ts`
- Both default to presign + commit and fallback to legacy relay path.

## Row-Level Security (RLS) Policies

The system uses Row-Level Security policies to ensure data security:

1.  `conversations` and `messages` tables:
    - Users can only view, create, update, and delete their own conversations and messages.
    - Access to messages is controlled through the associated conversation.

2.  Admin-only tables:
    - The `api_keys`, `providers`, and `service_instances` tables are only accessible to administrators.
    - Regular users cannot access these tables.

## Admin Functions

### Admin Role

The admin role has special permissions to manage sensitive resources like API keys, service providers, and service instances. The system protects admin functions through multiple security layers.

### Security Functions

#### Admin Permission Check

```sql
-- Checks if the current user is an admin
public.is_admin() RETURNS BOOLEAN
```

This function is used in all operations requiring admin privileges to ensure only admins can perform sensitive actions.

#### User Statistics

```sql
-- Gets user statistics (admin access only)
public.get_user_stats() RETURNS JSON
```

Returns a JSON object containing the following information:

- `totalUsers`: Total number of users
- `activeUsers`: Number of active users
- `suspendedUsers`: Number of suspended users
- `pendingUsers`: Number of pending users
- `adminUsers`: Number of admin users
- `managerUsers`: Number of manager users
- `regularUsers`: Number of regular users
- `newUsersToday`: Number of new users today
- `newUsersThisWeek`: Number of new users this week
- `newUsersThisMonth`: Number of new users this month

#### Batch User Management

```sql
-- Secure batch role update
public.safe_batch_update_role(target_user_ids UUID[], target_role user_role) RETURNS INTEGER
```

**Security Features:**

- **Permission Verification**: Only admins can execute.
- **Self-Protection**: Cannot include oneself in the batch operation.
- **Admin Protection**: Cannot demote other admins.
- **Atomicity**: All updates are completed in a single transaction.
- **Returns** the number of successfully updated users.

### Admin Setup Function

The system provides an SQL function to set a user as an administrator:

```sql
public.initialize_admin(admin_email TEXT)
```

#### Parameters

- `admin_email`: The email address of the user to be set as an admin.

#### Return Value

- No return value (VOID)

#### Usage Example

```sql
-- Sets the user with the specified email as an admin
SELECT public.initialize_admin('user@example.com');
```

#### Function Behavior

1.  Looks up the user ID in the `auth.users` table based on the provided email address.
2.  If the user does not exist, it throws an exception.
3.  If the user exists, it updates the `role` field for the corresponding user in the `profiles` table to `'admin'`.
4.  Outputs a notice message confirming the user has been set as an admin.

#### Latest Fix (2025-06-22)

**Fixed Issues**:

- ✅ **Initialization Permission Issue**: Fixed the issue where the first admin could not be created during system initialization.
- ✅ **Smart Permission Check**: The function now only allows the creation of the first admin if there are no admins in the system.
- ✅ **Security Maintained**: Once there is an admin in the system, all original permission check mechanisms remain fully intact.

**Technical Implementation**:

- Modified the `validate_role_update` trigger function to add system initialization check logic.
- Before the permission check, it first checks if any admins exist in the system (`admin_count = 0`).
- Has zero impact on existing systems, only taking effect during the initialization phase.

**Security Guarantee**:

- Only allows the creation of the first admin when there are absolutely no admins in the system.
- Once any admin exists, all permission check mechanisms work as normal.
- Malicious users cannot bypass permission checks, ensuring the system's security is fully guaranteed.

### Admin Permission Verification

The front-end application verifies if the current user has admin permissions using the `useAdminAuth` Hook:

```typescript
const { isAdmin, isLoading, error } = useAdminAuth();

// Usage example
if (!isAdmin) return <AccessDenied />;
```

### Database Security Mechanisms

#### Trigger Protections

1.  **Role Update Protection Trigger**:

    ```sql
    CREATE TRIGGER validate_role_update_trigger
      BEFORE UPDATE OF role ON profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_role_update();
    ```

2.  **User Deletion Protection Trigger**:

    ```sql
    CREATE TRIGGER validate_user_deletion_trigger
      BEFORE DELETE ON profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_user_deletion();
    ```

#### View-Level Security

The user management system ensures security through the following mechanisms:

1.  **Permission Checks**: All management functions have built-in admin permission verification.
2.  **Data Isolation**: Row-level data isolation is achieved through RLS policies.
3.  **Sensitive Data Access**: Uses dedicated functions to securely access the `auth.users` table.
4.  **Front-end Verification**: Verifies admin identity through middleware.

#### Best Practices

1.  **Principle of Least Privilege**: Each user can only access data within their permission scope.
2.  **Defensive Programming**: All management functions include permission verification.
3.  **Audit Trails**: Important operations have corresponding logs and notifications.
4.  **Data Integrity**: Uses triggers to prevent dangerous operations.

## Dify Integration

The system integrates with the Dify AI platform, and the related data structures include:

1.  Additions to the `conversations` table:
    - `external_id`: Stores the session ID from Dify.
    - `app_id`: The associated Dify application ID.
    - `last_message_preview`: A preview of the last message for display in the sidebar.

2.  Additions to the `messages` table:
    - `external_id`: The message ID from Dify.
    - `token_count`: The token count of the message, used for usage statistics.
    - `is_synced`: Whether the message has been synchronized to Dify.

3.  Initialize Dify configuration data:
    - Create a Dify provider record in the `providers` table.
    - Create a default service instance in the `service_instances` table.
    - Store the API key in the `api_keys` table.

## Important Notes

1.  Setting an administrator is a sensitive operation and should only be performed by a system administrator.
2.  Admin users can access and modify sensitive system configurations, such as API keys.
3.  Ensure that the admin setup function is used with caution in a production environment.
4.  Sensitive information like API keys should be stored securely to prevent leakage.

## Database Triggers and Automation

The system uses several triggers to implement automation and data integrity protection:

### User Management Triggers

1.  **User Registration Trigger** (`handle_new_user`):
    - Automatically creates a `profiles` record when a new user registers.
    - Prioritizes the `username` provided by the user; if empty, generates a default value (format: `user_first8charsOfUUID`).
    - Automatically syncs user metadata (`full_name`, `avatar_url`, etc.).

2.  **Pre-User Deletion Handler** (`handle_user_deletion_prep`):
    - Handles the transfer of organization permissions before a user is deleted.
    - If the user is an organization owner, automatically transfers ownership to another admin or member.
    - Ensures an organization does not become orphaned due to the owner's deletion.

### Organization Management Triggers

1.  **Post-Org Member Deletion Cleanup** (`handle_org_member_deletion`):
    - Checks if the organization has other members after an org member is deleted.
    - If there are no other members, automatically deletes the orphan organization and its related data.
    - Automatically cleans up associated data like `ai_configs` through cascade deletion.

2.  **Org Member Operation Validation** (`validate_org_member_operations`):
    - Ensures the last owner of an organization is not removed.
    - Protects the basic management structure of the organization.

### Message Management Triggers

1.  **Message Sync Status Maintenance** (`set_message_synced_on_update`):
    - Automatically maintains the sync status and timestamp of messages.
    - Ensures data consistency with external systems (like Dify).

2.  **Conversation Preview Update** (`update_conversation_last_message_preview`):
    - Automatically refreshes the `conversations.last_message_preview` field when a new message is inserted or updated.
    - Ensures real-time display on the front-end without manual maintenance.

### Data Cleanup and Maintenance

The system provides dedicated maintenance functions:

1.  **Orphan Data Cleanup** (`cleanup_orphan_data`):
    - Cleans up organizations with no members.
    - Cleans up orphan AI configurations.
    - Cleans up orphan messages that do not belong to any conversation.

2.  **Safe Batch Cleanup** (`safe_cleanup_orphan_data`):
    - Supports a `dry_run` mode to preview cleanup results.
    - A safe cleanup operation with transaction control.

## Row-Level Security (RLS) Updates

### API Configuration Access Policies

To support server-side API routes accessing Dify configurations, the RLS policies for the following tables have been updated:

1.  **`providers` Table**:
    - Admins can perform all operations.
    - Allows server-side (unauthenticated requests) and authenticated users to read provider information.

2.  **`service_instances` Table**:
    - Admins can perform all operations.
    - Allows server-side and authenticated users to read service instance information.

3.  **`api_keys` Table**:
    - Admins can perform all operations.
    - Allows server-side and authenticated users to read API keys (read-only, cannot modify).

4.  **`department_app_permissions` Table**:
    - Users can only view the app permissions of their own department.
    - Organization admins can manage the app permissions of all departments.
    - Permission checks are based on the user's organization and department membership.

These policies ensure that API routes can properly access Dify configurations while maintaining appropriate security controls.

## Related Migration Files

The database structure and functions are defined in the following migration files:

### Basic Structure

- `/supabase/migrations/20250501000000_init.sql`: Initializes basic table structures and enum types.
- `/supabase/migrations/20250502000000_sso_config.sql`: SSO authentication configuration.

### User and Permission Management

- `/supabase/migrations/20250508134000_create_profile_trigger.sql`: Creates user profile trigger.
- `/supabase/migrations/20250508140000_fix_profiles_schema.sql`: Fixes user profiles table structure.
- `/supabase/migrations/20250508141000_profiles_schema.sql`: Adjusts user profiles table structure.
- `/supabase/migrations/20250508174000_add_admin_role.sql`: Adds admin role and related functions.
- `/supabase/migrations/20250524193208_fix_username_sync.sql`: Fixes username sync logic.
- `/supabase/migrations/20250524195000_fix_profiles_foreign_key.sql`: Fixes profiles table foreign key constraint.
- `/supabase/migrations/20250524200000_fix_user_deletion_trigger.sql`: Fixes user deletion trigger.
- `/supabase/migrations/20250527180000_fix_org_members_rls_recursion.sql`: Fixes organization members RLS recursion issue.
- `/supabase/migrations/20250529153000_add_user_management_views.sql`: Adds user management views and related functions.
- `/supabase/migrations/20250529154000_update_profiles_table.sql`: Updates profiles table, adding `auth_source` and `sso_provider_id` fields.
- `/supabase/migrations/20250529170443_fix_user_list_function.sql`: Fixes user list function.
- `/supabase/migrations/20250529170559_simplify_user_list_function.sql`: Simplifies user list query function.
- `/supabase/migrations/20250529171148_cleanup_unused_functions.sql`: Cleans up unused functions.
- `/supabase/migrations/20250530000000_fix_role_constraint.sql`: Fixes role constraint, supports `manager` role, converts to enum type.
- `/supabase/migrations/20250530010000_add_role_update_protection.sql`: Adds role update protection and user deletion protection.

### Latest Organization Permission Management System (2025-06-10)

- `/supabase/migrations/20250610120000_add_org_app_permissions.sql`: Initial organization-level permission system.
- `/supabase/migrations/20250610120001_redesign_department_permissions.sql`: Redesigned department-level permission system.
- `/supabase/migrations/20250610130000_add_department_permission_management.sql`: Adds department permission management functions.
- `/supabase/migrations/20250610133559_simplify_department_permissions.sql`: Simplifies department permission table structure.
- `/supabase/migrations/20250610140000_clean_virtual_department_permissions.sql`: Cleans virtual permission data.
- `/supabase/migrations/20250610160000_fix_organization_creation_policy.sql`: Fixes organization creation RLS policy.
- `/supabase/migrations/20250610161000_fix_org_members_policy.sql`: Fixes members table RLS policy.
- `/supabase/migrations/20250610162000_fix_infinite_recursion_policy.sql`: Fixes policy recursion issue.
- `/supabase/migrations/20250610163000_completely_fix_recursion.sql`: Completely fixes recursion issue.
- `/supabase/migrations/20250610164000_complete_rls_reset.sql`: Complete RLS policy reset.
- `/supabase/migrations/20250610165000_final_cleanup_all_policies.sql`: Final cleanup of all policies.
- `/supabase/migrations/20250610165100_cleanup_remaining_policy.sql`: Cleans up remaining policies.
- `/supabase/migrations/20250610170000_enable_multi_department_membership.sql`: Enables multi-department membership support.
- `/supabase/migrations/20250610180000_fix_organization_select_for_users.sql`: Fixes organization view permission for regular users.

### User Management Security Mechanisms (2025-06-01)

- `/supabase/migrations/20250601000100_fix_user_view_security.sql`: Fixes user management view security issue, deletes insecure views, creates secure management functions.
- `/supabase/migrations/20250601000200_fix_user_functions_quick.sql`: Quick fix for user management function structure issues.
- `/supabase/migrations/20250601000500_restore_admin_user_view.sql`: Recreates a secure admin user view (using `security_invoker`).
- `/supabase/migrations/20250601000600_fix_view_permissions.sql`: Fixes view permission issues, reverts to `SECURITY DEFINER` mode.
- `/supabase/migrations/20250609214200_remove_deprecated_admin_views.sql`: Finally removes deprecated admin views.

### API Key Management

- `/supabase/migrations/20250508165500_api_key_management.sql`: API key management.
- `/supabase/migrations/20250508181700_fix_api_keys_schema.sql`: Fixes API keys table structure.
- `/supabase/migrations/20250508182400_fix_api_key_encryption.sql`: Fixes API key encryption.
- `/supabase/migrations/20250508183400_extend_service_instances.sql`: Extends service instances table.
- `/supabase/migrations/20250524230000_fix_dify_config_rls.sql`: Fixes RLS policies for Dify configuration related tables.
- `/supabase/migrations/20250529151826_ensure_default_service_instance_constraint.sql`: Ensures uniqueness constraint for default service instances.
- `/supabase/migrations/20250529151827_add_set_default_service_instance_function.sql`: Adds stored procedure to set default service instance.

### Conversation and Message Management

- `/supabase/migrations/20250513104549_extend_conversations_messages.sql`: Extends conversations and messages tables.
- `/supabase/migrations/20250515132500_add_metadata_to_conversations.sql`: Adds metadata field to conversations table.
- `/supabase/migrations/20250521125100_add_message_trigger.sql`: Adds triggers to `messages` table to auto-maintain sync status and `last_message_preview`.
- `/supabase/migrations/20250522193000_update_message_preview_format.sql`: Adjusts `conversations.last_message_preview` field to JSONB format.

### Data Integrity and Cleanup

- `/supabase/migrations/20250524194000_improve_cascade_deletion.sql`: Improves cascade deletion logic to handle orphan organizations and AI config issues.

### Application Execution Record Management

- `/supabase/migrations/20250601124105_add_app_executions_table.sql`: Adds application execution records table, supporting execution history management for workflows and text generation apps.

### Department Application Permission Management

- `/supabase/migrations/20250610120000_add_org_app_permissions.sql`: Initial organization-level permission system (has been replaced).
- `/supabase/migrations/20250610120001_redesign_department_permissions.sql`: Redesigned department-level permission system, implementing precise department-level app permission control.
- `/supabase/migrations/20250610130000_add_department_permission_management.sql`: Adds department permission management functions and sync tools.
- `/supabase/migrations/20250610140000_clean_virtual_department_permissions.sql`: **Clears virtual permission data to ensure only manually configured permission records exist.**

### CAS SSO Integration (2025-06-17)

- `/supabase/migrations/20250617185201_fix_enum_transaction_issue.sql`: Fixes PostgreSQL enum type transaction issue, adds CAS protocol support to `sso_protocol` enum.
- `/supabase/migrations/20250617185202_add_cas_sso_data.sql`: Complete CAS SSO integration, including:
  - Adding `employee_number` field to the `profiles` table.
  - Creating `find_user_by_employee_number` function for SSO user lookup.
  - Creating `create_sso_user` function for automatic SSO user creation.
  - Inserting generic CAS provider configuration data.
- `/supabase/migrations/20250617190000_drop_sso_views.sql`: Cleans up SSO statistics views, simplifying database objects.

### 2025-06-18 SSO Type Fix - UUID Type Conversion Issue

- `/supabase/migrations/20250618160000_fix_sso_uuid_type_conversion.sql`: Fixes the UUID type conversion issue in the `create_sso_user` function, ensuring the SSO user creation feature works correctly.

### 2025-06-20 SSO Configuration Management System Extension - Dynamic SSO Configuration and Protocol Templates

- `/supabase/migrations/20250620131421_extend_sso_providers_table.sql`: Extends the SSO provider table, adding UI configuration fields and a protocol template system to support dynamic SSO configuration management.

  **Major Feature Enhancements:**
  - **UI Configuration Fields**: Adds `display_order` and `button_text` fields to support login page button sorting and custom text.
  - **Unified Configuration Structure**: Refactors the `settings` field into a standardized JSONB structure with `protocol_config`, `security`, and `ui` sections.
  - **Backward Compatibility**: Automatically migrates existing CAS configurations to the new unified structure, ensuring a seamless upgrade.
  - **Admin Permission Control**: Enables RLS on the protocol template table to ensure only admins can access and manage protocol templates.

### 2025-06-27 SSO Protocol Template Refactor - TypeScript Configuration Management

- `/supabase/migrations/20250627000001_remove_protocol_templates_typescript_refactor.sql`: Deletes the SSO protocol templates table, switching to management via a TypeScript configuration file.

  **Refactor Features:**
  - **TypeScript Configuration Management**: Migrates protocol templates from the database to a TypeScript configuration file (`@lib/config/sso-protocol-definitions.ts`).
  - **Type Safety Guarantee**: Provides compile-time type checking through TypeScript interfaces, avoiding runtime configuration errors.
  - **Simplified System Architecture**: Removes database table dependency, reducing system complexity and improving maintenance efficiency.
  - **Optimized Development Experience**: Configuration changes no longer require database migrations and support version control and code review.
  - **Secure Migration**: Includes complete existence checks and cleanup validation to ensure a safe and reliable migration process.

### 2025-07-09 SSO Secure Access Fix - Login Page Permission Issue

- `/supabase/migrations/20250709101517_fix_sso_login_secure_complete.sql`: Fixes SSO login page access issues, providing complete settings while filtering sensitive information.

  **Fix Features:**
  - **Security Function Enhancement**: Added `filter_sensitive_sso_settings()` function to filter sensitive configuration information.
  - **Public SSO Providers**: Created `get_public_sso_providers()` function to allow anonymous users to fetch the SSO list.
  - **Server-side Configuration**: Added `get_sso_provider_config()` function to provide complete configuration for server-side APIs.
  - **Protocol Filtering**: Implemented `get_enabled_sso_providers()` function to support filtering by protocol.
  - **Permission Settings**: Complete permission configuration supporting `anon`, `authenticated`, and `service_role` roles.
  - **Compatibility View**: Created `public_sso_providers` view to ensure front-end compatibility.
  - **Sensitive Information Protection**: Automatically removes sensitive configuration items like client secret and client ID.

### 2025-06-30 Architecture Simplification - Group Permission System Migration

- `/supabase/migrations/20250630021741_migrate_to_groups_system.sql`: Migrates from a complex organization + department architecture to a simplified group permission system.

  **Architecture Refactor Features:**
  - **Remove Complex Architecture**: Removes `organizations`, `org_members`, `department_app_permissions` tables and related enums.
  - **Create Group System**: Adds three core tables: `groups`, `group_members`, `group_app_permissions`.
  - **Simplify Permissions**: Simplifies from a three-tier permission model (system-organization-department) to a two-tier model (system-group).
  - **Update Visibility**: Changes `service_instances.visibility` from 'org_only' to 'group_only'.
  - **Refactor Functions**: Updates permission check functions to simplify logic.
  - **Rebuild RLS Policies**: Creates new Row-Level Security policies for the new group tables.
  - **Admin Control**: Group functionality is available only to admins, not visible to regular users.
  - **Data Security**: Complete transaction control ensures data consistency during migration.

  **Permission Model Comparison:**

  ```
  Old Architecture: public | org_only (organization + department) | private
  New Architecture: public | group_only (group members) | private (admins)
  ```

  **Migration Impact:**
  - **Database Layer**: Complete refactoring of permission table structures.
  - **Backend Service**: Update of permission checking logic.
  - **Front-end Components**: Simplification of permission management interface.
  - **User Experience**: More intuitive group permission concept.

### 2025-06-24 RLS Security Enhancement - API Table Row-Level Security Policy Check

- `/supabase/migrations/20250624090857_ensure_rls_enabled_for_api_tables.sql`: Ensures RLS is enabled for API-related tables with smart checks and conditional enabling.

  **Migration Features:**
  - **Smart Check Mechanism**: Uses PostgreSQL system table `pg_tables` to dynamically check RLS status.
  - **Conditional Execution Logic**: Enables RLS only when needed, avoiding repetitive operations and errors.
  - **Complete Validation Process**: Automatically validates the RLS status of all tables post-migration and outputs a report.
  - **Security Guarantee**: Ensures data security for `api_keys`, `service_instances`, and `providers` tables.
  - **Operations-Friendly Design**: Detailed `NOTICE` messages facilitate monitoring and troubleshooting.

  **Validation Result**: RLS status for all API-related tables is true, security policies are correctly enabled.

### 2025-07-12 Message Table Optimization - Add `sequence_index` field and index

- `/supabase/migrations/20250712133249_add_sequence_index_column.sql`: Adds a `sequence_index` field and related composite indexes to the `messages` table. Low risk, supports high-performance sorting and stable pagination.

## Migration File Notes

### User Management System Evolution

The user management system has undergone several security enhancements:

1.  **Initial Implementation** (20250529153000): Created basic user management views and functions.
2.  **Security Issue Discovery** (20250601000100): Supabase issued a security warning as the original view exposed `auth.users` data.
3.  **Function-based Approach Attempt** (20250601000200): Attempted to replace views with secure functions but encountered structure matching problems.
4.  **View Rebuild** (20250601000500): Recreated a secure view using `security_invoker` mode.
5.  **Permission Fix** (20250601000600): Discovered permission issues and reverted to `SECURITY DEFINER` mode.

### SSO System Evolution

The SSO system evolved from a basic implementation to a robust secure access mechanism:

1.  **Basic SSO Implementation** (20250617185202): Added CAS SSO support and user management functions.
2.  **Type Fix** (20250618160000): Fixed UUID type conversion issue.
3.  **Dynamic Configuration** (20250620131421): Extended the SSO provider table to support UI configuration.
4.  **Architecture Simplification** (20250627000001): Removed database protocol templates, switching to TypeScript configuration.
5.  **Secure Access** (20250709101517): Added security functions to resolve login page permission issues.

### Final Security Solution

The user management system employs the following security mechanisms:

- **Function-level Permission Validation**: All management functions include permission checks.
- **RLS Policy Protection**: Database-level row-level security control.
- **Middleware Validation**: Front-end route-level admin identity verification.
- **Full Functionality Retention**: Admins can securely access user data and sensitive information.

SSO secure access mechanism:

- **Sensitive Information Filtering**: Automatically filters sensitive configurations like client secrets.
- **Layered Permissions**: Differentiates between anonymous, authenticated user, and server-side permissions.
- **Security Functions**: Uses `SECURITY DEFINER` to ensure secure execution.
- **Compatibility Guarantee**: Provides both view and function access methods.

### Permission Protection Mechanisms

The system ensures security through multiple layers of protection:

1.  **Trigger Protection**: Prevents dangerous role operations and user deletions.
2.  **Function-level Validation**: All management functions include permission checks.
3.  **View-level Isolation**: Non-admin queries return empty results.
4.  **Batch Operation Security**: Includes self-protection and admin protection mechanisms.
5.  **SSO Sensitive Information Protection**: Automatically filters sensitive configurations to ensure login page security.
