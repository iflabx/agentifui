import { Message } from '@lib/types/database';
import { Result } from '@lib/types/result';

import { dataService } from '../data-service';
import type { MessagePage, PaginationCursor } from './types';

export async function getMessagesPaginated(
  conversationId: string,
  options: {
    limit?: number;
    cursor?: string;
    direction?: 'newer' | 'older';
    includeCount?: boolean;
    cache?: boolean;
  } = {}
): Promise<Result<MessagePage>> {
  const {
    limit = 20,
    cursor,
    direction = 'older',
    includeCount = false,
    cache = true,
  } = options;

  const cacheKey = cache
    ? `conversation:messages:${conversationId}:${cursor ? `${cursor.substring(0, 8)}:${direction}:${limit}` : `initial:${limit}`}`
    : undefined;

  return dataService.query(
    async () => {
      let cursorData: PaginationCursor | null = null;
      if (cursor) {
        try {
          cursorData = JSON.parse(atob(cursor));
        } catch {
          throw new Error('Invalid pagination cursor');
        }
      }

      const params: unknown[] = [conversationId];
      const whereClauses = ['conversation_id = $1'];
      let nextParamIndex = 2;

      if (cursorData) {
        const timestampParam = `$${nextParamIndex}`;
        const idParam = `$${nextParamIndex + 1}`;
        params.push(cursorData.timestamp, cursorData.id);

        if (direction === 'older') {
          whereClauses.push(
            `(created_at < ${timestampParam} OR (created_at = ${timestampParam} AND id < ${idParam}))`
          );
        } else {
          whereClauses.push(
            `(created_at > ${timestampParam} OR (created_at = ${timestampParam} AND id > ${idParam}))`
          );
        }
        nextParamIndex += 2;
      }

      params.push(limit + 1);
      const limitParam = `$${nextParamIndex}`;
      const sql = `
        SELECT *
        FROM messages
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY created_at DESC, sequence_index DESC, id DESC
        LIMIT ${limitParam}
      `;
      const queryResult = await dataService.rawQuery<Message>(sql, params);
      if (!queryResult.success) {
        throw queryResult.error;
      }
      const rows = queryResult.data;

      const hasMore = rows.length > limit;
      const actualMessages = hasMore ? rows.slice(0, limit) : rows;

      let nextCursor: string | undefined;
      if (hasMore && actualMessages.length > 0) {
        const lastMessage = actualMessages[actualMessages.length - 1];
        const cursorObj: PaginationCursor = {
          timestamp: lastMessage.created_at,
          id: lastMessage.id,
        };
        nextCursor = btoa(JSON.stringify(cursorObj));
      }

      let totalCount: number | undefined;
      if (includeCount) {
        const countResult = await dataService.count('messages', {
          conversation_id: conversationId,
        });
        if (countResult.success) {
          totalCount = countResult.data;
        }
      }

      return {
        messages: actualMessages,
        hasMore,
        nextCursor,
        totalCount,
      };
    },
    cacheKey,
    { cache }
  );
}

export async function getLatestMessages(
  conversationId: string,
  limit: number = 20,
  options: { cache?: boolean } = {}
): Promise<Result<Message[]>> {
  const { cache = true } = options;

  return dataService.query(
    async () => {
      const queryResult = await dataService.rawQuery<Message>(
        `
        SELECT *
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC, sequence_index ASC, id ASC
        LIMIT $2
      `,
        [conversationId, limit]
      );
      if (!queryResult.success) {
        throw queryResult.error;
      }

      return queryResult.data;
    },
    cache
      ? `conversation:messages:latest:${conversationId}:${limit}`
      : undefined,
    { cache }
  );
}

export async function getMessageStats(conversationId: string): Promise<
  Result<{
    total: number;
    byRole: Record<string, number>;
    lastMessageAt?: string;
  }>
> {
  return dataService.query(async () => {
    const totalResult = await dataService.count('messages', {
      conversation_id: conversationId,
    });
    if (!totalResult.success) {
      throw totalResult.error;
    }

    const roleStatsResult = await dataService.rawQuery<{
      role: string;
      total: number;
    }>(
      `
        SELECT role, COUNT(*)::int AS total
        FROM messages
        WHERE conversation_id = $1
        GROUP BY role
      `,
      [conversationId]
    );
    if (!roleStatsResult.success) {
      throw roleStatsResult.error;
    }
    const byRole: Record<string, number> = {};
    roleStatsResult.data.forEach(item => {
      byRole[item.role] = Number(item.total || 0);
    });

    const lastMessageResult = await dataService.rawQuery<{
      created_at: string;
    }>(
      `
        SELECT created_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC, sequence_index DESC, id DESC
        LIMIT 1
      `,
      [conversationId]
    );
    if (!lastMessageResult.success) {
      throw lastMessageResult.error;
    }
    const lastMessage = lastMessageResult.data[0];
    const lastMessageAt = lastMessage
      ? String(lastMessage.created_at)
      : undefined;

    return {
      total: totalResult.data,
      byRole,
      lastMessageAt,
    };
  });
}
