import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import type { ApiRuntimeConfig } from '../config';
import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  maybeReadLegacyError,
} from '../lib/app-error';
import { recordApiErrorEvent } from '../lib/error-events';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '../lib/pg-context';
import {
  type ProfileStatusIdentity,
  resolveProfileStatusFromUpstream,
} from '../lib/upstream-session';

interface InternalDataRoutesOptions {
  config: ApiRuntimeConfig;
}

type MessageRole = 'user' | 'assistant' | 'system';
type MessageStatus = 'sent' | 'delivered' | 'error';
type ExecutionType = 'workflow' | 'text-generation';
type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'deleted';
type UserRole = 'admin' | 'manager' | 'user';
type AccountStatus = 'active' | 'suspended' | 'pending';
type AppVisibility = 'public' | 'group_only' | 'private';
type SsoProtocol = 'CAS' | 'SAML' | 'OAuth2' | 'OIDC';

type InternalActionRequest = {
  action?: string;
  payload?: Record<string, unknown> | undefined;
};

type ApiActionResponse = {
  statusCode: number;
  payload: unknown;
  contentType: string;
  handler: 'local';
};

interface ConversationRow {
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

interface MessageRow {
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

interface AppExecutionRow {
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

interface ProfileRow {
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
}

interface GroupMembershipSummaryRow {
  user_id: string;
  joined_at: string;
  group_id: string;
  group_name: string;
  group_description: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
}

interface GroupMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  profile_id: string | null;
  profile_username: string | null;
  profile_full_name: string | null;
  profile_email: string | null;
}

interface GroupPermissionRow {
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

interface ProviderRow {
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

interface ServiceInstanceRow {
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

interface ApiKeyRow {
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

interface SsoProviderRow {
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

const INTERNAL_DATA_HANDLER_HEADER = 'x-agentifui-internal-data-handler';

const LOCAL_MESSAGE_STATUSES = new Set<MessageStatus>([
  'sent',
  'delivered',
  'error',
]);

const LOCAL_CONVERSATION_ACTIONS = new Set([
  'conversations.getConversationByExternalId',
  'conversations.createConversation',
  'conversations.getUserConversations',
  'conversations.renameConversation',
  'conversations.deleteConversation',
]);

const LOCAL_MESSAGE_ACTIONS = new Set([
  'messages.getLatest',
  'messages.findDuplicate',
  'messages.save',
  'messages.createPlaceholder',
]);

const LOCAL_APP_EXECUTION_ACTIONS = new Set([
  'appExecutions.getByServiceInstance',
  'appExecutions.getById',
  'appExecutions.create',
  'appExecutions.updateStatus',
  'appExecutions.updateComplete',
  'appExecutions.delete',
]);

const LOCAL_GROUP_AUTH_ACTIONS = new Set([
  'groups.getUserAccessibleApps',
  'groups.checkUserAppPermission',
  'groups.incrementAppUsage',
]);

const LOCAL_USER_ACTIONS = new Set([
  'users.getUserList',
  'users.getUserStats',
  'users.getUserById',
  'users.updateUserProfile',
  'users.deleteUser',
  'users.createUserProfile',
  'users.batchUpdateUserStatus',
  'users.batchUpdateUserRole',
]);

const LOCAL_GROUP_ADMIN_ACTIONS = new Set([
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

const LOCAL_PROVIDER_ACTIONS = new Set([
  'providers.getAllProviders',
  'providers.getActiveProviders',
  'providers.createProvider',
  'providers.updateProvider',
  'providers.deleteProvider',
]);

const LOCAL_SERVICE_INSTANCE_ACTIONS = new Set([
  'serviceInstances.getByProvider',
  'serviceInstances.getById',
  'serviceInstances.create',
  'serviceInstances.update',
  'serviceInstances.delete',
  'serviceInstances.setDefault',
]);

const LOCAL_API_KEY_ACTIONS = new Set([
  'apiKeys.getByServiceInstance',
  'apiKeys.create',
  'apiKeys.update',
  'apiKeys.delete',
]);

const LOCAL_SSO_ACTIONS = new Set([
  'sso.getSsoProviders',
  'sso.getSsoProviderStats',
  'sso.getSsoProviderById',
  'sso.createSsoProvider',
  'sso.updateSsoProvider',
  'sso.deleteSsoProvider',
  'sso.toggleSsoProvider',
  'sso.updateSsoProviderOrder',
]);

const LOCAL_ERROR_OBSERVABILITY_ACTIONS = new Set([
  'errors.getSummary',
  'errors.getRecent',
]);

const ADMIN_ACTIONS = new Set([
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

const AUTH_ACTIONS = new Set([
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
  'appExecutions.getByServiceInstance',
  'appExecutions.getById',
  'appExecutions.create',
  'appExecutions.updateStatus',
  'appExecutions.updateComplete',
  'appExecutions.delete',
]);

const LOCAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'stopped',
  'deleted',
]);

const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'completed',
  'failed',
  'stopped',
]);

const LOCAL_USER_ROLES = new Set<UserRole>(['admin', 'manager', 'user']);
const LOCAL_ACCOUNT_STATUSES = new Set<AccountStatus>([
  'active',
  'suspended',
  'pending',
]);
const LOCAL_APP_VISIBILITIES = new Set<AppVisibility>([
  'public',
  'group_only',
  'private',
]);
const LOCAL_SSO_PROTOCOLS = new Set<SsoProtocol>([
  'CAS',
  'SAML',
  'OAuth2',
  'OIDC',
]);

const USER_SORT_COLUMN_MAP: Record<string, string> = {
  created_at: 'p.created_at',
  last_sign_in_at: 'p.last_login',
  email: 'p.email',
  full_name: 'p.full_name',
};

const SSO_SORT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  protocol: 'protocol',
  created_at: 'created_at',
  display_order: 'display_order',
};

const SERVICE_INSTANCE_UPDATE_COLUMNS = new Set([
  'provider_id',
  'display_name',
  'description',
  'instance_id',
  'api_path',
  'is_default',
  'visibility',
  'config',
]);

function toErrorResponse(
  message: string,
  statusCode: number
): ApiActionResponse {
  return {
    statusCode,
    contentType: 'application/json',
    payload: {
      success: false,
      error: message,
    },
    handler: 'local',
  };
}

function toSuccessResponse(data: unknown): ApiActionResponse {
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

function toFailureResponse(error: unknown): ApiActionResponse {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Unknown error';
  return {
    statusCode: 500,
    contentType: 'application/json',
    payload: {
      success: false,
      error: message,
    },
    handler: 'local',
  };
}

function enrichResponsePayload(
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
  if (success === false) {
    if (!payloadObject.request_id) {
      payloadObject.request_id = request.id;
    }

    if (!payloadObject.app_error) {
      const legacyMessage =
        maybeReadLegacyError(payloadObject) || 'Request failed';
      const detail = buildApiErrorDetail({
        status: statusCode,
        source: 'internal-data',
        requestId: request.id,
        userMessage: legacyMessage,
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

function sendActionResponse(
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

function readString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function parseMessageStatus(value: unknown): MessageStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as MessageStatus;
  if (!LOCAL_MESSAGE_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

function parseMessageRole(value: unknown): MessageRole | null {
  if (value === 'user' || value === 'assistant' || value === 'system') {
    return value;
  }
  return null;
}

function parseExecutionType(value: unknown): ExecutionType | null {
  if (value === 'workflow' || value === 'text-generation') {
    return value;
  }
  return null;
}

function parseExecutionStatus(value: unknown): ExecutionStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as ExecutionStatus;
  if (!LOCAL_EXECUTION_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as UserRole;
  if (!LOCAL_USER_ROLES.has(normalized)) {
    return null;
  }
  return normalized;
}

function parseAccountStatus(value: unknown): AccountStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AccountStatus;
  if (!LOCAL_ACCOUNT_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

function parseAppVisibility(value: unknown): AppVisibility | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AppVisibility;
  if (!LOCAL_APP_VISIBILITIES.has(normalized)) {
    return null;
  }
  return normalized;
}

function parseSsoProtocol(value: unknown): SsoProtocol | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as SsoProtocol;
  if (!LOCAL_SSO_PROTOCOLS.has(normalized)) {
    return null;
  }
  return normalized;
}

function readBoolean(value: unknown, fallback = false): boolean {
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function readObject(
  value: unknown,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value as Record<string, unknown>;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function resolvePayloadUserId(
  payload: Record<string, unknown> | undefined
): string {
  if (!payload) {
    return '';
  }
  const userId = readString(payload.userId);
  return userId;
}

function normalizeRequestBody(body: unknown): InternalActionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  return body as InternalActionRequest;
}

function normalizePayload(
  body: InternalActionRequest
): Record<string, unknown> | undefined {
  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return payload;
}

function sanitizeConversation(row: ConversationRow): ConversationRow {
  return {
    ...row,
    settings: row.settings || {},
    metadata: row.metadata || {},
  };
}

function sanitizeMessage(row: MessageRow): MessageRow {
  return {
    ...row,
    metadata: row.metadata || {},
    status: row.status || 'sent',
    is_synced: row.is_synced ?? true,
    sequence_index: row.sequence_index ?? 0,
  };
}

function sanitizeExecution(row: AppExecutionRow): AppExecutionRow {
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

function buildAssistantPreview(content: string): string {
  const withoutThink = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .trim();
  const previewBase = withoutThink || content;
  if (previewBase.length <= 100) {
    return previewBase;
  }
  return `${previewBase.slice(0, 100)}...`;
}

function encryptApiKeyValue(value: string, masterKey: string): string {
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

function sanitizeProfileRow(row: ProfileRow): Record<string, unknown> {
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
    auth_source: row.auth_source || 'native',
    sso_provider_id: row.sso_provider_id || null,
    employee_number: row.employee_number || null,
    profile_created_at: row.created_at,
    profile_updated_at: row.updated_at,
    last_login: row.last_login,
  };
}

function sanitizeGroupMemberRow(row: GroupMemberRow): Record<string, unknown> {
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

function sanitizeGroupPermissionRow(
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

function sanitizeProviderRow(row: ProviderRow): ProviderRow {
  return {
    ...row,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sanitizeServiceInstanceRow(
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

function sanitizeApiKeyRow(row: ApiKeyRow): ApiKeyRow {
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

function sanitizeSsoProviderRow(row: SsoProviderRow): SsoProviderRow {
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

async function loadGroupsByUserIdMap(
  userIds: string[]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await queryRowsWithPgSystemContext<GroupMembershipSummaryRow>(
    `
      SELECT
        gm.user_id::text AS user_id,
        gm.created_at::text AS joined_at,
        g.id::text AS group_id,
        g.name AS group_name,
        g.description AS group_description
      FROM group_members gm
      INNER JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ANY($1::uuid[])
      ORDER BY gm.created_at DESC
    `,
    [userIds]
  );

  const groupsByUser = new Map<string, Array<Record<string, unknown>>>();
  rows.forEach(row => {
    const current = groupsByUser.get(row.user_id) || [];
    current.push({
      id: row.group_id,
      name: row.group_name,
      description: row.group_description || null,
      joined_at: row.joined_at,
    });
    groupsByUser.set(row.user_id, current);
  });
  return groupsByUser;
}

async function ensureProviderDefaultServiceInstance(
  providerId: string,
  options: { preferredId?: string | null; excludeId?: string | null } = {}
): Promise<string | null> {
  const existingDefaultRows = await queryRowsWithPgSystemContext<{
    id: string;
  }>(
    `
      SELECT id::text
      FROM service_instances
      WHERE provider_id = $1::uuid
        AND is_default = TRUE
      LIMIT 1
    `,
    [providerId]
  );
  if (existingDefaultRows[0]?.id) {
    return existingDefaultRows[0].id;
  }

  const preferredId = (options.preferredId || '').trim();
  const excludeId = (options.excludeId || '').trim();

  let targetId: string | null = null;
  if (preferredId && preferredId !== excludeId) {
    const preferredRows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        SELECT id::text
        FROM service_instances
        WHERE provider_id = $1::uuid
          AND id = $2::uuid
        LIMIT 1
      `,
      [providerId, preferredId]
    );
    targetId = preferredRows[0]?.id || null;
  }

  if (!targetId) {
    const fallbackRows = excludeId
      ? await queryRowsWithPgSystemContext<{ id: string }>(
          `
            SELECT id::text
            FROM service_instances
            WHERE provider_id = $1::uuid
              AND id <> $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId, excludeId]
        )
      : await queryRowsWithPgSystemContext<{ id: string }>(
          `
            SELECT id::text
            FROM service_instances
            WHERE provider_id = $1::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId]
        );
    targetId = fallbackRows[0]?.id || null;
  }

  if (!targetId) {
    return null;
  }

  await queryRowsWithPgSystemContext(
    `
      UPDATE service_instances
      SET is_default = TRUE, updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [targetId]
  );

  return targetId;
}

async function resolveActorIdentity(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; identity: ProfileStatusIdentity }
  | { ok: false; error: ApiActionResponse }
> {
  const resolved = await resolveProfileStatusFromUpstream(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      error: toErrorResponse('Unauthorized', 401),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      error: toErrorResponse('Failed to verify session', 500),
    };
  }
  return { ok: true, identity: resolved.identity };
}

async function ensureActionPermission(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<{ error: ApiActionResponse | null; actorUserId?: string }> {
  if (ADMIN_ACTIONS.has(action)) {
    const resolved = await resolveActorIdentity(request, config);
    if (!resolved.ok) {
      const status = resolved.error.statusCode;
      if (status === 401) {
        return {
          error: toErrorResponse('Unauthorized access', 401),
        };
      }
      return {
        error: toErrorResponse('Failed to verify permissions', 500),
      };
    }

    if (resolved.identity.role !== 'admin') {
      return {
        error: toErrorResponse('Insufficient permissions', 403),
      };
    }

    return { error: null, actorUserId: resolved.identity.userId };
  }

  if (AUTH_ACTIONS.has(action)) {
    const resolved = await resolveActorIdentity(request, config);
    if (!resolved.ok) {
      return { error: resolved.error };
    }

    const payloadUserId = resolvePayloadUserId(payload);
    if (payloadUserId && payloadUserId !== resolved.identity.userId) {
      return {
        error: toErrorResponse('Forbidden', 403),
      };
    }

    return { error: null, actorUserId: resolved.identity.userId };
  }

  return { error: null };
}

async function loadConversationOwnedByActor(
  conversationId: string,
  actorUserId: string
): Promise<boolean> {
  const rows = await queryRowsWithPgSystemContext<{ id: string }>(
    `
      SELECT id::text
      FROM conversations
      WHERE id = $1::uuid
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [conversationId, actorUserId]
  );

  return Boolean(rows[0]?.id);
}

async function loadExecutionOwnedByActor(
  executionId: string,
  actorUserId: string
): Promise<AppExecutionRow | null> {
  const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
    `
      SELECT
        id::text,
        user_id::text,
        service_instance_id::text,
        execution_type::text,
        external_execution_id,
        task_id,
        title,
        inputs,
        outputs,
        status::text,
        error_message,
        total_steps,
        total_tokens,
        elapsed_time,
        metadata,
        created_at::text,
        updated_at::text,
        completed_at::text
      FROM app_executions
      WHERE id = $1::uuid
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [executionId, actorUserId]
  );

  return rows[0] ? sanitizeExecution(rows[0]) : null;
}

async function handleConversationAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_CONVERSATION_ACTIONS.has(action)) {
    return null;
  }

  const resolvedUserId = (actorUserId || readString(payload?.userId)).trim();

  if (action === 'conversations.getUserConversations') {
    if (!resolvedUserId) {
      return toErrorResponse('Missing userId', 400);
    }

    const limit = Math.min(parsePositiveInt(payload?.limit, 20), 1000);
    const offset = parsePositiveInt(payload?.offset, 0);
    const appId = readString(payload?.appId);

    const queryParams: unknown[] = [resolvedUserId, limit, offset];
    const appFilterSql = appId ? 'AND app_id = $4' : '';
    if (appId) {
      queryParams.push(appId);
    }

    const conversations = await queryRowsWithPgSystemContext<ConversationRow>(
      `
        SELECT
          id::text,
          user_id::text,
          ai_config_id::text,
          title,
          summary,
          settings,
          metadata,
          status,
          external_id,
          app_id,
          last_message_preview,
          created_at::text,
          updated_at::text
        FROM conversations
        WHERE user_id = $1::uuid
          AND status = 'active'
          ${appFilterSql}
        ORDER BY updated_at DESC
        LIMIT $2
        OFFSET $3
      `,
      queryParams
    );

    const countParams: unknown[] = [resolvedUserId];
    const countFilterSql = appId ? 'AND app_id = $2' : '';
    if (appId) {
      countParams.push(appId);
    }

    const totalRows = await queryRowsWithPgSystemContext<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM conversations
        WHERE user_id = $1::uuid
          AND status = 'active'
          ${countFilterSql}
      `,
      countParams
    );

    return toSuccessResponse({
      conversations: conversations.map(sanitizeConversation),
      total: Number(totalRows[0]?.total || 0),
    });
  }

  if (action === 'conversations.getConversationByExternalId') {
    const externalId = readString(payload?.externalId);
    if (!resolvedUserId || !externalId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ConversationRow>(
      `
        SELECT
          id::text,
          user_id::text,
          ai_config_id::text,
          title,
          summary,
          settings,
          metadata,
          status,
          external_id,
          app_id,
          last_message_preview,
          created_at::text,
          updated_at::text
        FROM conversations
        WHERE external_id = $1
          AND user_id = $2::uuid
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [externalId, resolvedUserId]
    );

    return toSuccessResponse(rows[0] ? sanitizeConversation(rows[0]) : null);
  }

  if (action === 'conversations.createConversation') {
    if (!resolvedUserId) {
      return toErrorResponse('Missing userId', 400);
    }

    const conversation =
      payload?.conversation &&
      typeof payload.conversation === 'object' &&
      !Array.isArray(payload.conversation)
        ? (payload.conversation as Record<string, unknown>)
        : {};

    const rows = await queryRowsWithPgSystemContext<ConversationRow>(
      `
        INSERT INTO conversations (
          user_id,
          ai_config_id,
          title,
          summary,
          settings,
          metadata,
          status,
          external_id,
          app_id,
          last_message_preview,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7,
          $8,
          $9,
          $10,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          user_id::text,
          ai_config_id::text,
          title,
          summary,
          settings,
          metadata,
          status,
          external_id,
          app_id,
          last_message_preview,
          created_at::text,
          updated_at::text
      `,
      [
        resolvedUserId,
        readString(conversation.ai_config_id) || null,
        readString(conversation.title),
        readString(conversation.summary) || null,
        JSON.stringify(
          conversation.settings && typeof conversation.settings === 'object'
            ? conversation.settings
            : {}
        ),
        JSON.stringify(
          conversation.metadata && typeof conversation.metadata === 'object'
            ? conversation.metadata
            : {}
        ),
        readString(conversation.status) || 'active',
        readString(conversation.external_id) || null,
        readString(conversation.app_id) || null,
        readString(conversation.last_message_preview) || null,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeConversation(rows[0]) : null);
  }

  if (action === 'conversations.renameConversation') {
    const conversationId = readString(payload?.conversationId);
    const title = readString(payload?.title);
    if (!resolvedUserId || !conversationId || !title) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE conversations
        SET title = $1, updated_at = NOW()
        WHERE id = $2::uuid
          AND user_id = $3::uuid
          AND status = 'active'
        RETURNING id::text
      `,
      [title, conversationId, resolvedUserId]
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  if (action === 'conversations.deleteConversation') {
    const conversationId = readString(payload?.conversationId);
    if (!resolvedUserId || !conversationId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE conversations
        SET status = 'deleted', updated_at = NOW()
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND status = 'active'
        RETURNING id::text
      `,
      [conversationId, resolvedUserId]
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}

async function handleMessageAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_MESSAGE_ACTIONS.has(action)) {
    return null;
  }

  if (!actorUserId) {
    return toErrorResponse('Unauthorized', 401);
  }

  if (action === 'messages.getLatest') {
    const conversationId = readString(payload?.conversationId);
    const limit = Math.min(parsePositiveInt(payload?.limit, 1000), 5000);
    if (!conversationId) {
      return toErrorResponse('Missing conversationId', 400);
    }

    const owned = await loadConversationOwnedByActor(
      conversationId,
      actorUserId
    );
    if (!owned) {
      return toErrorResponse('Conversation not found', 404);
    }

    const rows = await queryRowsWithPgSystemContext<MessageRow>(
      `
        SELECT
          id::text,
          conversation_id::text,
          user_id::text,
          role::text,
          content,
          metadata,
          created_at::text,
          status::text,
          external_id,
          token_count,
          is_synced,
          sequence_index
        FROM messages
        WHERE conversation_id = $1::uuid
        ORDER BY created_at ASC, sequence_index ASC, id ASC
        LIMIT $2
      `,
      [conversationId, limit]
    );

    return toSuccessResponse(rows.map(sanitizeMessage));
  }

  if (action === 'messages.findDuplicate') {
    const conversationId = readString(payload?.conversationId);
    const content = readString(payload?.content);
    const role = parseMessageRole(payload?.role);

    if (!conversationId || !content || !role) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadConversationOwnedByActor(
      conversationId,
      actorUserId
    );
    if (!owned) {
      return toErrorResponse('Conversation not found', 404);
    }

    const rows = await queryRowsWithPgSystemContext<MessageRow>(
      `
        SELECT
          id::text,
          conversation_id::text,
          user_id::text,
          role::text,
          content,
          metadata,
          created_at::text,
          status::text,
          external_id,
          token_count,
          is_synced,
          sequence_index
        FROM messages
        WHERE conversation_id = $1::uuid
          AND role = $2::message_role
          AND content = $3
        ORDER BY created_at DESC, sequence_index DESC, id DESC
        LIMIT 1
      `,
      [conversationId, role, content]
    );

    return toSuccessResponse(rows[0] ? sanitizeMessage(rows[0]) : null);
  }

  if (action === 'messages.save') {
    const message =
      payload?.message &&
      typeof payload.message === 'object' &&
      !Array.isArray(payload.message)
        ? (payload.message as Record<string, unknown>)
        : {};

    const conversationId = readString(message.conversation_id);
    const role = parseMessageRole(message.role);
    const content = readString(message.content);

    if (!conversationId || !role || !content) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadConversationOwnedByActor(
      conversationId,
      actorUserId
    );
    if (!owned) {
      return toErrorResponse('Conversation not found', 404);
    }

    const statusRaw = message.status;
    const status =
      statusRaw === undefined ? null : parseMessageStatus(statusRaw);
    if (statusRaw !== undefined && !status) {
      return toErrorResponse('Invalid status', 400);
    }

    const metadata =
      message.metadata &&
      typeof message.metadata === 'object' &&
      !Array.isArray(message.metadata)
        ? message.metadata
        : {};

    const sequenceIndex =
      typeof message.sequence_index === 'number' &&
      Number.isFinite(message.sequence_index)
        ? Math.floor(message.sequence_index)
        : role === 'user'
          ? 0
          : 1;

    const rows = await queryRowsWithPgSystemContext<MessageRow>(
      `
        INSERT INTO messages (
          conversation_id,
          user_id,
          role,
          content,
          metadata,
          status,
          external_id,
          token_count,
          is_synced,
          sequence_index,
          created_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::message_role,
          $4,
          $5::jsonb,
          $6::message_status,
          $7,
          $8,
          TRUE,
          $9,
          NOW()
        )
        RETURNING
          id::text,
          conversation_id::text,
          user_id::text,
          role::text,
          content,
          metadata,
          created_at::text,
          status::text,
          external_id,
          token_count,
          is_synced,
          sequence_index
      `,
      [
        conversationId,
        role === 'user' ? actorUserId : null,
        role,
        content,
        JSON.stringify(metadata),
        status || 'sent',
        readString(message.external_id) || null,
        typeof message.token_count === 'number' &&
        Number.isFinite(message.token_count)
          ? Math.floor(message.token_count)
          : null,
        sequenceIndex,
      ]
    );

    const saved = rows[0] ? sanitizeMessage(rows[0]) : null;

    if (saved && role === 'assistant') {
      const preview = buildAssistantPreview(content);
      try {
        await queryRowsWithPgSystemContext(
          `
            UPDATE conversations
            SET
              last_message_preview = $2,
              updated_at = NOW()
            WHERE id = $1::uuid
          `,
          [conversationId, preview]
        );
      } catch {
        // Best-effort parity with legacy logic: message save should not fail because preview update failed.
      }
    }

    return toSuccessResponse(saved);
  }

  if (action === 'messages.createPlaceholder') {
    const conversationId = readString(payload?.conversationId);
    const statusRaw = payload?.status;
    const status =
      statusRaw === undefined ? 'error' : parseMessageStatus(statusRaw);
    const errorMessage = readString(payload?.errorMessage) || null;

    if (!conversationId) {
      return toErrorResponse('Missing conversationId', 400);
    }

    const owned = await loadConversationOwnedByActor(
      conversationId,
      actorUserId
    );
    if (!owned) {
      return toErrorResponse('Conversation not found', 404);
    }

    if (!status) {
      return toErrorResponse('Invalid status', 400);
    }

    const placeholderContent =
      errorMessage || 'Failed to generate assistant message';
    const placeholderMetadata = {
      error: true,
      errorMessage,
    };

    const rows = await queryRowsWithPgSystemContext<MessageRow>(
      `
        INSERT INTO messages (
          conversation_id,
          user_id,
          role,
          content,
          metadata,
          status,
          external_id,
          token_count,
          is_synced,
          sequence_index,
          created_at
        )
        VALUES (
          $1::uuid,
          NULL,
          'assistant'::message_role,
          $2,
          $3::jsonb,
          $4::message_status,
          NULL,
          NULL,
          TRUE,
          1,
          NOW()
        )
        RETURNING
          id::text,
          conversation_id::text,
          user_id::text,
          role::text,
          content,
          metadata,
          created_at::text,
          status::text,
          external_id,
          token_count,
          is_synced,
          sequence_index
      `,
      [
        conversationId,
        placeholderContent,
        JSON.stringify(placeholderMetadata),
        status,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeMessage(rows[0]) : null);
  }

  return null;
}

async function handleAppExecutionAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_APP_EXECUTION_ACTIONS.has(action)) {
    return null;
  }

  const resolvedUserId = (actorUserId || readString(payload?.userId)).trim();

  if (action === 'appExecutions.getByServiceInstance') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const limit = Math.min(parsePositiveInt(payload?.limit, 10), 100);

    if (!resolvedUserId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        SELECT
          id::text,
          user_id::text,
          service_instance_id::text,
          execution_type::text,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status::text,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          created_at::text,
          updated_at::text,
          completed_at::text
        FROM app_executions
        WHERE service_instance_id = $1::uuid
          AND user_id = $2::uuid
          AND status <> 'deleted'::execution_status
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [serviceInstanceId, resolvedUserId, limit]
    );

    return toSuccessResponse(rows.map(sanitizeExecution));
  }

  if (action === 'appExecutions.getById') {
    const executionId = readString(payload?.executionId);
    if (!resolvedUserId || !executionId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        SELECT
          id::text,
          user_id::text,
          service_instance_id::text,
          execution_type::text,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status::text,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          created_at::text,
          updated_at::text,
          completed_at::text
        FROM app_executions
        WHERE id = $1::uuid
          AND user_id = $2::uuid
        LIMIT 1
      `,
      [executionId, resolvedUserId]
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.create') {
    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }

    const execution =
      payload?.execution &&
      typeof payload.execution === 'object' &&
      !Array.isArray(payload.execution)
        ? (payload.execution as Record<string, unknown>)
        : {};

    const serviceInstanceId = readString(execution.service_instance_id);
    const executionType = parseExecutionType(execution.execution_type);
    const title = readString(execution.title);
    const parsedStatus =
      execution.status === undefined
        ? 'pending'
        : parseExecutionStatus(execution.status);

    if (!serviceInstanceId || !executionType || !title) {
      return toErrorResponse('Missing required fields', 400);
    }
    if (!parsedStatus) {
      return toErrorResponse('Invalid status', 400);
    }

    const inputs =
      execution.inputs &&
      typeof execution.inputs === 'object' &&
      !Array.isArray(execution.inputs)
        ? execution.inputs
        : {};
    const outputs =
      execution.outputs &&
      typeof execution.outputs === 'object' &&
      !Array.isArray(execution.outputs)
        ? execution.outputs
        : null;
    const metadata =
      execution.metadata &&
      typeof execution.metadata === 'object' &&
      !Array.isArray(execution.metadata)
        ? execution.metadata
        : {};
    const totalSteps =
      typeof execution.total_steps === 'number' &&
      Number.isFinite(execution.total_steps)
        ? Math.max(0, Math.floor(execution.total_steps))
        : 0;
    const totalTokens =
      typeof execution.total_tokens === 'number' &&
      Number.isFinite(execution.total_tokens)
        ? Math.max(0, Math.floor(execution.total_tokens))
        : 0;
    const elapsedTime =
      typeof execution.elapsed_time === 'number' &&
      Number.isFinite(execution.elapsed_time)
        ? execution.elapsed_time
        : null;
    const completedAt = readString(execution.completed_at) || null;

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        INSERT INTO app_executions (
          user_id,
          service_instance_id,
          execution_type,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          completed_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::execution_type,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8::jsonb,
          $9::execution_status,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15::timestamptz,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          user_id::text,
          service_instance_id::text,
          execution_type::text,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status::text,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          created_at::text,
          updated_at::text,
          completed_at::text
      `,
      [
        actorUserId,
        serviceInstanceId,
        executionType,
        readString(execution.external_execution_id) || null,
        readString(execution.task_id) || null,
        title,
        JSON.stringify(inputs),
        JSON.stringify(outputs),
        parsedStatus,
        readString(execution.error_message) || null,
        totalSteps,
        totalTokens,
        elapsedTime,
        JSON.stringify(metadata),
        completedAt,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.updateStatus') {
    const executionId = readString(payload?.executionId);
    const status = parseExecutionStatus(payload?.status);
    const hasErrorMessage = Object.prototype.hasOwnProperty.call(
      payload || {},
      'errorMessage'
    );
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(
      payload || {},
      'completedAt'
    );
    const errorMessage =
      typeof payload?.errorMessage === 'string'
        ? payload.errorMessage
        : payload?.errorMessage === null
          ? null
          : undefined;
    const completedAt =
      typeof payload?.completedAt === 'string'
        ? payload.completedAt
        : payload?.completedAt === null
          ? null
          : undefined;

    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (!executionId || !status) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const updates: string[] = [
      'status = $1::execution_status',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [status];
    let index = 2;

    if (hasErrorMessage) {
      updates.push(`error_message = $${index}`);
      params.push(errorMessage ?? null);
      index += 1;
    }

    if (hasCompletedAt) {
      updates.push(`completed_at = $${index}::timestamptz`);
      params.push(completedAt ?? null);
      index += 1;
    } else if (TERMINAL_EXECUTION_STATUSES.has(status)) {
      updates.push('completed_at = NOW()');
    }

    params.push(executionId);

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE app_executions
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING id::text
      `,
      params
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  if (action === 'appExecutions.updateComplete') {
    const executionId = readString(payload?.executionId);
    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (!executionId) {
      return toErrorResponse('Missing executionId', 400);
    }

    const completeData =
      payload?.completeData &&
      typeof payload.completeData === 'object' &&
      !Array.isArray(payload.completeData)
        ? (payload.completeData as Record<string, unknown>)
        : {};
    const status = parseExecutionStatus(completeData.status);
    if (!status) {
      return toErrorResponse('Invalid status', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const updates: string[] = [
      'status = $1::execution_status',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [status];
    let index = 2;

    const addSet = (sqlFragment: string, value: unknown) => {
      updates.push(`${sqlFragment} = $${index}`);
      params.push(value);
      index += 1;
    };

    const addSetWithCast = (
      sqlFragment: string,
      cast: string,
      value: unknown
    ) => {
      updates.push(`${sqlFragment} = $${index}::${cast}`);
      params.push(value);
      index += 1;
    };

    if (
      Object.prototype.hasOwnProperty.call(
        completeData,
        'external_execution_id'
      )
    ) {
      addSet(
        'external_execution_id',
        readString(completeData.external_execution_id) || null
      );
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'task_id')) {
      addSet('task_id', readString(completeData.task_id) || null);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'outputs')) {
      const outputs =
        completeData.outputs &&
        typeof completeData.outputs === 'object' &&
        !Array.isArray(completeData.outputs)
          ? completeData.outputs
          : null;
      addSetWithCast('outputs', 'jsonb', JSON.stringify(outputs));
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'total_steps')) {
      const totalSteps =
        typeof completeData.total_steps === 'number' &&
        Number.isFinite(completeData.total_steps)
          ? Math.max(0, Math.floor(completeData.total_steps))
          : 0;
      addSet('total_steps', totalSteps);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'total_tokens')) {
      const totalTokens =
        typeof completeData.total_tokens === 'number' &&
        Number.isFinite(completeData.total_tokens)
          ? Math.max(0, Math.floor(completeData.total_tokens))
          : 0;
      addSet('total_tokens', totalTokens);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'elapsed_time')) {
      const elapsedTime =
        typeof completeData.elapsed_time === 'number' &&
        Number.isFinite(completeData.elapsed_time)
          ? completeData.elapsed_time
          : null;
      addSet('elapsed_time', elapsedTime);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'error_message')) {
      addSet('error_message', readString(completeData.error_message) || null);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'completed_at')) {
      addSetWithCast(
        'completed_at',
        'timestamptz',
        readString(completeData.completed_at) || null
      );
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'metadata')) {
      const metadata =
        completeData.metadata &&
        typeof completeData.metadata === 'object' &&
        !Array.isArray(completeData.metadata)
          ? completeData.metadata
          : {};
      addSetWithCast('metadata', 'jsonb', JSON.stringify(metadata));
    }

    params.push(executionId);

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        UPDATE app_executions
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          user_id::text,
          service_instance_id::text,
          execution_type::text,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status::text,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          created_at::text,
          updated_at::text,
          completed_at::text
      `,
      params
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.delete') {
    const executionId = readString(payload?.executionId);
    if (!actorUserId || !resolvedUserId || !executionId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE app_executions
        SET status = 'deleted'::execution_status,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND status <> 'deleted'::execution_status
        RETURNING id::text
      `,
      [executionId, resolvedUserId]
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}

async function handleGroupAuthAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_GROUP_AUTH_ACTIONS.has(action)) {
    return null;
  }

  const targetUserId = (actorUserId || readString(payload?.userId)).trim();
  if (!actorUserId || !targetUserId) {
    return toErrorResponse('Missing required fields', 400);
  }

  if (action === 'groups.getUserAccessibleApps') {
    const rows = await queryRowsWithPgUserContext<Record<string, unknown>>(
      actorUserId,
      undefined,
      `SELECT * FROM get_user_accessible_apps($1::uuid)`,
      [targetUserId]
    );
    return toSuccessResponse(rows || []);
  }

  if (action === 'groups.checkUserAppPermission') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgUserContext<{
      has_access: boolean;
      quota_remaining: number | null;
      error_message: string | null;
    }>(
      actorUserId,
      undefined,
      `
        SELECT
          has_access,
          quota_remaining,
          error_message
        FROM check_user_app_permission($1::uuid, $2::uuid)
        LIMIT 1
      `,
      [targetUserId, serviceInstanceId]
    );

    return toSuccessResponse(
      rows[0] || {
        has_access: false,
        quota_remaining: null,
        error_message: 'Permission check failed',
      }
    );
  }

  if (action === 'groups.incrementAppUsage') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const increment = Math.max(1, parsePositiveInt(payload?.increment, 1));
    if (!serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgUserContext<{
      success: boolean;
      new_used_count: number;
      quota_remaining: number | null;
      error_message: string | null;
    }>(
      actorUserId,
      undefined,
      `SELECT * FROM increment_app_usage($1::uuid, $2::uuid, $3::integer)`,
      [targetUserId, serviceInstanceId, increment]
    );

    return toSuccessResponse(
      rows[0] || {
        success: false,
        new_used_count: 0,
        quota_remaining: null,
        error_message: 'Failed to update usage count',
      }
    );
  }

  return null;
}

async function handleUserAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_USER_ACTIONS.has(action)) {
    return null;
  }

  if (!actorUserId) {
    return toErrorResponse('Unauthorized', 401);
  }

  if (action === 'users.getUserList') {
    const filters = readObject(payload?.filters);
    const page = Math.max(1, parsePositiveInt(filters.page, 1));
    const pageSize = Math.max(
      1,
      Math.min(parsePositiveInt(filters.pageSize, 20), 100)
    );
    const sortBy = readString(filters.sortBy) || 'created_at';
    const sortOrder =
      readString(filters.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortColumn =
      USER_SORT_COLUMN_MAP[sortBy] || USER_SORT_COLUMN_MAP.created_at;

    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    const roleFilter = parseUserRole(filters.role);
    if (roleFilter) {
      whereParams.push(roleFilter);
      whereClauses.push(`p.role = $${whereParams.length}::user_role`);
    }

    const statusFilter = parseAccountStatus(filters.status);
    if (statusFilter) {
      whereParams.push(statusFilter);
      whereClauses.push(`p.status = $${whereParams.length}::account_status`);
    }

    const authSource = readString(filters.auth_source);
    if (authSource) {
      whereParams.push(authSource);
      whereClauses.push(`p.auth_source = $${whereParams.length}`);
    }

    const search = readString(filters.search);
    if (search) {
      whereParams.push(`%${escapeLikePattern(search)}%`);
      whereClauses.push(
        `(p.full_name ILIKE $${whereParams.length} ESCAPE '\\' OR p.username ILIKE $${whereParams.length} ESCAPE '\\')`
      );
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await queryRowsWithPgSystemContext<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM profiles p ${whereSql}`,
      whereParams
    );
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const listRows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        SELECT
          p.id::text,
          p.email,
          p.phone,
          p.full_name,
          p.username,
          p.avatar_url,
          p.role::text,
          p.status::text,
          p.auth_source,
          p.sso_provider_id::text,
          p.employee_number,
          p.created_at::text,
          p.updated_at::text,
          p.last_login::text
        FROM profiles p
        ${whereSql}
        ORDER BY ${sortColumn} ${sortOrder} NULLS LAST, p.id DESC
        LIMIT $${whereParams.length + 1}
        OFFSET $${whereParams.length + 2}
      `,
      [...whereParams, pageSize, offset]
    );

    const groupsByUser = await loadGroupsByUserIdMap(
      listRows.map(row => row.id)
    );
    const users = listRows.map(row => ({
      ...sanitizeProfileRow(row),
      groups: groupsByUser.get(row.id) || [],
    }));

    return toSuccessResponse({
      users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  if (action === 'users.getUserStats') {
    const rows = await queryRowsWithPgSystemContext<{
      totalUsers: number;
      activeUsers: number;
      suspendedUsers: number;
      pendingUsers: number;
      adminUsers: number;
      managerUsers: number;
      regularUsers: number;
      newUsersToday: number;
      newUsersThisWeek: number;
      newUsersThisMonth: number;
    }>(
      `
        SELECT
          COUNT(*)::int AS "totalUsers",
          COUNT(*) FILTER (WHERE status = 'active')::int AS "activeUsers",
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS "suspendedUsers",
          COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingUsers",
          COUNT(*) FILTER (WHERE role = 'admin')::int AS "adminUsers",
          COUNT(*) FILTER (WHERE role = 'manager')::int AS "managerUsers",
          COUNT(*) FILTER (WHERE role = 'user')::int AS "regularUsers",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS "newUsersToday",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS "newUsersThisWeek",
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS "newUsersThisMonth"
        FROM profiles
      `
    );

    return toSuccessResponse(rows[0] || {});
  }

  if (action === 'users.getUserById') {
    const userId = readString(payload?.userId);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        SELECT
          p.id::text,
          p.email,
          p.phone,
          p.full_name,
          p.username,
          p.avatar_url,
          p.role::text,
          p.status::text,
          p.auth_source,
          p.sso_provider_id::text,
          p.employee_number,
          p.created_at::text,
          p.updated_at::text,
          p.last_login::text
        FROM profiles p
        WHERE p.id = $1::uuid
        LIMIT 1
      `,
      [userId]
    );

    if (!rows[0]) {
      return toSuccessResponse(null);
    }

    const groupsByUser = await loadGroupsByUserIdMap([rows[0].id]);
    return toSuccessResponse({
      ...sanitizeProfileRow(rows[0]),
      groups: groupsByUser.get(rows[0].id) || [],
    });
  }

  if (action === 'users.updateUserProfile') {
    const userId = readString(payload?.userId);
    const updates = readObject(payload?.updates);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const allowedColumns = new Set([
      'email',
      'phone',
      'full_name',
      'username',
      'avatar_url',
      'role',
      'status',
      'auth_source',
      'sso_provider_id',
      'employee_number',
      'department',
      'job_title',
      'last_login',
    ]);

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!allowedColumns.has(key)) {
        continue;
      }

      if (key === 'role') {
        const parsedRole = parseUserRole(rawValue);
        if (!parsedRole) {
          continue;
        }
        setClauses.push(`role = $${index}::user_role`);
        values.push(parsedRole);
        index += 1;
        continue;
      }

      if (key === 'status') {
        const parsedStatus = parseAccountStatus(rawValue);
        if (!parsedStatus) {
          continue;
        }
        setClauses.push(`status = $${index}::account_status`);
        values.push(parsedStatus);
        index += 1;
        continue;
      }

      if (key === 'sso_provider_id') {
        setClauses.push(`sso_provider_id = $${index}::uuid`);
        values.push(readString(rawValue) || null);
        index += 1;
        continue;
      }

      if (key === 'last_login') {
        setClauses.push(`last_login = $${index}::timestamptz`);
        values.push(readString(rawValue) || null);
        index += 1;
        continue;
      }

      setClauses.push(`${key} = $${index}`);
      values.push(rawValue ?? null);
      index += 1;
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No valid fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(userId);

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        UPDATE profiles
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          email,
          phone,
          full_name,
          username,
          avatar_url,
          role::text,
          status::text,
          auth_source,
          sso_provider_id::text,
          employee_number,
          created_at::text,
          updated_at::text,
          last_login::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('User profile not found', 404);
    }

    return toSuccessResponse(sanitizeProfileRow(rows[0]));
  }

  if (action === 'users.deleteUser') {
    const userId = readString(payload?.userId);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }
    if (userId === actorUserId) {
      return toErrorResponse('cannot delete current actor', 403);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM profiles
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [userId]
    );
    if (!rows[0]?.id) {
      return toErrorResponse('User not found', 404);
    }

    return toSuccessResponse(null);
  }

  if (action === 'users.createUserProfile') {
    const userId = readString(payload?.userId);
    const profileData = readObject(payload?.profileData);
    if (!userId) {
      return toErrorResponse('Missing userId', 400);
    }

    const role = parseUserRole(profileData.role) || 'user';
    const status = parseAccountStatus(profileData.status) || 'active';
    const authSource = readString(profileData.auth_source) || 'password';

    const rows = await queryRowsWithPgSystemContext<ProfileRow>(
      `
        INSERT INTO profiles (
          id,
          full_name,
          username,
          avatar_url,
          role,
          status,
          auth_source,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::user_role,
          $6::account_status,
          $7,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          email,
          phone,
          full_name,
          username,
          avatar_url,
          role::text,
          status::text,
          auth_source,
          sso_provider_id::text,
          employee_number,
          created_at::text,
          updated_at::text,
          last_login::text
      `,
      [
        userId,
        readString(profileData.full_name) || null,
        readString(profileData.username) || null,
        readString(profileData.avatar_url) || null,
        role,
        status,
        authSource,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeProfileRow(rows[0]) : null);
  }

  if (action === 'users.batchUpdateUserStatus') {
    const userIds = readStringArray(payload?.userIds);
    const status = parseAccountStatus(payload?.status);
    if (!status) {
      return toErrorResponse('Invalid status', 400);
    }
    if (userIds.length === 0) {
      return toSuccessResponse(null);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE profiles
        SET status = $2::account_status,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, status]
    );

    return toSuccessResponse(null);
  }

  if (action === 'users.batchUpdateUserRole') {
    const userIds = readStringArray(payload?.userIds);
    const role = parseUserRole(payload?.role);
    if (!role) {
      return toErrorResponse('Invalid role', 400);
    }
    if (userIds.length === 0) {
      return toSuccessResponse(null);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE profiles
        SET role = $2::user_role,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [userIds, role]
    );

    return toSuccessResponse(null);
  }

  return null;
}

async function handleGroupAdminAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_GROUP_ADMIN_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'groups.getGroups') {
    const rows = await queryRowsWithPgSystemContext<GroupRow>(
      `
        SELECT
          g.id::text,
          g.name,
          g.description,
          COALESCE(g.created_by::text, '') AS created_by,
          g.created_at::text,
          COUNT(gm.id)::int AS member_count
        FROM groups g
        LEFT JOIN group_members gm ON gm.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
      `
    );
    return toSuccessResponse(rows);
  }

  if (action === 'groups.createGroup') {
    const data = readObject(payload?.data);
    const name = readString(data.name);
    if (!name) {
      return toErrorResponse('Missing group name', 400);
    }

    const rows = await queryRowsWithPgSystemContext<GroupRow>(
      `
        INSERT INTO groups (name, description)
        VALUES ($1, $2)
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      [name, readString(data.description) || null]
    );

    return toSuccessResponse(rows[0] || null);
  }

  if (action === 'groups.updateGroup') {
    const groupId = readString(payload?.groupId);
    const data = readObject(payload?.data);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      updates.push(`name = $${index}`);
      values.push(readString(data.name) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      updates.push(`description = $${index}`);
      values.push(readString(data.description) || null);
      index += 1;
    }

    if (updates.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    values.push(groupId);
    const rows = await queryRowsWithPgSystemContext<GroupRow>(
      `
        UPDATE groups
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Group not found', 404);
    }

    return toSuccessResponse(rows[0]);
  }

  if (action === 'groups.deleteGroup') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    await queryRowsWithPgSystemContext(
      `DELETE FROM groups WHERE id = $1::uuid`,
      [groupId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.getGroupMembers') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<GroupMemberRow>(
      `
        SELECT
          gm.id::text,
          gm.group_id::text,
          gm.user_id::text,
          gm.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM group_members gm
        LEFT JOIN profiles p ON p.id = gm.user_id
        WHERE gm.group_id = $1::uuid
        ORDER BY gm.created_at DESC
      `,
      [groupId]
    );
    return toSuccessResponse(rows.map(sanitizeGroupMemberRow));
  }

  if (action === 'groups.addGroupMember') {
    const groupId = readString(payload?.groupId);
    const userId = readString(payload?.userId);
    if (!groupId || !userId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<GroupMemberRow>(
      `
        WITH inserted AS (
          INSERT INTO group_members (group_id, user_id)
          VALUES ($1::uuid, $2::uuid)
          RETURNING id, group_id, user_id, created_at
        )
        SELECT
          i.id::text,
          i.group_id::text,
          i.user_id::text,
          i.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM inserted i
        LEFT JOIN profiles p ON p.id = i.user_id
      `,
      [groupId, userId]
    );

    return toSuccessResponse(rows[0] ? sanitizeGroupMemberRow(rows[0]) : null);
  }

  if (action === 'groups.removeGroupMember') {
    const groupId = readString(payload?.groupId);
    const userId = readString(payload?.userId);
    if (!groupId || !userId) {
      return toErrorResponse('Missing required fields', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_members
        WHERE group_id = $1::uuid
          AND user_id = $2::uuid
      `,
      [groupId, userId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.getGroupAppPermissions') {
    const groupId = readString(payload?.groupId);
    if (!groupId) {
      return toErrorResponse('Missing groupId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<GroupPermissionRow>(
      `
        SELECT
          gap.id::text,
          gap.group_id::text,
          gap.service_instance_id::text,
          gap.is_enabled,
          gap.usage_quota,
          gap.used_count,
          gap.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility::text AS app_visibility
        FROM group_app_permissions gap
        LEFT JOIN service_instances si ON si.id = gap.service_instance_id
        WHERE gap.group_id = $1::uuid
        ORDER BY gap.created_at DESC
      `,
      [groupId]
    );
    return toSuccessResponse(rows.map(sanitizeGroupPermissionRow));
  }

  if (action === 'groups.setGroupAppPermission') {
    const groupId = readString(payload?.groupId);
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const data = readObject(payload?.data);
    if (!groupId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const enabled = readBoolean(data.is_enabled, false);
    if (!enabled) {
      await queryRowsWithPgSystemContext(
        `
          DELETE FROM group_app_permissions
          WHERE group_id = $1::uuid
            AND service_instance_id = $2::uuid
        `,
        [groupId, serviceInstanceId]
      );
      return toSuccessResponse({
        id: '',
        group_id: groupId,
        service_instance_id: serviceInstanceId,
        is_enabled: false,
        usage_quota: null,
        used_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    const usageQuotaRaw = data.usage_quota;
    const usageQuota =
      typeof usageQuotaRaw === 'number' && Number.isFinite(usageQuotaRaw)
        ? Math.max(0, Math.floor(usageQuotaRaw))
        : null;

    const rows = await queryRowsWithPgSystemContext<GroupPermissionRow>(
      `
        WITH upserted AS (
          INSERT INTO group_app_permissions (
            group_id,
            service_instance_id,
            is_enabled,
            usage_quota
          )
          VALUES ($1::uuid, $2::uuid, TRUE, $3::integer)
          ON CONFLICT (group_id, service_instance_id)
          DO UPDATE
            SET is_enabled = EXCLUDED.is_enabled,
                usage_quota = EXCLUDED.usage_quota
          RETURNING *
        )
        SELECT
          u.id::text,
          u.group_id::text,
          u.service_instance_id::text,
          u.is_enabled,
          u.usage_quota,
          u.used_count,
          u.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility::text AS app_visibility
        FROM upserted u
        LEFT JOIN service_instances si ON si.id = u.service_instance_id
      `,
      [groupId, serviceInstanceId, usageQuota]
    );

    return toSuccessResponse(
      rows[0] ? sanitizeGroupPermissionRow(rows[0]) : null
    );
  }

  if (action === 'groups.removeGroupAppPermission') {
    const groupId = readString(payload?.groupId);
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!groupId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_app_permissions
        WHERE group_id = $1::uuid
          AND service_instance_id = $2::uuid
      `,
      [groupId, serviceInstanceId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.removeAllGroupAppPermissions') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing serviceInstanceId', 400);
    }
    await queryRowsWithPgSystemContext(
      `
        DELETE FROM group_app_permissions
        WHERE service_instance_id = $1::uuid
      `,
      [serviceInstanceId]
    );
    return toSuccessResponse(null);
  }

  if (action === 'groups.searchUsersForGroup') {
    const searchTerm = readString(payload?.searchTerm);
    const excludeUserIds = readStringArray(payload?.excludeUserIds);

    const clauses: string[] = [`status = 'active'`];
    const params: unknown[] = [];

    if (excludeUserIds.length > 0) {
      params.push(excludeUserIds);
      clauses.push(`id <> ALL($${params.length}::uuid[])`);
    }

    if (searchTerm) {
      params.push(`%${escapeLikePattern(searchTerm)}%`);
      clauses.push(
        `(username ILIKE $${params.length} ESCAPE '\\' OR full_name ILIKE $${params.length} ESCAPE '\\' OR email ILIKE $${params.length} ESCAPE '\\')`
      );
    }

    const rows = await queryRowsWithPgSystemContext<Record<string, unknown>>(
      `
        SELECT
          id::text,
          username,
          full_name,
          email,
          avatar_url,
          role::text,
          status::text
        FROM profiles
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      params
    );

    return toSuccessResponse(rows || []);
  }

  return null;
}

async function handleProviderAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_PROVIDER_ACTIONS.has(action)) {
    return null;
  }

  if (
    action === 'providers.getAllProviders' ||
    action === 'providers.getActiveProviders'
  ) {
    const sql =
      action === 'providers.getActiveProviders'
        ? `
            SELECT
              id::text,
              name,
              type,
              base_url,
              auth_type,
              is_active,
              is_default,
              created_at::text,
              updated_at::text
            FROM providers
            WHERE is_active = TRUE
            ORDER BY name ASC
          `
        : `
            SELECT
              id::text,
              name,
              type,
              base_url,
              auth_type,
              is_active,
              is_default,
              created_at::text,
              updated_at::text
            FROM providers
            ORDER BY name ASC
          `;
    const rows = await queryRowsWithPgSystemContext<ProviderRow>(sql);
    return toSuccessResponse(rows.map(sanitizeProviderRow));
  }

  if (action === 'providers.createProvider') {
    const provider = readObject(payload?.provider);
    const name = readString(provider.name);
    const type = readString(provider.type);
    const baseUrl = readString(provider.base_url);
    const authType = readString(provider.auth_type);
    if (!name || !type || !baseUrl || !authType) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ProviderRow>(
      `
        INSERT INTO providers (
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING
          id::text,
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at::text,
          updated_at::text
      `,
      [
        name,
        type,
        baseUrl,
        authType,
        readBoolean(provider.is_active, true),
        readBoolean(provider.is_default, false),
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeProviderRow(rows[0]) : null);
  }

  if (action === 'providers.updateProvider') {
    const providerId = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!providerId) {
      return toErrorResponse('Missing id', 400);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      addSet('name', readString(updates.name) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'type')) {
      addSet('type', readString(updates.type) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'base_url')) {
      addSet('base_url', readString(updates.base_url) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'auth_type')) {
      addSet('auth_type', readString(updates.auth_type) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_active')) {
      addSet('is_active', readBoolean(updates.is_active, false));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_default')) {
      addSet('is_default', readBoolean(updates.is_default, false));
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(providerId);

    const rows = await queryRowsWithPgSystemContext<ProviderRow>(
      `
        UPDATE providers
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Provider not found', 404);
    }
    return toSuccessResponse(sanitizeProviderRow(rows[0]));
  }

  if (action === 'providers.deleteProvider') {
    const providerId = readString(payload?.id);
    if (!providerId) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM providers
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [providerId]
    );
    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}

async function handleServiceInstanceAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_SERVICE_INSTANCE_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'serviceInstances.getByProvider') {
    const providerId = readString(payload?.providerId);
    if (!providerId) {
      return toErrorResponse('Missing providerId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE provider_id = $1::uuid
        ORDER BY display_name ASC NULLS LAST
      `,
      [providerId]
    );
    return toSuccessResponse(rows.map(sanitizeServiceInstanceRow));
  }

  if (action === 'serviceInstances.getById') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    return toSuccessResponse(
      rows[0] ? sanitizeServiceInstanceRow(rows[0]) : null
    );
  }

  if (action === 'serviceInstances.create') {
    const serviceInstance = readObject(payload?.serviceInstance);
    const providerId = readString(serviceInstance.provider_id);
    const instanceId = readString(serviceInstance.instance_id);
    if (!providerId || !instanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const isDefault = readBoolean(serviceInstance.is_default, false);
    if (isDefault) {
      await queryRowsWithPgSystemContext(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1::uuid
            AND is_default = TRUE
        `,
        [providerId]
      );
    }

    const visibility =
      parseAppVisibility(serviceInstance.visibility) || 'public';
    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        INSERT INTO service_instances (
          provider_id,
          instance_id,
          api_path,
          display_name,
          description,
          is_default,
          visibility,
          config,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      [
        providerId,
        instanceId,
        readString(serviceInstance.api_path) || '',
        readString(serviceInstance.display_name) || null,
        readString(serviceInstance.description) || null,
        isDefault,
        visibility,
        JSON.stringify(readObject(serviceInstance.config)),
      ]
    );

    const created = rows[0] ? sanitizeServiceInstanceRow(rows[0]) : null;
    if (!created) {
      return toErrorResponse('Failed to create service instance', 500);
    }

    await ensureProviderDefaultServiceInstance(providerId, {
      preferredId: created.id,
    });

    const refreshedRows =
      await queryRowsWithPgSystemContext<ServiceInstanceRow>(
        `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
        [created.id]
      );

    return toSuccessResponse(
      refreshedRows[0] ? sanitizeServiceInstanceRow(refreshedRows[0]) : created
    );
  }

  if (action === 'serviceInstances.update') {
    const id = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const currentRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    const current = currentRows[0];
    if (!current) {
      return toErrorResponse('Service instance not found', 404);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!SERVICE_INSTANCE_UPDATE_COLUMNS.has(key)) {
        continue;
      }

      if (key === 'provider_id') {
        const providerId = readString(rawValue);
        if (!providerId) {
          continue;
        }
        setClauses.push(`provider_id = $${index}::uuid`);
        values.push(providerId);
        index += 1;
        continue;
      }

      if (key === 'visibility') {
        const visibility = parseAppVisibility(rawValue);
        if (!visibility) {
          continue;
        }
        setClauses.push(`visibility = $${index}`);
        values.push(visibility);
        index += 1;
        continue;
      }

      if (key === 'config') {
        setClauses.push(`config = $${index}::jsonb`);
        values.push(JSON.stringify(readObject(rawValue)));
        index += 1;
        continue;
      }

      if (key === 'is_default') {
        setClauses.push(`is_default = $${index}`);
        values.push(readBoolean(rawValue, false));
        index += 1;
        continue;
      }

      setClauses.push(`${key} = $${index}`);
      values.push(rawValue ?? null);
      index += 1;
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    const targetProviderId =
      (Object.prototype.hasOwnProperty.call(updates, 'provider_id')
        ? readString(updates.provider_id)
        : current.provider_id) || current.provider_id;
    const wantsDefault =
      Object.prototype.hasOwnProperty.call(updates, 'is_default') &&
      readBoolean(updates.is_default, false);

    if (wantsDefault) {
      await queryRowsWithPgSystemContext(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1::uuid
            AND id <> $2::uuid
        `,
        [targetProviderId, id]
      );
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        UPDATE service_instances
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Service instance not found', 404);
    }
    const updated = sanitizeServiceInstanceRow(rows[0]);

    await ensureProviderDefaultServiceInstance(targetProviderId, {
      preferredId: updated.is_default ? updated.id : null,
      excludeId: updated.is_default ? null : updated.id,
    });
    if (current.provider_id !== targetProviderId) {
      await ensureProviderDefaultServiceInstance(current.provider_id, {
        excludeId: updated.id,
      });
    }

    const refreshedRows =
      await queryRowsWithPgSystemContext<ServiceInstanceRow>(
        `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
        [updated.id]
      );

    return toSuccessResponse(
      refreshedRows[0] ? sanitizeServiceInstanceRow(refreshedRows[0]) : updated
    );
  }

  if (action === 'serviceInstances.delete') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const targetRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    const target = targetRows[0];
    if (!target) {
      return toSuccessResponse(false);
    }

    const deletedRows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM service_instances
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [id]
    );
    const deleted = Boolean(deletedRows[0]?.id);
    if (deleted) {
      await ensureProviderDefaultServiceInstance(target.provider_id);
    }
    return toSuccessResponse(deleted);
  }

  if (action === 'serviceInstances.setDefault') {
    const instanceId = readString(payload?.instanceId);
    if (!instanceId) {
      return toErrorResponse('Missing instanceId', 400);
    }

    const targetRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [instanceId]
    );
    const target = targetRows[0];
    if (!target) {
      return toErrorResponse('Specified service instance not found', 404);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE service_instances
        SET is_default = FALSE
        WHERE provider_id = $1::uuid
          AND is_default = TRUE
          AND id <> $2::uuid
      `,
      [target.provider_id, instanceId]
    );

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        UPDATE service_instances
        SET is_default = TRUE,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND provider_id = $2::uuid
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      [instanceId, target.provider_id]
    );

    if (!rows[0]) {
      return toErrorResponse('Failed to set default service instance', 500);
    }

    return toSuccessResponse(sanitizeServiceInstanceRow(rows[0]));
  }

  return null;
}

async function handleApiKeyAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_API_KEY_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'apiKeys.getByServiceInstance') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing serviceInstanceId', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
        FROM api_keys
        WHERE service_instance_id = $1::uuid
          AND is_default = TRUE
        LIMIT 1
      `,
      [serviceInstanceId]
    );

    return toSuccessResponse(rows[0] ? sanitizeApiKeyRow(rows[0]) : null);
  }

  if (action === 'apiKeys.create') {
    const apiKey = readObject(payload?.apiKey);
    const keyValue = readString(apiKey.key_value);
    if (!keyValue) {
      return toErrorResponse('Missing key_value', 400);
    }

    const isEncrypted = readBoolean(payload?.isEncrypted, false);
    let storedKeyValue = keyValue;
    if (!isEncrypted) {
      const masterKey = process.env.API_ENCRYPTION_KEY;
      if (!masterKey) {
        return toErrorResponse(
          'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key',
          500
        );
      }
      storedKeyValue = encryptApiKeyValue(keyValue, masterKey);
    }

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        INSERT INTO api_keys (
          provider_id,
          service_instance_id,
          user_id,
          key_value,
          is_default,
          usage_count,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6,
          $7::timestamptz,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
      `,
      [
        readString(apiKey.provider_id) || null,
        readString(apiKey.service_instance_id) || null,
        readString(apiKey.user_id) || null,
        storedKeyValue,
        readBoolean(apiKey.is_default, false),
        typeof apiKey.usage_count === 'number' &&
        Number.isFinite(apiKey.usage_count)
          ? Math.max(0, Math.floor(apiKey.usage_count))
          : 0,
        readString(apiKey.last_used_at) || null,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeApiKeyRow(rows[0]) : null);
  }

  if (action === 'apiKeys.update') {
    const id = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const isEncrypted = readBoolean(payload?.isEncrypted, false);
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (fragment: string, value: unknown) => {
      setClauses.push(`${fragment} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'provider_id')) {
      setClauses.push(`provider_id = $${index}::uuid`);
      values.push(readString(updates.provider_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'service_instance_id')) {
      setClauses.push(`service_instance_id = $${index}::uuid`);
      values.push(readString(updates.service_instance_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'user_id')) {
      setClauses.push(`user_id = $${index}::uuid`);
      values.push(readString(updates.user_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'key_value')) {
      const rawKeyValue = readString(updates.key_value);
      if (!rawKeyValue) {
        return toErrorResponse('Invalid key_value', 400);
      }
      if (isEncrypted) {
        addSet('key_value', rawKeyValue);
      } else {
        const masterKey = process.env.API_ENCRYPTION_KEY;
        if (!masterKey) {
          return toErrorResponse(
            'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key',
            500
          );
        }
        addSet('key_value', encryptApiKeyValue(rawKeyValue, masterKey));
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_default')) {
      addSet('is_default', readBoolean(updates.is_default, false));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'usage_count')) {
      const usageCount =
        typeof updates.usage_count === 'number' &&
        Number.isFinite(updates.usage_count)
          ? Math.max(0, Math.floor(updates.usage_count))
          : 0;
      addSet('usage_count', usageCount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'last_used_at')) {
      setClauses.push(`last_used_at = $${index}::timestamptz`);
      values.push(readString(updates.last_used_at) || null);
      index += 1;
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        UPDATE api_keys
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('API key not found', 404);
    }
    return toSuccessResponse(sanitizeApiKeyRow(rows[0]));
  }

  if (action === 'apiKeys.delete') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM api_keys
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [id]
    );
    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}

async function handleSsoAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_SSO_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'sso.getSsoProviders') {
    const filters = readObject(payload?.filters);
    const page = Math.max(1, parsePositiveInt(filters.page, 1));
    const pageSize = Math.max(
      1,
      Math.min(parsePositiveInt(filters.pageSize, 20), 100)
    );
    const sortBy = readString(filters.sortBy) || 'display_order';
    const sortOrder =
      readString(filters.sortOrder).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const sortColumn = SSO_SORT_COLUMN_MAP[sortBy] || 'display_order';

    const whereClauses: string[] = [];
    const whereParams: unknown[] = [];

    const protocol = parseSsoProtocol(filters.protocol);
    if (protocol) {
      whereParams.push(protocol);
      whereClauses.push(`protocol = $${whereParams.length}::sso_protocol`);
    }

    if (Object.prototype.hasOwnProperty.call(filters, 'enabled')) {
      whereParams.push(readBoolean(filters.enabled, false));
      whereClauses.push(`enabled = $${whereParams.length}`);
    }

    const search = readString(filters.search);
    if (search) {
      whereParams.push(`%${escapeLikePattern(search)}%`);
      whereClauses.push(
        `(name ILIKE $${whereParams.length} ESCAPE '\\' OR button_text ILIKE $${whereParams.length} ESCAPE '\\')`
      );
    }

    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRows = await queryRowsWithPgSystemContext<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM sso_providers ${whereSql}`,
      whereParams
    );
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const listRows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        SELECT
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
        FROM sso_providers
        ${whereSql}
        ORDER BY ${sortColumn} ${sortOrder}, id ASC
        LIMIT $${whereParams.length + 1}
        OFFSET $${whereParams.length + 2}
      `,
      [...whereParams, pageSize, offset]
    );

    return toSuccessResponse({
      providers: listRows.map(sanitizeSsoProviderRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  if (action === 'sso.getSsoProviderStats') {
    const rows = await queryRowsWithPgSystemContext<{
      protocol: string;
      enabled: boolean;
    }>(`SELECT protocol::text, enabled FROM sso_providers`);

    const stats = {
      total: rows.length,
      enabled: rows.filter(row => row.enabled).length,
      disabled: rows.filter(row => !row.enabled).length,
      byProtocol: {
        CAS: 0,
        SAML: 0,
        OAuth2: 0,
        OIDC: 0,
      },
    };

    rows.forEach(row => {
      if (row.protocol in stats.byProtocol) {
        const key = row.protocol as keyof typeof stats.byProtocol;
        stats.byProtocol[key] += 1;
      }
    });

    return toSuccessResponse(stats);
  }

  if (action === 'sso.getSsoProviderById') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        SELECT
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
        FROM sso_providers
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    return toSuccessResponse(rows[0] ? sanitizeSsoProviderRow(rows[0]) : null);
  }

  if (action === 'sso.createSsoProvider') {
    const data = readObject(payload?.data);
    const name = readString(data.name);
    const protocol = parseSsoProtocol(data.protocol);
    if (!name || !protocol) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        INSERT INTO sso_providers (
          name,
          protocol,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2::sso_protocol,
          $3::jsonb,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      [
        name,
        protocol,
        JSON.stringify(readObject(data.settings)),
        readString(data.client_id) || null,
        readString(data.client_secret) || null,
        readString(data.metadata_url) || null,
        readBoolean(data.enabled, true),
        Math.max(0, parsePositiveInt(data.display_order, 0)),
        readString(data.button_text) || null,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeSsoProviderRow(rows[0]) : null);
  }

  if (action === 'sso.updateSsoProvider') {
    const id = readString(payload?.id);
    const data = readObject(payload?.data);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (fragment: string, value: unknown) => {
      setClauses.push(`${fragment} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      addSet('name', readString(data.name) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'protocol')) {
      const protocol = parseSsoProtocol(data.protocol);
      if (!protocol) {
        return toErrorResponse('Invalid protocol', 400);
      }
      setClauses.push(`protocol = $${index}::sso_protocol`);
      values.push(protocol);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'settings')) {
      setClauses.push(`settings = $${index}::jsonb`);
      values.push(JSON.stringify(readObject(data.settings)));
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'client_id')) {
      addSet('client_id', readString(data.client_id) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'client_secret')) {
      addSet('client_secret', readString(data.client_secret) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'metadata_url')) {
      addSet('metadata_url', readString(data.metadata_url) || null);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'enabled')) {
      addSet('enabled', readBoolean(data.enabled, false));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'display_order')) {
      addSet(
        'display_order',
        Math.max(0, parsePositiveInt(data.display_order, 0))
      );
    }
    if (Object.prototype.hasOwnProperty.call(data, 'button_text')) {
      addSet('button_text', readString(data.button_text) || null);
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        UPDATE sso_providers
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('SSO provider not found', 404);
    }
    return toSuccessResponse(sanitizeSsoProviderRow(rows[0]));
  }

  if (action === 'sso.deleteSsoProvider') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    await queryRowsWithPgSystemContext(
      `DELETE FROM sso_providers WHERE id = $1::uuid`,
      [id]
    );
    return toSuccessResponse(null);
  }

  if (action === 'sso.toggleSsoProvider') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }
    const enabled = readBoolean(payload?.enabled, false);

    const rows = await queryRowsWithPgSystemContext<SsoProviderRow>(
      `
        UPDATE sso_providers
        SET enabled = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
          id::text,
          name,
          protocol::text,
          settings,
          client_id,
          client_secret,
          metadata_url,
          enabled,
          display_order,
          button_text,
          created_at::text,
          updated_at::text
      `,
      [id, enabled]
    );
    if (!rows[0]) {
      return toErrorResponse('SSO provider not found', 404);
    }
    return toSuccessResponse(sanitizeSsoProviderRow(rows[0]));
  }

  if (action === 'sso.updateSsoProviderOrder') {
    const rawUpdates = Array.isArray(payload?.updates) ? payload?.updates : [];
    const sanitizedUpdates = rawUpdates
      .map(item => readObject(item))
      .map(item => ({
        id: readString(item.id),
        display_order: Math.max(0, parsePositiveInt(item.display_order, 0)),
      }))
      .filter(item => item.id);

    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (sanitizedUpdates.length === 0) {
      return toSuccessResponse(null);
    }

    const rows = await queryRowsWithPgUserContext<{ updated_rows: number }>(
      actorUserId,
      undefined,
      `SELECT update_sso_provider_order($1::jsonb) AS updated_rows`,
      [JSON.stringify(sanitizedUpdates)]
    );

    if ((rows[0]?.updated_rows || 0) !== sanitizedUpdates.length) {
      return toErrorResponse('Failed to update all SSO providers', 500);
    }
    return toSuccessResponse(null);
  }

  return null;
}

async function handleErrorObservabilityAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_ERROR_OBSERVABILITY_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'errors.getSummary') {
    const hours = Math.min(parsePositiveInt(payload?.hours, 24), 720);
    const rows = await queryRowsWithPgSystemContext<{
      total_unique: string;
      total_occurrences: string;
      critical_count: string;
      error_count: string;
      warn_count: string;
      latest_at: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS total_unique,
          COALESCE(SUM(occurrence_count), 0)::text AS total_occurrences,
          COUNT(*) FILTER (WHERE severity = 'critical')::text AS critical_count,
          COUNT(*) FILTER (WHERE severity = 'error')::text AS error_count,
          COUNT(*) FILTER (WHERE severity = 'warn')::text AS warn_count,
          MAX(last_seen_at)::text AS latest_at
        FROM error_events
        WHERE last_seen_at >= NOW() - ($1::text || ' hours')::interval
      `,
      [hours]
    );
    const summary = rows[0];
    return toSuccessResponse({
      totalUnique: Number(summary?.total_unique || 0),
      totalOccurrences: Number(summary?.total_occurrences || 0),
      criticalCount: Number(summary?.critical_count || 0),
      errorCount: Number(summary?.error_count || 0),
      warnCount: Number(summary?.warn_count || 0),
      latestAt: summary?.latest_at || null,
    });
  }

  if (action === 'errors.getRecent') {
    const limit = Math.min(parsePositiveInt(payload?.limit, 50), 200);
    const offset = parsePositiveInt(payload?.offset, 0);
    const rows = await queryRowsWithPgSystemContext<Record<string, unknown>>(
      `
        SELECT
          id,
          fingerprint,
          code,
          source,
          severity,
          retryable,
          user_message,
          developer_message,
          http_status,
          method,
          route,
          request_id,
          trace_id,
          actor_user_id,
          context_json,
          first_seen_at,
          last_seen_at,
          occurrence_count,
          created_at,
          updated_at
        FROM error_events
        ORDER BY last_seen_at DESC
        LIMIT $1
        OFFSET $2
      `,
      [limit, offset]
    );
    return toSuccessResponse(rows);
  }

  return null;
}

async function handleLocalInternalDataAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  const conversationResult = await handleConversationAction(
    action,
    payload,
    actorUserId
  );
  if (conversationResult) {
    return conversationResult;
  }

  const messageResult = await handleMessageAction(action, payload, actorUserId);
  if (messageResult) {
    return messageResult;
  }

  const executionResult = await handleAppExecutionAction(
    action,
    payload,
    actorUserId
  );
  if (executionResult) {
    return executionResult;
  }

  const groupAuthResult = await handleGroupAuthAction(
    action,
    payload,
    actorUserId
  );
  if (groupAuthResult) {
    return groupAuthResult;
  }

  const userResult = await handleUserAction(action, payload, actorUserId);
  if (userResult) {
    return userResult;
  }

  const groupAdminResult = await handleGroupAdminAction(action, payload);
  if (groupAdminResult) {
    return groupAdminResult;
  }

  const providerResult = await handleProviderAction(action, payload);
  if (providerResult) {
    return providerResult;
  }

  const serviceInstanceResult = await handleServiceInstanceAction(
    action,
    payload
  );
  if (serviceInstanceResult) {
    return serviceInstanceResult;
  }

  const apiKeyResult = await handleApiKeyAction(action, payload);
  if (apiKeyResult) {
    return apiKeyResult;
  }

  const ssoResult = await handleSsoAction(action, payload, actorUserId);
  if (ssoResult) {
    return ssoResult;
  }

  const errorObservabilityResult = await handleErrorObservabilityAction(
    action,
    payload
  );
  if (errorObservabilityResult) {
    return errorObservabilityResult;
  }

  return null;
}

export const internalDataRoutes: FastifyPluginAsync<
  InternalDataRoutesOptions
> = async (app, options) => {
  app.post('/api/internal/data', async (request, reply) => {
    const body = normalizeRequestBody(request.body);
    const action = readString(body.action);
    const payload = normalizePayload(body);

    if (!action) {
      const response = toErrorResponse('Missing action', 400);
      return sendActionResponse(request, reply, response);
    }

    try {
      const permission = await ensureActionPermission(
        request,
        options.config,
        action,
        payload
      );
      if (permission.error) {
        return sendActionResponse(
          request,
          reply,
          permission.error,
          permission.actorUserId
        );
      }

      const localHandled = await handleLocalInternalDataAction(
        action,
        payload,
        permission.actorUserId
      );

      if (localHandled) {
        return sendActionResponse(
          request,
          reply,
          localHandled,
          permission.actorUserId
        );
      }

      const unsupported = toErrorResponse(`Unsupported action: ${action}`, 400);
      return sendActionResponse(
        request,
        reply,
        unsupported,
        permission.actorUserId
      );
    } catch (error) {
      const failed = toFailureResponse(error);
      return sendActionResponse(request, reply, failed);
    }
  });
};
