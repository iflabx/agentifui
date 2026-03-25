export const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const PG_POOL_GLOBAL_KEY = '__agentifui_pg_pool__';
export const REALTIME_BRIDGE_ENSURER_GLOBAL_KEY =
  '__agentifui_realtime_bridge_ensurer__';
export const REALTIME_PUBLISHER_GLOBAL_KEY = '__agentifui_realtime_publisher__';

export const TABLE_ACCESS_OWNERS = {
  profiles: 'managed',
  conversations: 'managed',
  messages: 'managed',
  providers: 'managed',
  service_instances: 'managed',
  api_keys: 'raw',
  app_executions: 'raw',
  user_identities: 'raw',
  profile_external_attributes: 'raw',
  sso_providers: 'raw',
  groups: 'raw',
  group_members: 'raw',
  group_app_permissions: 'raw',
  user_preferences: 'raw',
  auth_settings: 'raw',
  domain_sso_mappings: 'raw',
  auth_users: 'raw',
  auth_sessions: 'raw',
  auth_accounts: 'raw',
  auth_verifications: 'raw',
  auth_password_accounts: 'raw',
} as const;

export const REALTIME_ENABLED_TABLES = new Set([
  'profiles',
  'conversations',
  'messages',
  'providers',
  'service_instances',
  'api_keys',
]);
