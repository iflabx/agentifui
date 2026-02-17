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
