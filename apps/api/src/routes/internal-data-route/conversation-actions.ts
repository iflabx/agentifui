import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  parsePositiveInt,
  readString,
  sanitizeConversation,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  type ConversationRow,
  LOCAL_CONVERSATION_ACTIONS,
} from './types';

export async function handleConversationAction(
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
