/**
 * Database type definitions
 *
 * This file defines TypeScript types corresponding to database table structures.
 * All code interacting with the database should use these types to ensure type safety.
 */

// Enum types
export type UserRole = 'admin' | 'manager' | 'user';
export type AccountStatus = 'active' | 'suspended' | 'pending';
// export type OrgMemberRole = 'owner' | 'admin' | 'member'; // Removed: organization member roles are no longer used
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'error';

// SSO protocol types, now supporting CAS, SAML, OAuth2, and OIDC
export type SsoProtocol = 'CAS' | 'SAML' | 'OAuth2' | 'OIDC';

// Application execution related enums
// Used for workflow and text-generation app execution record management
export type ExecutionType = 'workflow' | 'text-generation';
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'deleted';

// User Profile interface, with employee_number field for SSO user management
export interface Profile {
  id: string;
  email?: string;
  full_name?: string | null;
  username?: string;
  avatar_url?: string | null;
  auth_source: string;
  phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  created_at: string;
  updated_at: string;
  role: UserRole;
  status: AccountStatus;
  last_login: string | null;
  sso_provider_id: string | null;
  employee_number?: string | null; // New: employee number for SSO user identification
}

export interface UserPreference {
  id: string;
  user_id: string;
  theme: string;
  language: string;
  notification_settings: Record<string, unknown>;
  ai_preferences: Record<string, unknown>;
  updated_at: string;
}

// Group permission management - simplified permission system
// Replaces complex organization structure with a simple group concept
export type AppVisibility = 'public' | 'group_only' | 'private';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
}

export interface GroupAppPermission {
  id: string;
  group_id: string;
  service_instance_id: string;
  is_enabled: boolean;
  usage_quota: number | null; // NULL means unlimited
  used_count: number;
  created_at: string;
}

// Conversation and message types
export interface Conversation {
  id: string;
  user_id: string;
  ai_config_id: string | null;
  title: string;
  summary: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status: string;
  // The following fields are for Dify integration:
  // external_id: Dify conversation ID
  // app_id: associated Dify app ID
  // last_message_preview: preview of the last message for sidebar display
  // metadata: stores extra metadata, such as pin status, etc.
  external_id: string | null;
  app_id: string | null;
  last_message_preview: string | null;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string | null;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  status: MessageStatus;
  // The following fields are for Dify integration:
  // external_id: Dify message ID
  // token_count: number of tokens in the message, for usage statistics
  // is_synced: whether the message has been synced to Dify
  external_id: string | null;
  token_count: number | null;
  is_synced: boolean;
  /**
   * Message sequence index: 0=user, 1=assistant, 2=system, etc.
   * Used for database-level sorting: ORDER BY created_at, sequence_index, id
   */
  sequence_index: number;
}

// API key management
export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  auth_type: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ServiceInstanceConfig type definition
// Used to standardize the structure of ServiceInstance.config
export interface ServiceInstanceConfig {
  // Dify API base URL
  api_url?: string;

  // Application metadata configuration
  app_metadata?: {
    // Application type: model switch | marketplace
    app_type?: 'model' | 'marketplace';

    // Dify app type (required field)
    // Based on Dify official API documentation's five app types
    dify_apptype?:
      | 'chatbot'
      | 'agent'
      | 'chatflow'
      | 'workflow'
      | 'text-generation';

    // Whether this is a common model (for prioritized preloading)
    is_common_model?: boolean;

    // Whether this is a marketplace app
    is_marketplace_app?: boolean;

    // App tags (for categorization and search)
    tags?: string[];

    // Model type (if this is a model app)
    model_type?: string;

    // App icon URL
    icon_url?: string;

    // App brief description
    brief_description?: string;

    // Other custom metadata
    [key: string]: unknown;
  };

  // Dify app parameter configuration (replaces API calls)
  // These parameters can now be configured directly in the database
  // Uses standard Dify API interface specification
  dify_parameters?: {
    // Opening statement configuration
    opening_statement?: string;

    // Suggested questions list
    suggested_questions?: string[];

    // File upload configuration
    file_upload?: {
      image?: {
        enabled: boolean;
        number_limits: number;
        transfer_methods: ('remote_url' | 'local_file')[];
      };
      document?: {
        enabled: boolean;
        number_limits: number;
        transfer_methods: ('remote_url' | 'local_file')[];
      };
      audio?: {
        enabled: boolean;
        number_limits: number;
        transfer_methods: ('remote_url' | 'local_file')[];
      };
      video?: {
        enabled: boolean;
        number_limits: number;
        transfer_methods: ('remote_url' | 'local_file')[];
      };
    };
  };

  // Other configuration
  [key: string]: unknown;
}

// ServiceInstance interface, with visibility field
export interface ServiceInstance {
  id: string;
  provider_id: string;
  display_name: string | null;
  description: string | null;
  instance_id: string;
  api_path: string;
  is_default: boolean;
  visibility: AppVisibility; // New field
  config: ServiceInstanceConfig;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  provider_id: string;
  service_instance_id: string | null;
  user_id: string | null;
  key_value: string;
  is_default: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// SSO provider settings type definition
// Standardized configuration for SSO provider settings field
// Unified management of protocol config, security, and UI config
export interface SsoProviderSettings {
  // Protocol configuration
  protocol_config: {
    base_url: string; // SSO server base URL
    version?: string; // Protocol version (e.g., CAS 2.0/3.0)
    timeout?: number; // Request timeout (ms)
    endpoints: {
      login: string; // Login endpoint path
      logout: string; // Logout endpoint path
      validate: string; // Ticket validation endpoint path
      validate_v3?: string; // CAS 3.0 validation endpoint (optional)
      metadata?: string; // Metadata endpoint path (for SAML)
    };
    attributes_mapping: {
      employee_id: string; // Employee ID field mapping
      username: string; // Username field mapping
      full_name: string; // Full name field mapping
      email?: string; // Email field mapping (optional)
    };
    // Protocol-specific configuration
    scope?: string; // OIDC scope parameter
    response_type?: string; // OIDC response_type parameter
    issuer?: string; // OIDC issuer URL
    entity_id?: string; // SAML entity ID
    sso_url?: string; // SAML SSO URL
  };

  // Security configuration
  security: {
    require_https: boolean; // Whether HTTPS is required
    validate_certificates: boolean; // Whether to validate SSL certificates
    allowed_redirect_hosts?: string[]; // Whitelist of allowed redirect hosts
  };

  // UI configuration
  ui: {
    icon?: string; // Button icon (emoji or image URL)
    logo_url?: string; // Organization logo image URL
    description?: string; // Detailed description text
    theme?: string; // Button theme: primary/secondary/default/outline
  };

  // Other extended configuration
  [key: string]: unknown;
}

// SSO provider interface, with display_order and button_text fields
// Supports dynamic SSO configuration management
export interface SsoProvider {
  id: string;
  name: string;
  protocol: SsoProtocol;
  settings: SsoProviderSettings; // Uses standardized config structure
  client_id: string | null; // OAuth2/OIDC client ID (reserved)
  client_secret: string | null; // OAuth2/OIDC client secret (reserved)
  metadata_url: string | null; // SAML metadata URL (reserved)
  enabled: boolean;
  display_order: number; // Login page display order
  button_text: string | null; // Login button display text
  created_at: string;
  updated_at: string;
}

// Public SSO provider view interface
// Used for secure login page access, includes full settings with sensitive info filtered
export interface PublicSsoProvider {
  id: string;
  name: string;
  protocol: SsoProtocol;
  enabled: boolean;
  display_order: number;
  button_text: string | null;
  settings: unknown; // Full settings with sensitive info filtered
  created_at: string;
}

// Data type for creating SSO provider
export interface CreateSsoProviderData {
  name: string;
  protocol: SsoProtocol;
  settings: SsoProviderSettings;
  client_id?: string | null;
  client_secret?: string | null;
  metadata_url?: string | null;
  enabled?: boolean;
  display_order?: number;
  button_text?: string | null;
}

export interface DomainSsoMapping {
  id: string;
  domain: string;
  sso_provider_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthSettings {
  id: string;
  allow_email_registration: boolean;
  allow_phone_registration: boolean;
  allow_password_login: boolean;
  require_email_verification: boolean;
  password_policy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Other tables
export interface AiConfig {
  id: string;
  org_id: string | null;
  provider: string;
  app_id: string | null;
  api_key: string;
  api_url: string;
  settings: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiLog {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  provider: string;
  endpoint: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  status_code: number | null;
  latency_ms: number | null;
  created_at: string;
}

// App execution record interface
// Used to store execution history for workflow and text-generation apps
// These app types are different from conversation apps; each execution is an independent task
export interface AppExecution {
  id: string;
  user_id: string;
  service_instance_id: string;
  execution_type: ExecutionType;
  external_execution_id: string | null; // workflow_run_id or message_id
  task_id: string | null; // Dify returned task_id (mainly for workflow)
  title: string;
  inputs: Record<string, unknown>; // Input parameters
  outputs: Record<string, unknown> | null; // Output results
  status: ExecutionStatus;
  error_message: string | null;
  total_steps: number; // Number of steps for workflow, 0 for text-generation
  total_tokens: number;
  elapsed_time: number | null; // Execution time (seconds)
  metadata: Record<string, unknown>; // Extended fields, such as tags, remarks, etc.
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// Extended info for user-accessible apps - group version
export interface UserAccessibleApp {
  service_instance_id: string;
  display_name: string | null;
  description: string | null;
  instance_id: string;
  api_path: string;
  visibility: AppVisibility;
  config: ServiceInstanceConfig;
  usage_quota: number | null;
  used_count: number;
  quota_remaining: number | null;
  group_name: string | null;
}

// App permission check result - simplified version
export interface AppPermissionCheck {
  has_access: boolean;
  // permission_level: AppPermissionLevel | null; // Removed
  quota_remaining: number | null;
  error_message: string | null;
}

export interface DatabaseTables {
  profiles: Profile;
  user_preferences: UserPreference;
  groups: Group;
  group_members: GroupMember;
  conversations: Conversation;
  messages: Message;
  providers: Provider;
  service_instances: ServiceInstance;
  api_keys: ApiKey;
  sso_providers: SsoProvider;
  domain_sso_mappings: DomainSsoMapping;
  auth_settings: AuthSettings;
  ai_configs: AiConfig;
  api_logs: ApiLog;
  app_executions: AppExecution;
  group_app_permissions: GroupAppPermission;
  user_accessible_apps: UserAccessibleApp;
  app_permission_checks: AppPermissionCheck;
}

export interface Database {
  Tables: DatabaseTables;
}
