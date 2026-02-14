/**
 * Sidebar conversations list hook (optimized version)
 *
 * Uses unified data service and real-time subscription management for better performance and error handling
 */
import {
  getCurrentSession,
  subscribeAuthStateChange,
} from '@lib/auth/better-auth/http-client';
import { CacheKeys, cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import {
  SubscriptionKeys,
  realtimeService,
} from '@lib/services/db/realtime-service';
import { Conversation } from '@lib/types/database';

import { useCallback, useEffect, useState } from 'react';

/**
 * Sidebar conversations list hook
 *
 * @param limit Number of items per page, default is 20
 * @returns Conversation list, loading state, error info, and operation functions
 */
export function useSidebarConversations(limit: number = 20) {
  // State definitions, using simplified state management
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user ID
  useEffect(() => {
    let isMounted = true;

    const fetchUserId = async () => {
      try {
        const session = await getCurrentSession();
        const sessionUserId = session?.user?.id ?? null;
        if (!isMounted) {
          return;
        }

        if (sessionUserId) {
          setUserId(sessionUserId);
        } else {
          setUserId(null);
          // Clear state when user logs out
          setConversations([]);
          setTotal(0);
          setHasMore(false);
        }
      } catch {
        if (!isMounted) {
          return;
        }
        setUserId(null);
        setConversations([]);
        setTotal(0);
        setHasMore(false);
      }
    };

    void fetchUserId();

    const unsubscribe = subscribeAuthStateChange(() => {
      void fetchUserId();
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Optimized version of loading conversation list
  // Uses unified data service, supports cache and error handling
  const loadConversations = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (reset: boolean = false) => {
      if (!userId) {
        setConversations([]);
        setIsLoading(false);
        setTotal(0);
        setHasMore(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Use unified data service to get conversation list
        // Supports cache, sorting, and pagination
        const result = await dataService.findMany<Conversation>(
          'conversations',
          {
            user_id: userId,
            status: 'active',
          },
          { column: 'updated_at', ascending: false },
          { offset: 0, limit },
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000, // 2 minutes cache
            subscribe: true,
            subscriptionKey: SubscriptionKeys.sidebarConversations(userId),
            onUpdate: payload => {
              // Handle real-time updates
              console.log('[Realtime update] Conversation changed:', payload);

              // Clear cache and reload
              cacheService.deletePattern(`conversations:*`);

              // Delay reload to avoid frequent updates
              setTimeout(() => {
                loadConversations(true);
              }, 500);
            },
          }
        );

        if (result.success) {
          const conversations = result.data;

          setConversations(conversations);
          setTotal(conversations.length);
          setHasMore(conversations.length === limit); // Simplified hasMore check
          setError(null);
        } else {
          console.error('Failed to load conversation list:', result.error);
          setError(result.error);
          setConversations([]);
          setTotal(0);
          setHasMore(false);
        }
      } catch (err) {
        console.error('Exception while loading conversation list:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setConversations([]);
        setTotal(0);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, limit]
  );

  // Load more conversations (extendable feature)
  const loadMore = useCallback(async () => {
    if (!userId || isLoading || !hasMore) {
      return;
    }

    // Currently a simple implementation, can be extended to real pagination
    console.log(
      '[Load more] Pagination is not supported in current implementation'
    );
  }, [userId, isLoading, hasMore]);

  // Refresh conversation list
  const refresh = useCallback(() => {
    if (userId) {
      // Clear cache
      cacheService.deletePattern(`conversations:*`);
      loadConversations(true);
    }
  }, [userId, loadConversations]);

  // Initial load and reload when user changes
  useEffect(() => {
    if (userId) {
      loadConversations(true);
    }
  }, [userId, loadConversations]);

  // Cleanup: unsubscribe on component unmount
  useEffect(() => {
    return () => {
      if (userId) {
        realtimeService.unsubscribe(
          SubscriptionKeys.sidebarConversations(userId)
        );
      }
    };
  }, [userId]);

  // Helper function to delete a conversation
  const deleteConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!userId) return false;

      try {
        const result = await dataService.softDelete<Conversation>(
          'conversations',
          conversationId
        );

        if (result.success) {
          // Remove from local state immediately
          setConversations(prev =>
            prev.filter(conv => conv.id !== conversationId)
          );
          setTotal(prev => prev - 1);

          // Clear related cache
          cacheService.deletePattern(`conversations:*`);
          cacheService.delete(CacheKeys.conversation(conversationId));

          return true;
        } else {
          console.error('Failed to delete conversation:', result.error);
          setError(result.error);
          return false;
        }
      } catch (err) {
        console.error('Exception while deleting conversation:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return false;
      }
    },
    [userId]
  );

  // Helper function to rename a conversation
  const renameConversation = useCallback(
    async (conversationId: string, newTitle: string): Promise<boolean> => {
      if (!userId) return false;

      try {
        const result = await dataService.update<Conversation>(
          'conversations',
          conversationId,
          { title: newTitle }
        );

        if (result.success) {
          // Update local state
          setConversations(prev =>
            prev.map(conv =>
              conv.id === conversationId
                ? {
                    ...conv,
                    title: newTitle,
                    updated_at: result.data.updated_at,
                  }
                : conv
            )
          );

          // Clear related cache
          cacheService.deletePattern(`conversations:*`);
          cacheService.delete(CacheKeys.conversation(conversationId));

          return true;
        } else {
          console.error('Failed to rename conversation:', result.error);
          setError(result.error);
          return false;
        }
      } catch (err) {
        console.error('Exception while renaming conversation:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return false;
      }
    },
    [userId]
  );

  return {
    conversations,
    isLoading,
    error,
    total,
    hasMore,
    loadMore,
    refresh,
    // Helper functions
    deleteConversation,
    renameConversation,
    // Cache control
    clearCache: () => {
      if (userId) {
        cacheService.deletePattern(`conversations:*`);
      }
    },
  };
}
