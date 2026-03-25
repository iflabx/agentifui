import { dataService } from '@lib/services/db/data-service';

import type { RealtimeRow } from './types';
import { IS_BROWSER } from './types';

export { dataService };

export async function publishRealtimeChangeBestEffort(input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}) {
  if (IS_BROWSER) {
    return;
  }

  try {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const publisherModule = runtimeRequire(
      '../../server/realtime/publisher'
    ) as {
      publishTableChangeEvent?: (payload: {
        table: string;
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        newRow: RealtimeRow | null;
        oldRow: RealtimeRow | null;
      }) => Promise<void>;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher(input);
  } catch (error) {
    console.warn('[ConversationsDB] Realtime publish failed:', error);
  }
}

export async function loadConversationRealtimeRow(
  userId: string,
  conversationId: string
): Promise<RealtimeRow | null> {
  const rowResult = await dataService.rawQuery<{
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
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [conversationId, userId]
  );

  if (!rowResult.success || !rowResult.data[0]) {
    return null;
  }

  return rowResult.data[0];
}
