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
  recoverConversationTitleAfterStream,
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
      let persistConversationPromise: Promise<string | null> | null = null;
      let earlyTitleResolutionScheduled = false;
      let postStreamTitleRecoveryScheduled = false;

      const persistConversationIfNeeded = (difyConversationId: string) => {
        if (persistConversationPromise) {
          return persistConversationPromise;
        }

        persistConversationPromise = (async () => {
          const tempTitle = t('creating');
          console.log(
            `[useCreateConversation] Persisting conversation state, Dify conversation ID=${difyConversationId}`
          );

          return saveConversationRecord({
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
        })().catch(persistError => {
          console.error(
            '[useCreateConversation] Error occurred during conversation persistence:',
            persistError
          );
          return null;
        });

        return persistConversationPromise;
      };

      const scheduleInitialTitleResolutionAfterFirstAnswer = (
        difyConversationId: string,
        firstAnswerPromise: Promise<boolean> | undefined
      ) => {
        if (earlyTitleResolutionScheduled || !firstAnswerPromise) {
          return;
        }

        earlyTitleResolutionScheduled = true;
        void (async () => {
          const hasFirstAnswer = await firstAnswerPromise;
          if (!hasFirstAnswer) {
            return;
          }

          const dbId = await persistConversationIfNeeded(difyConversationId);
          startConversationTitleResolution({
            appId,
            difyConvId: difyConversationId,
            userIdentifier,
            tempConvId,
            tempTitle: t('creating'),
            untitledTitle: t('untitled'),
            dbId,
            startTitleTypewriter,
          });
        })().catch(error => {
          console.error(
            '[useCreateConversation] Initial title resolution failed:',
            error
          );
        });
      };

      const schedulePostStreamTitleRecovery = (difyConversationId: string) => {
        if (postStreamTitleRecoveryScheduled) {
          return;
        }

        postStreamTitleRecoveryScheduled = true;
        void (async () => {
          if (streamResponse?.completionPromise) {
            await streamResponse.completionPromise.catch(error => {
              console.error(
                '[useCreateConversation] Completion promise failed before title recovery:',
                error
              );
              return null;
            });
          }

          const dbId = await persistConversationIfNeeded(difyConversationId);
          await recoverConversationTitleAfterStream({
            appId,
            difyConvId: difyConversationId,
            userIdentifier,
            dbId,
            tempTitle: t('creating'),
            untitledTitle: t('untitled'),
          });
        })().catch(error => {
          console.error(
            '[useCreateConversation] Post-stream title recovery failed:',
            error
          );
        });
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
              scheduleInitialTitleResolutionAfterFirstAnswer(
                id,
                streamResponse?.firstAnswerPromise
              );
              schedulePostStreamTitleRecovery(id);
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
          scheduleInitialTitleResolutionAfterFirstAnswer(
            realConvIdFromStream,
            streamResponse.firstAnswerPromise
          );
          schedulePostStreamTitleRecovery(realConvIdFromStream);
        }

        setIsLoading(false);
        return {
          tempConvId,
          realConvId: realConvIdFromStream || undefined,
          taskId: taskIdFromStream || undefined,
          answerStream: streamResponse.answerStream,
          completionPromise: streamResponse.completionPromise,
          conversationPersistencePromise:
            persistConversationPromise || undefined,
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
