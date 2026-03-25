import type {
  ApiKeyRow,
  AppExecutionRow,
  ConversationRow,
  GroupMemberRow,
  GroupPermissionRow,
  MessageRow,
  ProfileRow,
  ProviderRow,
  ServiceInstanceRow,
  SsoProviderRow,
} from '../types';
import {
  LOCAL_PROFILE_AUTH_SOURCES,
  PROFILE_ALWAYS_EDITABLE_COLUMNS,
  PROFILE_LOCAL_ONLY_EDITABLE_COLUMNS,
} from '../types';

export function sanitizeConversation(row: ConversationRow): ConversationRow {
  return {
    ...row,
    settings: row.settings || {},
    metadata: row.metadata || {},
  };
}

export function sanitizeMessage(row: MessageRow): MessageRow {
  return {
    ...row,
    metadata: row.metadata || {},
    status: row.status || 'sent',
    is_synced: row.is_synced ?? true,
    sequence_index: row.sequence_index ?? 0,
  };
}

export function sanitizeExecution(row: AppExecutionRow): AppExecutionRow {
  const parsedElapsed =
    row.elapsed_time === null || row.elapsed_time === undefined
      ? null
      : Number(row.elapsed_time);

  return {
    ...row,
    inputs: row.inputs || {},
    outputs: row.outputs || null,
    metadata: row.metadata || {},
    total_steps: Number(row.total_steps || 0),
    total_tokens: Number(row.total_tokens || 0),
    elapsed_time: Number.isFinite(parsedElapsed) ? parsedElapsed : null,
  };
}

export function normalizeAuthSource(source: string | null | undefined): string {
  return (source || 'native').trim().toLowerCase() || 'native';
}

export function isIdpManagedAuthSource(
  source: string | null | undefined
): boolean {
  return !LOCAL_PROFILE_AUTH_SOURCES.has(normalizeAuthSource(source));
}

export function resolveEditableProfileColumns(
  source: string | null | undefined
): Set<string> {
  const editable = new Set(PROFILE_ALWAYS_EDITABLE_COLUMNS);
  if (!isIdpManagedAuthSource(source)) {
    for (const column of PROFILE_LOCAL_ONLY_EDITABLE_COLUMNS) {
      editable.add(column);
    }
  }
  return editable;
}

export function sanitizeProfileRow(row: ProfileRow): Record<string, unknown> {
  const normalizedAuthSource = normalizeAuthSource(row.auth_source);
  const editableFields = Array.from(
    resolveEditableProfileColumns(normalizedAuthSource)
  ).sort();
  const hasExternalProfile =
    Boolean(row.source_issuer) ||
    Boolean(row.source_provider) ||
    Boolean(row.department_name) ||
    Boolean(row.department_code) ||
    Boolean(row.department_path) ||
    Boolean(row.job_title) ||
    Boolean(row.cost_center) ||
    Boolean(row.employment_type) ||
    Boolean(row.manager_employee_number) ||
    Boolean(row.manager_name) ||
    Boolean(row.phone_e164) ||
    Boolean(row.office_location) ||
    Boolean(row.hire_date) ||
    Boolean(row.external_synced_at) ||
    Boolean(row.external_last_seen_at);

  return {
    id: row.id,
    email: row.email || null,
    phone: row.phone || null,
    email_confirmed_at: null,
    phone_confirmed_at: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_sign_in_at: row.last_login,
    full_name: row.full_name || null,
    username: row.username || null,
    avatar_url: row.avatar_url || null,
    role: row.role || 'user',
    status: row.status || 'active',
    auth_source: normalizedAuthSource,
    is_idp_managed: isIdpManagedAuthSource(normalizedAuthSource),
    editable_fields: editableFields,
    sso_provider_id: row.sso_provider_id || null,
    employee_number: row.employee_number || null,
    external_profile: hasExternalProfile
      ? {
          source_issuer: row.source_issuer || null,
          source_provider: row.source_provider || null,
          employee_number: row.employee_number || null,
          department_code: row.department_code || null,
          department_name: row.department_name || null,
          department_path: row.department_path || null,
          cost_center: row.cost_center || null,
          job_title: row.job_title || null,
          employment_type: row.employment_type || null,
          manager_employee_number: row.manager_employee_number || null,
          manager_name: row.manager_name || null,
          phone_e164: row.phone_e164 || null,
          office_location: row.office_location || null,
          hire_date: row.hire_date || null,
          attributes: row.external_attributes || {},
          locked: row.external_locked ?? true,
          synced_at: row.external_synced_at || null,
          last_seen_at: row.external_last_seen_at || null,
        }
      : null,
    profile_created_at: row.created_at,
    profile_updated_at: row.updated_at,
    last_login: row.last_login,
  };
}

export function sanitizeGroupMemberRow(
  row: GroupMemberRow
): Record<string, unknown> {
  return {
    id: row.id,
    group_id: row.group_id,
    user_id: row.user_id,
    created_at: row.created_at,
    user: row.profile_id
      ? {
          id: row.profile_id,
          username: row.profile_username || null,
          full_name: row.profile_full_name || null,
          email: row.profile_email || null,
        }
      : undefined,
  };
}

export function sanitizeGroupPermissionRow(
  row: GroupPermissionRow
): Record<string, unknown> {
  return {
    id: row.id,
    group_id: row.group_id,
    service_instance_id: row.service_instance_id,
    is_enabled: row.is_enabled,
    usage_quota:
      row.usage_quota === null || row.usage_quota === undefined
        ? null
        : Number(row.usage_quota),
    used_count: Number(row.used_count || 0),
    created_at: row.created_at,
    app: row.app_id
      ? {
          id: row.app_id,
          display_name: row.app_display_name || null,
          instance_id: row.app_instance_id || '',
          visibility: row.app_visibility || 'public',
        }
      : undefined,
  };
}

export function sanitizeProviderRow(row: ProviderRow): ProviderRow {
  return {
    ...row,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sanitizeServiceInstanceRow(
  row: ServiceInstanceRow
): ServiceInstanceRow {
  return {
    ...row,
    display_name: row.display_name || null,
    description: row.description || null,
    visibility: row.visibility || 'public',
    config: row.config || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sanitizeApiKeyRow(row: ApiKeyRow): ApiKeyRow {
  return {
    ...row,
    provider_id: row.provider_id || null,
    service_instance_id: row.service_instance_id || null,
    user_id: row.user_id || null,
    usage_count: Number(row.usage_count || 0),
    last_used_at: row.last_used_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sanitizeSsoProviderRow(row: SsoProviderRow): SsoProviderRow {
  return {
    ...row,
    protocol: row.protocol || 'OIDC',
    settings: row.settings || {},
    client_id: row.client_id || null,
    client_secret: row.client_secret || null,
    metadata_url: row.metadata_url || null,
    enabled: Boolean(row.enabled),
    display_order: Number(row.display_order || 0),
    button_text: row.button_text || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
