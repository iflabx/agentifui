/**
 * Sidebar conversations list hook (optimized version)
 *
 * Uses unified data service and real-time subscription management for better performance and error handling
 */
import {
  getCurrentSession,
  subscribeAuthStateChange,
} from '@lib/auth/better-auth/http-client';
import { callInternalDataAction } from '@lib/db/internal-data-api';
import { CacheKeys, cacheService } from '@lib/services/db/cache-service';
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

  type ConversationListPayload = {
    conversations: Conversation[];
    total: number;
  };

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
        const result = await callInternalDataAction<ConversationListPayload>(
          'conversations.getUserConversations',
          {
            userId,
            limit,
            offset: 0,
          }
        );

        if (result.success) {
          const conversations = result.data.conversations;

          setConversations(conversations);
          setTotal(result.data.total);
          setHasMore(result.data.total > conversations.length);
          setError(null);
        } else {
          console.error('Failed to load conversation list:', result.error);
          setError(result.error || new Error('Failed to load conversations'));
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

  // Helper function to delete a conversation
  const deleteConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!userId) return false;

      try {
        const result = await callInternalDataAction<boolean>(
          'conversations.deleteConversation',
          { userId, conversationId }
        );

        if (result.success && result.data) {
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
          setError(result.error || new Error('Failed to delete conversation'));
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
        const result = await callInternalDataAction<boolean>(
          'conversations.renameConversation',
          {
            userId,
            conversationId,
            title: newTitle,
          }
        );

        if (result.success && result.data) {
          // Update local state
          setConversations(prev =>
            prev.map(conv =>
              conv.id === conversationId
                ? {
                    ...conv,
                    title: newTitle,
                    updated_at: new Date().toISOString(),
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
          setError(result.error || new Error('Failed to rename conversation'));
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
