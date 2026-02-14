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
import { createConversation } from '@lib/db';
import { updateConversation } from '@lib/db/conversations';
import { streamDifyChat } from '@lib/services/dify/chat-service';
import { renameConversation } from '@lib/services/dify/conversation-service';
import { DifyStreamResponse } from '@lib/services/dify/types';
import type {
  DifyChatRequestPayload,
  DifyRetrieverResource,
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
  DifySseNodeFinishedEvent,
  DifySseNodeStartedEvent,
  DifySseParallelBranchFinishedEvent,
  DifySseParallelBranchStartedEvent,
  DifyUsage,
} from '@lib/services/dify/types';
import { useChatStore } from '@lib/stores/chat-store';
import { useAutoAddFavoriteApp } from '@lib/stores/favorite-apps-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

interface UseCreateConversationReturn {
  initiateNewConversation: (
    payload: Omit<
      DifyChatRequestPayload,
      'response_mode' | 'conversation_id' | 'auto_generate_name'
    >,
    appId: string,
    userIdentifier: string,
    onDbIdCreated?: (difyId: string, dbId: string) => void,
    onNodeEvent?: (
      event:
        | DifySseNodeStartedEvent
        | DifySseNodeFinishedEvent
        | DifySseIterationStartedEvent
        | DifySseIterationNextEvent
        | DifySseIterationCompletedEvent
        | DifySseParallelBranchStartedEvent
        | DifySseParallelBranchFinishedEvent
        | DifySseLoopStartedEvent
        | DifySseLoopNextEvent
        | DifySseLoopCompletedEvent
    ) => void // 🎯 New: Support node event callbacks
  ) => Promise<{
    tempConvId: string;
    realConvId?: string;
    taskId?: string;
    answerStream?: AsyncGenerator<string, void, undefined>;
    completionPromise?: Promise<{
      usage?: DifyUsage;
      metadata?: Record<string, unknown>;
      retrieverResources?: DifyRetrieverResource[];
    }>;
    error?: Error;
  }>;
  isLoading: boolean;
  error: Error | null;
}

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

  // 🎯 New: Actions related to typewriter effect
  const startTitleTypewriter = usePendingConversationStore(
    state => state.startTitleTypewriter
  );

  const { session } = useAuthSession();
  const currentUserId = session?.user?.id;
  const setCurrentChatConversationId = useChatStore(
    state => state.setCurrentConversationId
  );

  // Add favorite app management hook
  const { addToFavorites } = useAutoAddFavoriteApp();

  const initiateNewConversation = useCallback(
    async (
      payloadData: Omit<
        DifyChatRequestPayload,
        'response_mode' | 'conversation_id' | 'auto_generate_name'
      >,
      appId: string,
      userIdentifier: string,
      onDbIdCreated?: (difyId: string, dbId: string) => void,
      onNodeEvent?: (
        event:
          | DifySseNodeStartedEvent
          | DifySseNodeFinishedEvent
          | DifySseIterationStartedEvent
          | DifySseIterationNextEvent
          | DifySseIterationCompletedEvent
          | DifySseParallelBranchStartedEvent
          | DifySseParallelBranchFinishedEvent
          | DifySseLoopStartedEvent
          | DifySseLoopNextEvent
          | DifySseLoopCompletedEvent
      ) => void // 🎯 New: Support node event callbacks
    ): Promise<{
      tempConvId: string;
      realConvId?: string;
      taskId?: string;
      answerStream?: AsyncGenerator<string, void, undefined>;
      completionPromise?: Promise<{
        usage?: DifyUsage;
        metadata?: Record<string, unknown>;
        retrieverResources?: DifyRetrieverResource[];
      }>;
      error?: Error;
    }> => {
      setIsLoading(true);
      setError(null);

      const tempConvId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // 🎯 Use the new addPendingWithLimit method, support automatic "eviction" effect
      addPendingWithLimit(tempConvId, t('creating'), 20, evictedCount => {
        console.log(
          `[useCreateConversation] New conversation creation triggers eviction effect, expected to evict ${evictedCount} conversations`
        );
        // Here you can add animation effects or notify users
      });
      updateStatusInPendingStore(tempConvId, 'creating');

      // Early URL and state update for immediate UI feedback
      try {
        const currentPath = window.location.pathname;
        if (
          currentPath === '/chat/new' ||
          !currentPath.startsWith('/chat/temp-') ||
          currentPath.startsWith('/apps/')
        ) {
          // 🎯 Add support for application detail page paths
          console.log(
            `[useCreateConversation] Early highlight: Updating URL to /chat/${tempConvId}`
          );
          window.history.replaceState({}, '', `/chat/${tempConvId}`);
        }

        console.log(
          `[useCreateConversation] Early highlight: Setting ChatStore currentConversationId to ${tempConvId}`
        );
        setCurrentChatConversationId(tempConvId);

        const { selectItem } = useSidebarStore.getState();
        console.log(
          `[useCreateConversation] Early highlight: Selecting item in SidebarStore: ${tempConvId}`
        );
        selectItem('chat', tempConvId, true); // Keep current expanded state
      } catch (highlightError) {
        console.error(
          '[useCreateConversation] Error during early highlight:',
          highlightError
        );
      }

      let streamResponse: DifyStreamResponse | null = null;
      let realConvIdFromStream: string | null = null;
      let taskIdFromStream: string | null = null;

      try {
        updateStatusInPendingStore(tempConvId, 'streaming_message');
        const chatPayload: DifyChatRequestPayload = {
          ...payloadData,
          user: userIdentifier,
          response_mode: 'streaming',
          conversation_id: null,
          auto_generate_name: false,
        };

        streamResponse = await streamDifyChat(
          chatPayload,
          appId,
          id => {
            // onConversationIdReceived callback
            if (id && !realConvIdFromStream) {
              realConvIdFromStream = id;
              console.log(
                `[useCreateConversation] Real conversation ID received from stream: ${id}`
              );

              const currentPath = window.location.pathname;
              if (currentPath === `/chat/${tempConvId}`) {
                console.log(
                  `[useCreateConversation] Updating URL from ${currentPath} to /chat/${id}`
                );
                window.history.replaceState({}, '', `/chat/${id}`);
              } else if (
                currentPath.includes('/chat/temp-') ||
                currentPath === '/chat/new' ||
                currentPath.startsWith('/apps/')
              ) {
                // 🎯 Add support for application detail page paths
                console.log(
                  `[useCreateConversation] Updating URL (from new/temp/apps) to /chat/${id}`
                );
                window.history.replaceState({}, '', `/chat/${id}`);
              }

              try {
                const chatStoreState = useChatStore.getState();
                if (
                  chatStoreState.currentConversationId === tempConvId ||
                  chatStoreState.currentConversationId === null
                ) {
                  chatStoreState.setCurrentConversationId(id);
                }

                const sidebarStoreState = useSidebarStore.getState();
                if (
                  sidebarStoreState.selectedId === tempConvId ||
                  sidebarStoreState.selectedId === null
                ) {
                  sidebarStoreState.selectItem('chat', id, true); // Keep current expanded state
                }
              } catch (error) {
                console.error(
                  '[useCreateConversation] Error updating stores to realId:',
                  error
                );
              }

              setRealIdAndStatus(
                tempConvId,
                id,
                'stream_completed_title_pending'
              );
              updateStatusInPendingStore(tempConvId, 'title_fetching');

              // Immediately create database records, without waiting for title acquisition to complete
              // This ensures that messages can be saved during streaming responses
              const saveConversationToDb = async (
                difyConvId: string,
                convTitle: string,
                currentTempConvId: string
              ) => {
                if (!currentUserId || !appId) {
                  console.error(
                    '[useCreateConversation] Cannot save to DB: userId or appId is missing.',
                    { currentUserId, appId }
                  );
                  updateStatusInPendingStore(currentTempConvId, 'failed');
                  updateTitleInPendingStore(
                    currentTempConvId,
                    t('saveFailed'),
                    true
                  );
                  return;
                }
                try {
                  console.log(
                    `[useCreateConversation] Immediately create database records: difyId=${difyConvId}, title=${convTitle}, userId=${currentUserId}, appId=${appId}`
                  );

                  const result = await createConversation({
                    user_id: currentUserId,
                    app_id: appId,
                    external_id: difyConvId,
                    title: convTitle,
                    ai_config_id: null,
                    summary: null,
                    settings: {},
                    status: 'active',
                    last_message_preview: null, // Set by database trigger automatically
                    metadata: {},
                  });

                  if (result.success && result.data) {
                    const localConversation = result.data;
                    console.log(
                      `[useCreateConversation] Database records created successfully, database ID: ${localConversation.id}, Dify conversation ID: ${difyConvId}`
                    );

                    // 🎯 Add application to favorite list after conversation creation
                    // This is the best time: ensure that the conversation is truly created successfully, and only executed once when creating a new conversation
                    console.log(
                      `[useCreateConversation] Add application to favorite list: ${appId}`
                    );
                    addToFavorites(appId);

                    // 🎯 Enhance: Use atomic update to avoid race conditions
                    const { markAsPersistedComplete } =
                      usePendingConversationStore.getState();
                    markAsPersistedComplete(difyConvId, localConversation.id);

                    // Immediately call the callback function to notify that the database ID has been created
                    if (typeof onDbIdCreated === 'function') {
                      console.log(
                        `[useCreateConversation] Immediately notify that the database ID has been created: difyId=${difyConvId}, dbId=${localConversation.id}`
                      );
                      onDbIdCreated(difyConvId, localConversation.id);
                    }

                    return localConversation.id;
                  } else {
                    console.error(
                      `[useCreateConversation] Conversation creation failed:`,
                      result.error
                    );
                    throw new Error(
                      result.error?.message ||
                        'Failed to save conversation to local DB or local ID not returned.'
                    );
                  }
                } catch (dbError) {
                  console.error(
                    `[useCreateConversation] Error saving conversation (difyId: ${difyConvId}) to DB:`,
                    dbError
                  );
                  updateStatusInPendingStore(currentTempConvId, 'failed');
                  updateTitleInPendingStore(
                    currentTempConvId,
                    t('saveFailed'),
                    true
                  );
                  return null;
                }
              };

              // Use immediately executed asynchronous functions to process database record creation
              // This avoids the problem of using await in non-asynchronous callbacks
              (async () => {
                // Immediately create database records, using temporary title
                const tempTitle = t('creating');
                console.log(
                  `[useCreateConversation] Immediately create database records, Dify conversation ID=${id}`
                );
                const dbId = await saveConversationToDb(
                  id,
                  tempTitle,
                  tempConvId
                );

                // Asynchronously get the official title and update the database record
                renameConversation(appId, id, {
                  user: userIdentifier,
                  auto_generate: true,
                })
                  .then(async renameResponse => {
                    const finalTitle =
                      renameResponse && renameResponse.name
                        ? renameResponse.name
                        : t('untitled');
                    console.log(
                      `[useCreateConversation] Title acquisition successful, start typewriter effect: ${finalTitle}`
                    );

                    // 🎯 Start typewriter effect instead of directly updating the title
                    startTitleTypewriter(tempConvId, finalTitle);

                    // Update the title in the database
                    if (dbId && finalTitle !== tempTitle) {
                      try {
                        // Use imported updateConversation
                        await updateConversation(dbId, { title: finalTitle });
                        console.log(
                          `[useCreateConversation] Database title update successful: ${finalTitle}`
                        );
                      } catch (updateError) {
                        console.error(
                          `[useCreateConversation] Update database title failed:`,
                          updateError
                        );
                      }
                    }

                    // Only update the selected state when the current route is indeed this conversation
                    try {
                      const currentPath = window.location.pathname;
                      if (currentPath === `/chat/${id}`) {
                        const { selectItem } = useSidebarStore.getState();
                        selectItem('chat', id, true); // Keep current expanded state
                      }
                    } catch (error) {
                      console.error(
                        '[useCreateConversation] Error selecting item in sidebar after title:',
                        error
                      );
                    }
                  })
                  .catch(async renameError => {
                    console.error(
                      `[useCreateConversation] Title acquisition failed, use default title:`,
                      renameError
                    );
                    const fallbackTitle = t('untitled');

                    // 🎯 Start typewriter effect to display the default title
                    startTitleTypewriter(tempConvId, fallbackTitle);

                    // Update the title in the database
                    if (dbId) {
                      try {
                        // Use imported updateConversation
                        await updateConversation(dbId, {
                          title: fallbackTitle,
                        });
                        console.log(
                          `[useCreateConversation] Update database with default title: ${fallbackTitle}`
                        );
                      } catch (updateError) {
                        console.error(
                          `[useCreateConversation] Update default title failed:`,
                          updateError
                        );
                      }
                    }

                    // Only update the selected state when the current route is indeed this conversation
                    try {
                      const currentPath = window.location.pathname;
                      if (currentPath === `/chat/${id}`) {
                        const { selectItem } = useSidebarStore.getState();
                        selectItem('chat', id, true); // Keep current expanded state
                      }
                    } catch (error) {
                      console.error(
                        '[useCreateConversation] Error selecting item in sidebar (title fetch failed):',
                        error
                      );
                    }
                  });
              })().catch(error => {
                console.error(
                  '[useCreateConversation] Error occurred during database record creation:',
                  error
                );
              });
            }
          },
          onNodeEvent // 🎯 Pass node event callbacks, support chatflow node control
        );

        if (!realConvIdFromStream)
          realConvIdFromStream = streamResponse.getConversationId();
        if (!taskIdFromStream) taskIdFromStream = streamResponse.getTaskId();

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

          const currentPath = window.location.pathname;
          if (
            currentPath === `/chat/${tempConvId}` ||
            currentPath.includes('/chat/temp-') ||
            currentPath === '/chat/new' ||
            currentPath.startsWith('/apps/')
          ) {
            // 🎯 Add support for application detail page paths
            console.log(
              `[useCreateConversation] Updating URL (fallback) from ${currentPath} to /chat/${realConvIdFromStream}`
            );
            window.history.replaceState(
              {},
              '',
              `/chat/${realConvIdFromStream}`
            );
          }
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
