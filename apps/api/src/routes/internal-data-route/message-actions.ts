import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { loadConversationOwnedByActor } from './auth';
import {
  buildAssistantPreview,
  parseMessageRole,
  parseMessageStatus,
  parsePositiveInt,
  readObject,
  readString,
  sanitizeMessage,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_MESSAGE_ACTIONS,
  type MessageRow,
} from './types';

export async function handleMessageAction(
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

  if (action === 'messages.updateMetadata') {
    const conversationId = readString(payload?.conversationId);
    const messageId = readString(payload?.messageId);
    const metadata = readObject(payload?.metadata) || {};

    if (!conversationId || !messageId) {
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
        UPDATE messages
        SET metadata = $3::jsonb
        WHERE id = $1::uuid
          AND conversation_id = $2::uuid
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
      [messageId, conversationId, JSON.stringify(metadata)]
    );

    if (!rows[0]) {
      return toErrorResponse('Message not found', 404);
    }

    return toSuccessResponse(sanitizeMessage(rows[0]));
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
