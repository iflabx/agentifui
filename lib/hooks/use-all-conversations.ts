/**
 * Hook to get all historical conversations.
 *
 * Unlike useSidebarConversations, this hook fetches all user conversations.
 * Mainly used for the full conversation list in the history page.
 */
import {
  getCurrentSession,
  subscribeAuthStateChange,
} from '@lib/auth/better-auth/http-client';
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import {
  SubscriptionKeys,
  realtimeService,
} from '@lib/services/db/realtime-service';
import { Conversation } from '@lib/types/database';

import { useCallback, useEffect, useState } from 'react';

/**
 * Hook to get all historical conversations.
 *
 * @returns All conversations, loading state, error, and operation functions
 */
export function useAllConversations() {
  // State definitions
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);
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
          setConversations([]);
          setTotal(0);
        }
      } catch {
        if (!isMounted) {
          return;
        }
        setUserId(null);
        setConversations([]);
        setTotal(0);
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

  // Function to load all conversations
  // No limit, fetch all user conversations
  const loadAllConversations = useCallback(
    async (_reset: boolean = false) => {
      if (!userId) {
        setConversations([]);
        setIsLoading(false);
        setTotal(0);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Use unified data service to get all conversations
        // Set a large limit to fetch all
        const result = await dataService.findMany<Conversation>(
          'conversations',
          {
            user_id: userId,
            status: 'active',
          },
          { column: 'updated_at', ascending: false },
          { offset: 0, limit: 1000 }, // Large limit to fetch all
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000, // 2 minutes cache, same as sidebar
            subscribe: true,
            subscriptionKey: SubscriptionKeys.allConversations(userId),
            onUpdate: payload => {
              // Handle realtime updates
              console.log(
                '[Realtime update] All conversations changed:',
                payload
              );

              // Clear cache and reload
              cacheService.deletePattern(`conversations:*`);

              // Delay reload to avoid frequent updates
              setTimeout(() => {
                loadAllConversations(true);
              }, 500);
            },
          }
        );

        if (result.success) {
          const conversations = result.data;

          setConversations(conversations);
          setTotal(conversations.length);
          setError(null);
        } else {
          console.error('Failed to load all conversations:', result.error);
          setError(result.error);
          setConversations([]);
          setTotal(0);
        }
      } catch (err) {
        console.error('Exception while loading all conversations:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setConversations([]);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  // Refresh conversation list
  const refresh = useCallback(() => {
    if (userId) {
      // Clear cache
      cacheService.deletePattern(`conversations:*`);
      loadAllConversations(true);
    }
  }, [userId, loadAllConversations]);

  // Initial load and reload on user change
  useEffect(() => {
    if (userId) {
      loadAllConversations(true);
    }
  }, [userId, loadAllConversations]);

  // Cleanup: unsubscribe on component unmount
  useEffect(() => {
    return () => {
      if (userId) {
        realtimeService.unsubscribe(SubscriptionKeys.allConversations(userId));
      }
    };
  }, [userId]);

  // Helper to delete a conversation
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

  // Helper to rename a conversation
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
    refresh,
    deleteConversation,
    renameConversation,
  };
}
