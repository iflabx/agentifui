/**
 * New conversation creation hook
 * @description Provides creation and initialization functionality for new conversations
 *
 * @scope Only for conversation-type Dify applications (chatbot, agent, chatflow)
 * These applications store data in conversations + messages tables
 *
 * Task-type applications (workflow, text-generation) use independent components and storage logic,
 * storing data in app_executions table and not using this hook
 *
 * @features
 * - Dify API calls and streaming response handling
 * - Database conversation record creation
 * - Routing and state management
 * - Automatic conversation title generation
 * - Favorite apps management
 */
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { streamDifyChat } from '@lib/services/dify/chat-service';
import { DifyStreamResponse } from '@lib/services/dify/types';
import { useChatStore } from '@lib/stores/chat-store';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  buildStreamingConversationPayload,
  buildTempConversationId,
} from './create-conversation/payload';
import {
  saveConversationRecord,
  startConversationTitleResolution,
} from './create-conversation/persistence';
import {
  applyTemporaryConversationUi,
  syncFallbackConversationPath,
  syncRealConversationUi,
} from './create-conversation/routing';
import type {
  CreateConversationPayload,
  CreateConversationResult,
  OnConversationDbIdCreated,
  OnCreateConversationNodeEvent,
  UseCreateConversationReturn,
} from './create-conversation/types';

export function useCreateConversation(): UseCreateConversationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const t = useTranslations('sidebar');

  const addPendingWithLimit = usePendingConversationStore(
    state => state.addPendingWithLimit
  );
  const setRealIdAndStatus = usePendingConversationStore(
    state => state.setRealIdAndStatus
  );
  const updateTitleInPendingStore = usePendingConversationStore(
    state => state.updateTitle
  );
  const updateStatusInPendingStore = usePendingConversationStore(
    state => state.updateStatus
  );

  const startTitleTypewriter = usePendingConversationStore(
    state => state.startTitleTypewriter
  );

  const { session } = useAuthSession();
  const currentUserId = session?.user?.id;
  const setCurrentChatConversationId = useChatStore(
    state => state.setCurrentConversationId
  );

  const { addToFavorites } = useAutoAddFavoriteApp();

  const initiateNewConversation = useCallback(
    async (
      payloadData: CreateConversationPayload,
      appId: string,
      userIdentifier: string,
      onDbIdCreated?: OnConversationDbIdCreated,
      onNodeEvent?: OnCreateConversationNodeEvent
    ): Promise<CreateConversationResult> => {
      setIsLoading(true);
      setError(null);

      const tempConvId = buildTempConversationId();

      addPendingWithLimit(tempConvId, t('creating'), 20, evictedCount => {
        console.log(
          `[useCreateConversation] New conversation creation triggers eviction effect, expected to evict ${evictedCount} conversations`
        );
      });
      updateStatusInPendingStore(tempConvId, 'creating');

      applyTemporaryConversationUi(tempConvId, setCurrentChatConversationId);

      let streamResponse: DifyStreamResponse | null = null;
      let realConvIdFromStream: string | null = null;
      let taskIdFromStream: string | null = null;
      let persistConversationPromise: Promise<void> | null = null;

      const persistConversationIfNeeded = (difyConversationId: string) => {
        if (persistConversationPromise) {
          return persistConversationPromise;
        }

        persistConversationPromise = (async () => {
          const tempTitle = t('creating');
          console.log(
            `[useCreateConversation] Persisting conversation state, Dify conversation ID=${difyConversationId}`
          );

          const dbId = await saveConversationRecord({
            difyConvId: difyConversationId,
            title: tempTitle,
            tempConvId,
            currentUserId,
            appId,
            saveFailedTitle: t('saveFailed'),
            updateStatusInPendingStore,
            updateTitleInPendingStore,
            addToFavorites,
            onDbIdCreated,
          });

          startConversationTitleResolution({
            appId,
            difyConvId: difyConversationId,
            userIdentifier,
            tempConvId,
            tempTitle,
            untitledTitle: t('untitled'),
            dbId,
            startTitleTypewriter,
          });
        })().catch(persistError => {
          console.error(
            '[useCreateConversation] Error occurred during conversation persistence:',
            persistError
          );
        });

        return persistConversationPromise;
      };

      try {
        updateStatusInPendingStore(tempConvId, 'streaming_message');
        const chatPayload = buildStreamingConversationPayload(
          payloadData,
          userIdentifier
        );

        streamResponse = await streamDifyChat(
          chatPayload,
          appId,
          id => {
            if (id && !realConvIdFromStream) {
              realConvIdFromStream = id;
              console.log(
                `[useCreateConversation] Real conversation ID received from stream: ${id}`
              );

              syncRealConversationUi(tempConvId, id);

              setRealIdAndStatus(
                tempConvId,
                id,
                'stream_completed_title_pending'
              );
              updateStatusInPendingStore(tempConvId, 'title_fetching');

              void persistConversationIfNeeded(id);
            }
          },
          onNodeEvent
        );

        if (!realConvIdFromStream) {
          realConvIdFromStream = streamResponse.getConversationId();
        }
        if (!taskIdFromStream) {
          taskIdFromStream = streamResponse.getTaskId();
        }

        if (
          realConvIdFromStream &&
          !usePendingConversationStore
            .getState()
            .getPendingByRealId(realConvIdFromStream)?.realId
        ) {
          setRealIdAndStatus(
            tempConvId,
            realConvIdFromStream,
            'stream_completed_title_pending'
          );
          updateStatusInPendingStore(tempConvId, 'title_fetching');

          syncFallbackConversationPath(tempConvId, realConvIdFromStream);
        }

        if (realConvIdFromStream) {
          void persistConversationIfNeeded(realConvIdFromStream);
        }

        setIsLoading(false);
        return {
          tempConvId,
          realConvId: realConvIdFromStream || undefined,
          taskId: taskIdFromStream || undefined,
          answerStream: streamResponse.answerStream,
          completionPromise: streamResponse.completionPromise,
        };
      } catch (e) {
        console.error(
          '[useCreateConversation] Error initiating new conversation:',
          e
        );
        setError(e instanceof Error ? e : new Error(String(e)));
        setIsLoading(false);
        updateStatusInPendingStore(tempConvId, 'failed');
        updateTitleInPendingStore(tempConvId, t('createFailed'), true);
        return {
          tempConvId,
          error: e instanceof Error ? e : new Error(String(e)),
        };
      }
    },
    [
      addPendingWithLimit,
      setRealIdAndStatus,
      updateTitleInPendingStore,
      updateStatusInPendingStore,
      startTitleTypewriter,
      currentUserId,
      setCurrentChatConversationId,
      addToFavorites,
      t,
    ]
  );

  return {
    initiateNewConversation,
    isLoading,
    error,
  };
}
