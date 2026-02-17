import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
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

type InternalActionRequest = {
  action?: string;
  payload?: Record<string, unknown> | undefined;
};

type ApiActionResponse = {
  statusCode: number;
  payload: unknown;
  contentType: string;
  handler: 'local' | 'legacy';
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

const INTERNAL_DATA_HANDLER_HEADER = 'x-agentifui-internal-data-handler';
const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-requested-with',
] as const;

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

function buildUpstreamHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();

  for (const key of FORWARDED_HEADERS) {
    const value = request.headers[key];
    if (typeof value === 'string' && value.length > 0) {
      headers.set(key, value);
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      headers.set(key, value.join(', '));
    }
  }

  headers.set(FASTIFY_BYPASS_HEADER, '1');
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return headers;
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

  return null;
}

async function proxyLegacyInternalDataRequest(
  request: FastifyRequest,
  body: InternalActionRequest,
  config: ApiRuntimeConfig
): Promise<ApiActionResponse> {
  const targetUrl = new URL('/api/internal/data', config.nextUpstreamBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.internalDataProxyTimeoutMs
  );

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: buildUpstreamHeaders(request),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const contentType =
      response.headers.get('content-type')?.trim() || 'application/json';

    if (!responseText.trim()) {
      return {
        statusCode: response.status,
        contentType: 'application/json',
        payload: {
          success: response.ok,
          error: response.ok ? null : 'Empty upstream response',
        },
        handler: 'legacy',
      };
    }

    if (contentType.toLowerCase().includes('application/json')) {
      try {
        return {
          statusCode: response.status,
          payload: JSON.parse(responseText) as unknown,
          contentType,
          handler: 'legacy',
        };
      } catch {
        return {
          statusCode: response.status,
          contentType: 'application/json',
          payload: {
            success: false,
            error: responseText,
          },
          handler: 'legacy',
        };
      }
    }

    return {
      statusCode: response.status,
      contentType,
      payload: responseText,
      handler: 'legacy',
    };
  } catch (error) {
    request.log.error(
      { err: error },
      '[FastifyAPI][internal-data] legacy proxy request failed'
    );
    return {
      statusCode: 502,
      contentType: 'application/json',
      payload: {
        success: false,
        error: 'Failed to proxy internal data action',
      },
      handler: 'legacy',
    };
  } finally {
    clearTimeout(timeout);
  }
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
      return reply
        .status(response.statusCode)
        .header('content-type', response.contentType)
        .header(INTERNAL_DATA_HANDLER_HEADER, response.handler)
        .send(response.payload);
    }

    try {
      const permission = await ensureActionPermission(
        request,
        options.config,
        action,
        payload
      );
      if (permission.error) {
        return reply
          .status(permission.error.statusCode)
          .header('content-type', permission.error.contentType)
          .header(INTERNAL_DATA_HANDLER_HEADER, permission.error.handler)
          .send(permission.error.payload);
      }

      const localHandled = await handleLocalInternalDataAction(
        action,
        payload,
        permission.actorUserId
      );

      if (localHandled) {
        return reply
          .status(localHandled.statusCode)
          .header('content-type', localHandled.contentType)
          .header(INTERNAL_DATA_HANDLER_HEADER, localHandled.handler)
          .send(localHandled.payload);
      }

      const legacyHandled = await proxyLegacyInternalDataRequest(
        request,
        body,
        options.config
      );

      return reply
        .status(legacyHandled.statusCode)
        .header('content-type', legacyHandled.contentType)
        .header(INTERNAL_DATA_HANDLER_HEADER, legacyHandled.handler)
        .send(legacyHandled.payload);
    } catch (error) {
      const failed = toFailureResponse(error);
      return reply
        .status(failed.statusCode)
        .header('content-type', failed.contentType)
        .header(INTERNAL_DATA_HANDLER_HEADER, failed.handler)
        .send(failed.payload);
    }
  });
};
