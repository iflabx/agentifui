import type { FastifyReply, FastifyRequest } from 'fastify';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  maybeReadLegacyError,
} from '../../lib/app-error';
import { recordApiErrorEvent } from '../../lib/error-events';
import {
  type AccountStatus,
  type ApiActionResponse,
  type ApiKeyRow,
  type AppExecutionRow,
  type AppVisibility,
  type ConversationRow,
  type ExecutionStatus,
  type ExecutionType,
  type GroupMemberRow,
  type GroupPermissionRow,
  INTERNAL_DATA_HANDLER_HEADER,
  type InternalActionRequest,
  LOCAL_ACCOUNT_STATUSES,
  LOCAL_APP_VISIBILITIES,
  LOCAL_EXECUTION_STATUSES,
  LOCAL_MESSAGE_STATUSES,
  LOCAL_PROFILE_AUTH_SOURCES,
  LOCAL_SSO_PROTOCOLS,
  LOCAL_USER_ROLES,
  type MessageRole,
  type MessageRow,
  type MessageStatus,
  PROFILE_ALWAYS_EDITABLE_COLUMNS,
  PROFILE_LOCAL_ONLY_EDITABLE_COLUMNS,
  PROFILE_UPDATE_COLUMNS,
  type ProfileRow,
  type ProviderRow,
  SERVICE_INSTANCE_UPDATE_COLUMNS,
  SSO_SORT_COLUMN_MAP,
  type ServiceInstanceRow,
  type SsoProtocol,
  type SsoProviderRow,
  USER_SORT_COLUMN_MAP,
  type UserRole,
} from './types';

export function toErrorResponse(
  message: string,
  statusCode: number
): ApiActionResponse {
  return {
    statusCode,
    contentType: 'application/json',
    payload: {
      error: message,
    },
    handler: 'local',
  };
}

export function toSuccessResponse(data: unknown): ApiActionResponse {
  return {
    statusCode: 200,
    contentType: 'application/json',
    payload: {
      success: true,
      data,
    },
    handler: 'local',
  };
}

export function toFailureResponse(error: unknown): ApiActionResponse {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown error';
  return {
    statusCode: 500,
    contentType: 'application/json',
    payload: {
      error: message,
    },
    handler: 'local',
  };
}

export function enrichResponsePayload(
  request: FastifyRequest,
  payload: unknown,
  statusCode: number,
  actorUserId?: string
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    if (statusCode >= 400) {
      const detail = buildApiErrorDetail({
        status: statusCode,
        source: 'internal-data',
        requestId: request.id,
        userMessage: 'Request failed',
      });
      void recordApiErrorEvent({
        detail,
        statusCode,
        method: request.method,
        route: request.url,
        actorUserId,
      }).catch(error => {
        request.log.warn(
          { err: error },
          '[FastifyAPI][internal-data] failed to record error event'
        );
      });
      return buildApiErrorEnvelope(detail, 'Request failed');
    }
    return payload;
  }

  const payloadObject = payload as Record<string, unknown>;
  const success = payloadObject.success;
  const legacyMessage = maybeReadLegacyError(payloadObject);
  const hasLegacyErrorMessage = legacyMessage.length > 0;
  const shouldTreatAsError =
    success === false || (statusCode >= 400 && hasLegacyErrorMessage);

  if (shouldTreatAsError) {
    if (success !== false) {
      payloadObject.success = false;
    }

    if (!payloadObject.error && hasLegacyErrorMessage) {
      payloadObject.error = legacyMessage;
    }

    if (!payloadObject.request_id) {
      payloadObject.request_id = request.id;
    }

    if (!payloadObject.app_error) {
      const resolvedMessage = legacyMessage || 'Request failed';
      const detail = buildApiErrorDetail({
        status: statusCode,
        source: 'internal-data',
        requestId: request.id,
        userMessage: resolvedMessage,
      });
      payloadObject.app_error = detail;
      void recordApiErrorEvent({
        detail,
        statusCode,
        method: request.method,
        route: request.url,
        actorUserId,
      }).catch(error => {
        request.log.warn(
          { err: error },
          '[FastifyAPI][internal-data] failed to record error event'
        );
      });
    }
    return payloadObject;
  }

  if (success === true && !payloadObject.request_id) {
    payloadObject.request_id = request.id;
  }

  return payloadObject;
}

export function sendActionResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  response: ApiActionResponse,
  actorUserId?: string
) {
  return reply
    .status(response.statusCode)
    .header('content-type', response.contentType)
    .header(INTERNAL_DATA_HANDLER_HEADER, response.handler)
    .header(REQUEST_ID_HEADER, request.id)
    .send(
      enrichResponsePayload(
        request,
        response.payload,
        response.statusCode,
        actorUserId
      )
    );
}

export function readString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function parsePositiveInt(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

export function parseMessageStatus(value: unknown): MessageStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as MessageStatus;
  if (!LOCAL_MESSAGE_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseMessageRole(value: unknown): MessageRole | null {
  if (value === 'user' || value === 'assistant' || value === 'system') {
    return value;
  }
  return null;
}

export function parseExecutionType(value: unknown): ExecutionType | null {
  if (value === 'workflow' || value === 'text-generation') {
    return value;
  }
  return null;
}

export function parseExecutionStatus(value: unknown): ExecutionStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as ExecutionStatus;
  if (!LOCAL_EXECUTION_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as UserRole;
  if (!LOCAL_USER_ROLES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseAccountStatus(value: unknown): AccountStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AccountStatus;
  if (!LOCAL_ACCOUNT_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseAppVisibility(value: unknown): AppVisibility | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AppVisibility;
  if (!LOCAL_APP_VISIBILITIES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseSsoProtocol(value: unknown): SsoProtocol | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as SsoProtocol;
  if (!LOCAL_SSO_PROTOCOLS.has(normalized)) {
    return null;
  }
  return normalized;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function readObject(
  value: unknown,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value as Record<string, unknown>;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function resolvePayloadUserId(
  payload: Record<string, unknown> | undefined
): string {
  if (!payload) {
    return '';
  }
  const userId = readString(payload.userId);
  return userId;
}

export function normalizeRequestBody(body: unknown): InternalActionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  return body as InternalActionRequest;
}

export function normalizePayload(
  body: InternalActionRequest
): Record<string, unknown> | undefined {
  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return payload;
}

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

export function buildAssistantPreview(content: string): string {
  const withoutThink = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .trim();
  const previewBase = withoutThink || content;
  if (previewBase.length <= 100) {
    return previewBase;
  }
  return `${previewBase.slice(0, 100)}...`;
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

export function normalizeNullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function encryptApiKeyValue(value: string, masterKey: string): string {
  const hash = createHash('sha256');
  hash.update(masterKey);
  const key = hash.digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
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
