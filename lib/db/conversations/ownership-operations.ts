import { type Result, failure, success } from '@lib/types/result';

import {
  dataService,
  loadConversationRealtimeRow,
  publishRealtimeChangeBestEffort,
} from './shared';

export async function renameConversationForUser(
  userId: string,
  conversationId: string,
  newTitle: string
): Promise<Result<boolean>> {
  const title = newTitle.trim();
  if (!title) {
    return failure(new Error('Conversation title cannot be empty'));
  }

  const oldRow = await loadConversationRealtimeRow(userId, conversationId);

  const result = await dataService.rawQuery<{
    id: string;
    user_id: string;
    app_id: string | null;
    status: string | null;
    title: string | null;
    updated_at: string | null;
  }>(
    `
      UPDATE conversations
      SET title = $1, updated_at = NOW()
      WHERE id = $2::uuid
        AND user_id = $3::uuid
        AND status = 'active'
      RETURNING
        id::text AS id,
        user_id::text AS user_id,
        app_id,
        status,
        title,
        updated_at::text AS updated_at
    `,
    [title, conversationId, userId]
  );

  if (!result.success) {
    return failure(result.error);
  }

  if (result.data.length > 0) {
    dataService.clearCache('conversations');
    await publishRealtimeChangeBestEffort({
      table: 'conversations',
      eventType: 'UPDATE',
      oldRow,
      newRow: result.data[0],
    });
    return success(true);
  }

  return success(false);
}

export async function deleteConversationForUser(
  userId: string,
  conversationId: string
): Promise<Result<boolean>> {
  const oldRow = await loadConversationRealtimeRow(userId, conversationId);

  const result = await dataService.rawQuery<{
    id: string;
    user_id: string;
    app_id: string | null;
    status: string | null;
    title: string | null;
    updated_at: string | null;
  }>(
    `
      UPDATE conversations
      SET status = 'deleted', updated_at = NOW()
      WHERE id = $1::uuid
        AND user_id = $2::uuid
        AND status = 'active'
      RETURNING
        id::text AS id,
        user_id::text AS user_id,
        app_id,
        status,
        title,
        updated_at::text AS updated_at
    `,
    [conversationId, userId]
  );

  if (!result.success) {
    return failure(result.error);
  }

  if (result.data.length > 0) {
    dataService.clearCache('conversations');
    await publishRealtimeChangeBestEffort({
      table: 'conversations',
      eventType: 'UPDATE',
      oldRow,
      newRow: result.data[0],
    });
    return success(true);
  }

  return success(false);
}

export async function permanentlyDeleteConversation(
  conversationId: string
): Promise<Result<boolean>> {
  try {
    const oldConversationResult = await dataService.rawQuery<{
      id: string;
      user_id: string;
      app_id: string | null;
      status: string | null;
      title: string | null;
      updated_at: string | null;
    }>(
      `
        SELECT
          id::text AS id,
          user_id::text AS user_id,
          app_id,
          status,
          title,
          updated_at::text AS updated_at
        FROM conversations
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [conversationId]
    );

    const oldMessageResult = await dataService.rawQuery<{
      id: string;
      conversation_id: string;
    }>(
      `
        SELECT
          id::text AS id,
          conversation_id::text AS conversation_id
        FROM messages
        WHERE conversation_id = $1::uuid
        LIMIT 1
      `,
      [conversationId]
    );

    const transactionResult = await dataService.runInTransaction(
      async client => {
        await client.query('DELETE FROM messages WHERE conversation_id = $1', [
          conversationId,
        ]);
        await client.query('DELETE FROM conversations WHERE id = $1', [
          conversationId,
        ]);
        return true;
      }
    );
    if (!transactionResult.success) {
      return failure(transactionResult.error);
    }

    dataService.clearCache('messages');
    dataService.clearCache('conversations');

    const oldConversation = oldConversationResult.success
      ? oldConversationResult.data[0] || null
      : null;
    const oldMessage = oldMessageResult.success
      ? oldMessageResult.data[0] || null
      : null;

    if (oldMessage) {
      await publishRealtimeChangeBestEffort({
        table: 'messages',
        eventType: 'DELETE',
        oldRow: oldMessage,
        newRow: null,
      });
    }

    if (oldConversation) {
      await publishRealtimeChangeBestEffort({
        table: 'conversations',
        eventType: 'DELETE',
        oldRow: oldConversation,
        newRow: null,
      });
    }

    return success(true);
  } catch (error) {
    console.error('Failed to physically delete conversation:', error);
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}
