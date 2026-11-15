import { useCallback } from 'react';

import { useUserConversations } from './use-user-conversations';

export function useSidebarConversations(limit: number = 20) {
  const list = useUserConversations(limit);
  const loadMore = useCallback(async () => undefined, []);
  return {
    ...list,
    hasMore: list.total > list.conversations.length,
    loadMore,
  };
}
