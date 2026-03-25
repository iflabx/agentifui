import type { ApiRuntimeConfig } from '../../config';

export interface InternalDataRoutesOptions {
  config: ApiRuntimeConfig;
}

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'error';
export type ExecutionType = 'workflow' | 'text-generation';
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'deleted';
export type UserRole = 'admin' | 'manager' | 'user';
export type AccountStatus = 'active' | 'suspended' | 'pending';
export type AppVisibility = 'public' | 'group_only' | 'private';
export type SsoProtocol = 'CAS' | 'SAML' | 'OAuth2' | 'OIDC';

export type InternalActionRequest = {
  action?: string;
  payload?: Record<string, unknown> | undefined;
};

export type ApiActionResponse = {
  statusCode: number;
  payload: unknown;
  contentType: string;
  handler: 'local';
};

export interface ConversationRow {
  id: string;
  user_id: string;
  ai_config_id: string | null;
  title: string;
  summary: string | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: string;
  external_id: string | null;
  app_id: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string | null;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  status: string | null;
  external_id: string | null;
  token_count: number | null;
  is_synced: boolean | null;
  sequence_index: number | null;
}

export interface AppExecutionRow {
  id: string;
  user_id: string;
  service_instance_id: string;
  execution_type: string;
  external_execution_id: string | null;
  task_id: string | null;
  title: string;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  total_steps: number | null;
  total_tokens: number | null;
  elapsed_time: number | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  status: string | null;
  auth_source: string | null;
  sso_provider_id: string | null;
  employee_number: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  source_issuer?: string | null;
  source_provider?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  department_path?: string | null;
  cost_center?: string | null;
  job_title?: string | null;
  employment_type?: string | null;
  manager_employee_number?: string | null;
  manager_name?: string | null;
  phone_e164?: string | null;
  office_location?: string | null;
  hire_date?: string | null;
  external_attributes?: Record<string, unknown> | null;
  external_locked?: boolean | null;
  external_synced_at?: string | null;
  external_last_seen_at?: string | null;
}

export interface GroupMembershipSummaryRow {
  user_id: string;
  joined_at: string;
  group_id: string;
  group_name: string;
  group_description: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
}

export interface GroupMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  profile_id: string | null;
  profile_username: string | null;
  profile_full_name: string | null;
  profile_email: string | null;
}

export interface GroupPermissionRow {
  id: string;
  group_id: string;
  service_instance_id: string;
  is_enabled: boolean;
  usage_quota: number | null;
  used_count: number;
  created_at: string;
  app_id: string | null;
  app_display_name: string | null;
  app_instance_id: string | null;
  app_visibility: string | null;
}

export interface ProviderRow {
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

export interface ServiceInstanceRow {
  id: string;
  provider_id: string;
  display_name: string | null;
  description: string | null;
  instance_id: string;
  api_path: string;
  is_default: boolean;
  visibility: string;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyRow {
  id: string;
  provider_id: string | null;
  service_instance_id: string | null;
  user_id: string | null;
  key_value: string;
  is_default: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SsoProviderRow {
  id: string;
  name: string;
  protocol: string;
  settings: Record<string, unknown> | null;
  client_id: string | null;
  client_secret: string | null;
  metadata_url: string | null;
  enabled: boolean;
  display_order: number;
  button_text: string | null;
  created_at: string;
  updated_at: string;
}

export const INTERNAL_DATA_HANDLER_HEADER = 'x-agentifui-internal-data-handler';

export const LOCAL_MESSAGE_STATUSES = new Set<MessageStatus>([
  'sent',
  'delivered',
  'error',
]);

export const LOCAL_CONVERSATION_ACTIONS = new Set([
  'conversations.getConversationByExternalId',
  'conversations.createConversation',
  'conversations.getUserConversations',
  'conversations.renameConversation',
  'conversations.deleteConversation',
]);

export const LOCAL_MESSAGE_ACTIONS = new Set([
  'messages.getLatest',
  'messages.findDuplicate',
  'messages.save',
  'messages.createPlaceholder',
]);

export const LOCAL_APP_EXECUTION_ACTIONS = new Set([
  'appExecutions.getUserExecutions',
  'appExecutions.getByServiceInstance',
  'appExecutions.getById',
  'appExecutions.create',
  'appExecutions.updateStatus',
  'appExecutions.updateComplete',
  'appExecutions.delete',
]);

export const LOCAL_GROUP_AUTH_ACTIONS = new Set([
  'groups.getUserAccessibleApps',
  'groups.checkUserAppPermission',
  'groups.incrementAppUsage',
]);

export const LOCAL_USER_ACTIONS = new Set([
  'users.getUserList',
  'users.getUserStats',
  'users.getUserById',
  'users.updateUserProfile',
  'users.deleteUser',
  'users.createUserProfile',
  'users.batchUpdateUserStatus',
  'users.batchUpdateUserRole',
]);

export const LOCAL_GROUP_ADMIN_ACTIONS = new Set([
  'groups.getGroups',
  'groups.createGroup',
  'groups.updateGroup',
  'groups.deleteGroup',
  'groups.getGroupMembers',
  'groups.addGroupMember',
  'groups.removeGroupMember',
  'groups.getGroupAppPermissions',
  'groups.setGroupAppPermission',
  'groups.removeGroupAppPermission',
  'groups.removeAllGroupAppPermissions',
  'groups.searchUsersForGroup',
]);

export const LOCAL_PROVIDER_ACTIONS = new Set([
  'providers.getAllProviders',
  'providers.getActiveProviders',
  'providers.createProvider',
  'providers.updateProvider',
  'providers.deleteProvider',
]);

export const LOCAL_SERVICE_INSTANCE_ACTIONS = new Set([
  'serviceInstances.getByProvider',
  'serviceInstances.getById',
  'serviceInstances.create',
  'serviceInstances.update',
  'serviceInstances.delete',
  'serviceInstances.setDefault',
]);

export const LOCAL_API_KEY_ACTIONS = new Set([
  'apiKeys.getByServiceInstance',
  'apiKeys.create',
  'apiKeys.update',
  'apiKeys.delete',
]);

export const LOCAL_SSO_ACTIONS = new Set([
  'sso.getSsoProviders',
  'sso.getSsoProviderStats',
  'sso.getSsoProviderById',
  'sso.createSsoProvider',
  'sso.updateSsoProvider',
  'sso.deleteSsoProvider',
  'sso.toggleSsoProvider',
  'sso.updateSsoProviderOrder',
]);

export const LOCAL_ERROR_OBSERVABILITY_ACTIONS = new Set([
  'errors.getSummary',
  'errors.getRecent',
]);

export const ADMIN_ACTIONS = new Set([
  'users.getUserList',
  'users.getUserStats',
  'users.getUserById',
  'users.updateUserProfile',
  'users.deleteUser',
  'users.createUserProfile',
  'users.batchUpdateUserStatus',
  'users.batchUpdateUserRole',
  'groups.getGroups',
  'groups.createGroup',
  'groups.updateGroup',
  'groups.deleteGroup',
  'groups.getGroupMembers',
  'groups.addGroupMember',
  'groups.removeGroupMember',
  'groups.getGroupAppPermissions',
  'groups.setGroupAppPermission',
  'groups.removeGroupAppPermission',
  'groups.removeAllGroupAppPermissions',
  'groups.searchUsersForGroup',
  'providers.getAllProviders',
  'providers.getActiveProviders',
  'providers.createProvider',
  'providers.updateProvider',
  'providers.deleteProvider',
  'serviceInstances.getByProvider',
  'serviceInstances.getById',
  'serviceInstances.create',
  'serviceInstances.update',
  'serviceInstances.delete',
  'serviceInstances.setDefault',
  'apiKeys.getByServiceInstance',
  'apiKeys.create',
  'apiKeys.update',
  'apiKeys.delete',
  'sso.getSsoProviders',
  'sso.getSsoProviderStats',
  'sso.getSsoProviderById',
  'sso.createSsoProvider',
  'sso.updateSsoProvider',
  'sso.deleteSsoProvider',
  'sso.toggleSsoProvider',
  'sso.updateSsoProviderOrder',
  'errors.getSummary',
  'errors.getRecent',
]);

export const AUTH_ACTIONS = new Set([
  'groups.getUserAccessibleApps',
  'groups.checkUserAppPermission',
  'groups.incrementAppUsage',
  'conversations.getConversationByExternalId',
  'conversations.createConversation',
  'conversations.getUserConversations',
  'conversations.renameConversation',
  'conversations.deleteConversation',
  'messages.getLatest',
  'messages.findDuplicate',
  'messages.save',
  'messages.createPlaceholder',
  'appExecutions.getUserExecutions',
  'appExecutions.getByServiceInstance',
  'appExecutions.getById',
  'appExecutions.create',
  'appExecutions.updateStatus',
  'appExecutions.updateComplete',
  'appExecutions.delete',
]);

export const LOCAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'stopped',
  'deleted',
]);

export const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'completed',
  'failed',
  'stopped',
]);

export const LOCAL_USER_ROLES = new Set<UserRole>(['admin', 'manager', 'user']);
export const LOCAL_ACCOUNT_STATUSES = new Set<AccountStatus>([
  'active',
  'suspended',
  'pending',
]);
export const LOCAL_APP_VISIBILITIES = new Set<AppVisibility>([
  'public',
  'group_only',
  'private',
]);
export const LOCAL_SSO_PROTOCOLS = new Set<SsoProtocol>([
  'CAS',
  'SAML',
  'OAuth2',
  'OIDC',
]);

export const LOCAL_PROFILE_AUTH_SOURCES = new Set([
  '',
  'password',
  'better-auth',
  'credentials',
  'native',
]);

export const PROFILE_UPDATE_COLUMNS = new Set([
  'email',
  'phone',
  'full_name',
  'username',
  'avatar_url',
  'role',
  'status',
]);

export const PROFILE_ALWAYS_EDITABLE_COLUMNS = new Set([
  'username',
  'avatar_url',
  'role',
  'status',
]);

export const PROFILE_LOCAL_ONLY_EDITABLE_COLUMNS = new Set([
  'email',
  'phone',
  'full_name',
]);

export const USER_SORT_COLUMN_MAP: Record<string, string> = {
  created_at: 'p.created_at',
  last_sign_in_at: 'p.last_login',
  email: 'p.email',
  full_name: 'p.full_name',
};

export const SSO_SORT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  protocol: 'protocol',
  created_at: 'created_at',
  display_order: 'display_order',
};

export const SERVICE_INSTANCE_UPDATE_COLUMNS = new Set([
  'provider_id',
  'display_name',
  'description',
  'instance_id',
  'api_path',
  'is_default',
  'visibility',
  'config',
]);
