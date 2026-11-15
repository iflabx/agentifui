import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { callInternalDataAction } from '@lib/db/internal-data-api';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import type { Conversation } from '@lib/types/database';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ConversationList {
  actorEpoch: number;
  conversations: Conversation[];
  isLoading: boolean;
  error: Error | null;
  total: number;
}

export function useUserConversations(limit: number) {
  const { loading: authLoading } = useAuthSession();
  const userId = useChatInputStore(state => state.actorId);
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const [list, setList] = useState<ConversationList>({
    actorEpoch,
    conversations: [],
    isLoading: true,
    error: null,
    total: 0,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);

  const isCurrentActor = useCallback(() => {
    const current = useChatInputStore.getState();
    return (
      mounted.current &&
      current.actorId === userId &&
      current.actorEpoch === actorEpoch
    );
  }, [userId, actorEpoch]);

  const loadConversations = useCallback(async () => {
    if (!userId || !isCurrentActor()) return;
    const version = ++requestVersion.current;
    const isCurrent = () =>
      isCurrentActor() && version === requestVersion.current;
    setList(previous => ({
      actorEpoch,
      conversations:
        previous.actorEpoch === actorEpoch ? previous.conversations : [],
      total: previous.actorEpoch === actorEpoch ? previous.total : 0,
      isLoading: true,
      error: null,
    }));
    try {
      const result = await callInternalDataAction<{
        conversations: Conversation[];
        total: number;
      }>('conversations.getUserConversations', { userId, limit, offset: 0 });
      if (!isCurrent()) return;
      if (!result.success) throw result.error;
      setList({
        actorEpoch,
        conversations: result.data.conversations,
        total: result.data.total,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setList({
        actorEpoch,
        conversations: [],
        total: 0,
        isLoading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [userId, actorEpoch, limit, isCurrentActor]);

  useEffect(() => {
    void loadConversations();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadConversations]);

  const mutateConversation = useCallback(
    async (conversationId: string, title?: string): Promise<boolean> => {
      if (!userId || !isCurrentActor()) return false;
      try {
        const result = await callInternalDataAction<boolean>(
          title === undefined
            ? 'conversations.deleteConversation'
            : 'conversations.renameConversation',
          { userId, conversationId, ...(title === undefined ? {} : { title }) }
        );
        if (!isCurrentActor()) return false;
        if (!result.success) throw result.error;
        if (!result.data) return false;
        if (title === undefined) {
          const pending = usePendingConversationStore.getState();
          for (const item of pending.pendingConversations.values())
            if (
              item.db_pk === conversationId ||
              item.realId === conversationId ||
              item.tempId === conversationId
            )
              pending.removePending(item.tempId);
        }
        requestVersion.current += 1;
        setList(previous => {
          if (previous.actorEpoch !== actorEpoch) return previous;
          return {
            ...previous,
            isLoading: false,
            error: null,
            total:
              title === undefined
                ? Math.max(0, previous.total - 1)
                : previous.total,
            conversations:
              title === undefined
                ? previous.conversations.filter(
                    item => item.id !== conversationId
                  )
                : previous.conversations.map(item =>
                    item.id === conversationId
                      ? { ...item, title, updated_at: new Date().toISOString() }
                      : item
                  ),
          };
        });
        return true;
      } catch (error) {
        if (isCurrentActor())
          setList(previous =>
            previous.actorEpoch === actorEpoch
              ? {
                  ...previous,
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                }
              : previous
          );
        return false;
      }
    },
    [userId, actorEpoch, isCurrentActor]
  );

  const deleteConversation = useCallback(
    (conversationId: string) => mutateConversation(conversationId),
    [mutateConversation]
  );
  const renameConversation = useCallback(
    (conversationId: string, title: string) =>
      mutateConversation(conversationId, title),
    [mutateConversation]
  );
  const visible = userId && list.actorEpoch === actorEpoch ? list : null;
  return {
    userId,
    actorEpoch,
    conversations: visible?.conversations ?? [],
    total: visible?.total ?? 0,
    isLoading: visible?.isLoading ?? (Boolean(userId) || authLoading),
    error: visible?.error ?? null,
    refresh: loadConversations,
    deleteConversation,
    renameConversation,
  };
}
