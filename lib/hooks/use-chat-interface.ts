/**
 * Chat interface interaction hook
 *
 * @description Scope: Only for dialog-based Dify apps (chatbot, agent, chatflow)
 * These apps store data in conversations + messages tables
 *
 * Task-based apps (workflow, text-generation) use separate components and storage logic,
 * storing data in app_executions table, and do not use this hook
 *
 * @features Provides full chat functionality, including:
 * - Message sending and receiving
 * - Streaming response handling
 * - Conversation creation and management
 * - Message persistence
 * - File upload support
 * - Error handling and retry
 */
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import {
  stopDifyStreamingTask,
  streamDifyChat,
} from '@lib/services/dify/chat-service';
// Use new hook
import type {
  ChatUploadFile,
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
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { selectIsProcessing, useChatStore } from '@lib/stores/chat-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import type { ServiceInstance } from '@lib/types/database';

import { useCallback, useEffect, useRef, useState } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { useChatMessages } from './use-chat-messages';
import { useCreateConversation } from './use-create-conversation';

// Remove hardcoded DIFY_APP_IDENTIFIER and currentUserIdentifier
// These will be obtained from store and auth hook
// Streaming experience optimization: reduce batch update interval for better responsiveness
// Lowered from 100ms to 30ms for smoother streaming effect
const CHUNK_APPEND_INTERVAL = 30;

// Multi-provider support: chat interface now supports multi-provider environments
// ensureAppReady and validateConfig have been updated to use default provider fallback
// When sending messages in /chat/new, the appropriate provider and app will be selected automatically

/**
 * Chat interface interaction hook
 * @description Provides full chat functionality, supports multi-provider environments
 * @param onNodeEvent - Optional node event callback function
 * @returns Various chat interface states and operation methods
 */
export function useChatInterface(
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
  ) => void
) {
  const router = useRouter();
  const currentPathname = usePathname();
  const { isWelcomeScreen, setIsWelcomeScreen } = useChatInputStore();

  // Get authentication state and current app info using new hook
  const { session } = useAuthSession();
  const currentUserId = session?.user?.id;
  const {
    currentAppId,
    currentAppInstance,
    isLoading: isLoadingAppId,
    error: errorLoadingAppId,
    ensureAppReady, // New: method to force wait for app config to be ready
    validateConfig, // New: method to validate and switch app config
  } = useCurrentApp();
  const messages = useChatStore(state => state.messages);
  const addMessage = useChatStore(state => state.addMessage);
  const appendMessageChunk = useChatStore(state => state.appendMessageChunk);
  const finalizeStreamingMessage = useChatStore(
    state => state.finalizeStreamingMessage
  );
  const markAsManuallyStopped = useChatStore(
    state => state.markAsManuallyStopped
  );
  const setMessageError = useChatStore(state => state.setMessageError);
  const setIsWaitingForResponse = useChatStore(
    state => state.setIsWaitingForResponse
  );
  const setCurrentConversationId = useChatStore(
    state => state.setCurrentConversationId
  );
  const setCurrentTaskId = useChatStore(state => state.setCurrentTaskId);
  const updateMessage = useChatStore(state => state.updateMessage); // Add updateMessage function

  const { initiateNewConversation } = useCreateConversation();
  const updatePendingStatus = usePendingConversationStore(
    state => state.updateStatus
  );

  // Use message persistence hook, pass in current user ID
  const { saveMessage, saveStoppedAssistantMessage, saveErrorPlaceholder } =
    useChatMessages(currentUserId);

  // State management:
  // difyConversationId: Dify conversation ID (external), for routing and API
  // dbConversationUUID: Database conversation ID (internal), for message persistence
  // conversationAppId: Original appId for historical conversation, takes precedence over current app in localStorage
  const [difyConversationId, setDifyConversationId] = useState<string | null>(
    null
  );
  const [dbConversationUUID, setDbConversationUUID] = useState<string | null>(
    null
  );
  const [conversationAppId, setConversationAppId] = useState<string | null>(
    null
  );

  const isSubmittingRef = useRef(false);
  // For accumulating data chunks
  const chunkBufferRef = useRef('');
  // For chunk buffer flush timer
  const appendTimerRef = useRef<NodeJS.Timeout | null>(null);

  // For streaming state check
  const lastStreamingCheckRef = useRef<{
    messageId: string;
    content: string;
    lastUpdateTime: number;
  } | null>(null);

  const flushChunkBuffer = useCallback(
    (id: string | null) => {
      if (id && chunkBufferRef.current) {
        appendMessageChunk(id, chunkBufferRef.current);
        chunkBufferRef.current = '';
        // If more precise timing is needed, lastAppendTime can be a ref, or just reset here
      }
      if (appendTimerRef.current) {
        clearTimeout(appendTimerRef.current);
        appendTimerRef.current = null;
      }
    },
    [appendMessageChunk]
  );

  // Routing listener logic:
  // 1. If valid conversation URL, get Dify conversation ID and query database conversation ID
  // 2. If new or temp conversation, reset state
  useEffect(() => {
    // If current path contains conversation ID (not new or temp-), try to extract Dify conversation ID from URL
    if (
      currentPathname &&
      currentPathname.startsWith('/chat/') &&
      !currentPathname.includes('/chat/new') &&
      !currentPathname.includes('/chat/temp-')
    ) {
      const pathConversationId = currentPathname.replace('/chat/', '');

      // Set Dify conversation ID
      setDifyConversationId(pathConversationId);

      // Query database conversation record by Dify conversation ID
      const fetchDbConversation = async () => {
        try {
          console.log(
            `[Route Listener] Start querying conversation record with external ID ${pathConversationId}`
          );

          const result = await getConversationByExternalId(pathConversationId);

          if (result.success && result.data) {
            console.log(
              `[Route Listener] Found conversation record, dbID=${result.data.id}, original appId=${result.data.app_id}`
            );
            setDbConversationUUID(result.data.id);

            // Key fix: save original appId for historical conversation
            // This ensures correct app is used when continuing historical conversation, not the one in localStorage
            if (result.data.app_id) {
              setConversationAppId(result.data.app_id);
              console.log(
                `[Route Listener] Set conversation original appId: ${result.data.app_id}`
              );
            } else {
              setConversationAppId(null);
              console.log(
                `[Route Listener] No appId in conversation record, will use current selected app`
              );
            }
          } else if (result.success && !result.data) {
            console.log(
              `[Route Listener] No conversation record found for external ID ${pathConversationId}`
            );
            setDbConversationUUID(null);
            setConversationAppId(null);
          } else {
            console.error(
              `[Route Listener] Query conversation record failed:`,
              result.error
            );
            setDbConversationUUID(null);
            setConversationAppId(null);
          }
        } catch (error) {
          console.error(
            `[Route Listener] Exception querying conversation record:`,
            error
          );
          setDbConversationUUID(null);
          setConversationAppId(null);
        }
      };

      fetchDbConversation();
    } else if (
      currentPathname === '/chat/new' ||
      (currentPathname && currentPathname.includes('/chat/temp-'))
    ) {
      // New or temp conversation, clear all IDs
      console.log(`[Route Listener] New or temp conversation, reset state`);
      setDifyConversationId(null);
      setDbConversationUUID(null);
      setConversationAppId(null);
    }
  }, [currentPathname]);

  const handleSubmit = useCallback(
    async (
      message: string,
      files?: unknown[],
      inputs?: Record<string, unknown>
    ) => {
      if (isSubmittingRef.current) {
        console.warn('[handleSubmit] Submission blocked: already submitting.');
        return;
      }
      if (selectIsProcessing(useChatStore.getState())) {
        console.warn(
          '[handleSubmit] Submission blocked: chat store isProcessing.'
        );
        return;
      }

      // Check if user is logged in before submitting
      if (!currentUserId) {
        console.error('useChatInterface.handleSubmit: User not authenticated.');
        // @future: can show user-friendly notification via useNotificationStore
        return;
      }

      // Core change: smart app selection logic
      // 1. For historical conversation, use original appId from conversation record
      // 2. For new conversation or if no appId, use current selected app
      // 3. Force wait for app config to be ready to solve timing issues
      let appConfig: { appId: string; instance: ServiceInstance };
      try {
        console.log('[handleSubmit] Start determining app to use...');

        // Smart app selection: historical conversation uses original app, new uses current
        if (conversationAppId) {
          console.log(
            `[handleSubmit] Historical conversation, using original appId: ${conversationAppId}`
          );
          // For historical conversation, validate and switch to original app
          await validateConfig(conversationAppId, 'message'); // Specify as message context
          appConfig = await ensureAppReady();

          // Validate if successfully switched to target app
          if (appConfig.appId !== conversationAppId) {
            console.warn(
              `[handleSubmit] Failed to switch to original app, expected: ${conversationAppId}, actual: ${appConfig.appId}`
            );
            // Can choose to throw error or continue with current app
          }
        } else {
          console.log(
            '[handleSubmit] New conversation or no original appId, using current selected app'
          );
          // For new conversation, use current selected app
          appConfig = await ensureAppReady();
        }

        console.log(`[handleSubmit] Final app used: ${appConfig.appId}`);
      } catch (error) {
        console.error('[handleSubmit] Failed to get app config:', error);

        // Error recovery: add error message to chat UI for user feedback
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to get app config';
        addMessage({
          text: `Sorry, failed to get app config: ${errorMessage}. Please check your network or contact admin.`,
          isUser: false,
          error: errorMessage,
          persistenceStatus: 'error', // Mark as error, do not try to persist
        });

        return;
      }

      isSubmittingRef.current = true;
      setIsWaitingForResponse(true);

      const messageAttachments =
        Array.isArray(files) && files.length > 0
          ? files.map((file: unknown) => {
              const uploadFile = file as ChatUploadFile;
              return {
                id: uploadFile.upload_file_id,
                name: uploadFile.name,
                size: uploadFile.size,
                type: uploadFile.mime_type,
                upload_file_id: uploadFile.upload_file_id,
              };
            })
          : undefined;

      // Add user message, set initial status to pending (waiting to be saved)
      const userMessage = addMessage({
        text: message,
        isUser: true,
        attachments: messageAttachments,
        persistenceStatus: 'pending', // Set persistence status to pending
        sequence_index: 0,
      });

      if (isWelcomeScreen) {
        setIsWelcomeScreen(false);
        if (window.location.pathname === '/chat/new') {
          window.history.replaceState({}, '', `/chat/temp-${Date.now()}`);
        }
      }

      let assistantMessageId: string | null = null;
      let streamError: Error | null = null;
      setCurrentTaskId(null);

      // Modified logic for determining new conversations using difyConversationId instead of currentConvId
      // 1. If URL is /chat/new or contains temp-, it's a new conversation
      // 2. If no difyConversationId exists, also treat as new conversation
      const urlIndicatesNew =
        window.location.pathname === '/chat/new' ||
        window.location.pathname.includes('/chat/temp-');
      const isNewConversationFlow = urlIndicatesNew || !difyConversationId;

      if (isNewConversationFlow) {
        // Ensure Dify conversation ID is null
        if (difyConversationId !== null) {
          setDifyConversationId(null);
        }
        // Database ID can remain unchanged, as it's independent
        const currentConvId = useChatStore.getState().currentConversationId;
        if (urlIndicatesNew && currentConvId !== null) {
          setCurrentConversationId(null);
        }
      }

      chunkBufferRef.current = '';
      let lastAppendTime = Date.now();

      let answerStream: AsyncGenerator<string, void, undefined> | undefined;
      let finalRealConvId: string | undefined;
      let finalTaskId: string | undefined;

      // For storing database conversation ID, which is key for message persistence
      // Only after getting a valid db conversation ID can we save messages
      let finalDbConvUUID: string | null = null;

      // Store completionPromise for Dify metadata
      let completionPromise:
        | Promise<{
            usage?: DifyUsage;
            metadata?: Record<string, unknown>;
            retrieverResources?: DifyRetrieverResource[];
          }>
        | undefined;

      try {
        // Convert messageAttachments to DifyFile[]
        // Assume DifyFile needs type and upload_file_id
        // Note: type should be inferred from mime_type, or let Dify handle it.
        // DifyFile type is 'image' | 'document', not mime_type.
        // This is a simplified handling; real projects may need more complex mapping.
        // For now, assume all files are 'document' type and use upload_file_id.
        const difyFiles:
          | {
              type: 'document';
              transfer_method: 'local_file';
              upload_file_id: string;
            }[]
          | undefined =
          Array.isArray(files) && files.length > 0
            ? files.map((file: unknown) => {
                const uploadFile = file as ChatUploadFile;
                return {
                  type: 'document' as const,
                  transfer_method: 'local_file' as const,
                  upload_file_id: uploadFile.upload_file_id,
                };
              })
            : undefined;

        const basePayloadForNewConversation = {
          query: message,
          user: currentUserId, // Use dynamically obtained currentUserId
          inputs: inputs || {},
          ...(difyFiles && { files: difyFiles }),
        };

        if (isNewConversationFlow) {
          // New conversation logic:
          // 1. Call initiateNewConversation to create new conversation
          // 2. Get Dify conversation ID (finalRealConvId)
          // 3. Query database conversation ID (finalDbConvUUID)
          const creationResult = await initiateNewConversation(
            basePayloadForNewConversation,
            appConfig.appId, // Use ensured appId
            currentUserId, // Explicitly pass userIdentifier
            // Add db ID callback
            (difyId, dbId) => {
              console.log(
                `[handleSubmit] Received db conversation ID callback: difyId=${difyId}, dbId=${dbId}`
              );

              // Immediately set db conversation ID
              finalDbConvUUID = dbId;
              setDbConversationUUID(dbId);

              // Save user message
              if (userMessage && userMessage.persistenceStatus !== 'saved') {
                console.log(
                  `[handleSubmit] Save user message in callback, ID=${userMessage.id}, db conversation ID=${dbId}`
                );
                saveMessage(userMessage, dbId).catch(err => {
                  console.error(
                    '[handleSubmit] Failed to save user message in callback:',
                    err
                  );
                });
              }

              // Simplified fix: save user message in callback, assistant message will be saved after streaming ends
              // This ensures correct timing and avoids complex timer logic
              console.log(
                `[handleSubmit] DB ID callback done, user message saved, assistant message will be saved after streaming`
              );
            },
            onNodeEvent // Pass node event callback for chatflow node control
          );

          if (creationResult.error) {
            console.error(
              '[handleSubmit] Failed to create new conversation:',
              creationResult.error
            );
            throw creationResult.error;
          }

          answerStream = creationResult.answerStream;
          finalRealConvId = creationResult.realConvId;
          finalTaskId = creationResult.taskId;

          // Fix: get completionPromise from new conversation creation result
          completionPromise = creationResult.completionPromise;

          if (finalRealConvId) {
            // Update UI and route
            if (
              useChatStore.getState().currentConversationId !== finalRealConvId
            ) {
              setCurrentConversationId(finalRealConvId);
            }
            if (currentPathname !== `/chat/${finalRealConvId}`) {
              router.replace(`/chat/${finalRealConvId}`, { scroll: false });
            }

            // Query db conversation ID, which is key for message persistence
            // Note: initiate function already creates db record, so we can query directly
            try {
              const result = await getConversationByExternalId(finalRealConvId);

              if (result.success && result.data) {
                finalDbConvUUID = result.data.id;
                setDbConversationUUID(finalDbConvUUID);
              } else {
                finalDbConvUUID = null;
              }
            } catch (dbError) {
              console.error(
                `[handleSubmit] Failed to query db ID for new conversation:`,
                dbError
              );
              finalDbConvUUID = null;
            }
          }

          if (finalTaskId) {
            setCurrentTaskId(finalTaskId);
          }
        } else {
          // Existing conversation logic:
          // 1. First get db conversation ID (if not already)
          // 2. Call Dify API to send message
          // 3. Update various IDs and states
          // Get db conversation ID, which is key for message persistence
          if (dbConversationUUID) {
            // If already have db conversation ID, use it
            finalDbConvUUID = dbConversationUUID;
          } else if (difyConversationId) {
            // If no db conversation ID but have Dify conversation ID, try to query
            try {
              const result =
                await getConversationByExternalId(difyConversationId);

              if (result.success && result.data) {
                finalDbConvUUID = result.data.id;
                setDbConversationUUID(finalDbConvUUID);
              } else {
                finalDbConvUUID = null;
              }
            } catch (dbError) {
              console.error(
                `[handleSubmit] Failed to query db ID for existing conversation:`,
                dbError
              );
              finalDbConvUUID = null;
            }
          }

          // Key fix: save user message early in historical conversation
          // Solves issue where user message is lost if user clicks stop
          // Save user message before streaming starts to ensure it's not lost
          if (
            finalDbConvUUID &&
            userMessage &&
            userMessage.persistenceStatus !== 'saved'
          ) {
            console.log(
              `[handleSubmit] Save user message early in historical conversation, ID=${userMessage.id}, db conversation ID=${finalDbConvUUID}`
            );

            // Save user message immediately, do not wait for streaming
            saveMessage(userMessage, finalDbConvUUID)
              .then(() => {
                console.log(
                  `[handleSubmit] User message saved early in historical conversation, ID=${userMessage.id}`
                );
              })
              .catch(err => {
                console.error(
                  `[handleSubmit] Failed to save user message early in historical conversation, ID=${userMessage.id}:`,
                  err
                );
              });
          }

          // For existing conversation, construct a base payload without user, as DifyChatRequestPayload adds it
          const payloadForExistingStream = {
            query: message,
            inputs: inputs || {}, // Keep inputs consistent with basePayloadForNewConversation
            ...(difyFiles && { files: difyFiles }),
          };

          // Check conversation ID format
          if (difyConversationId) {
            console.log('[handleSubmit] Conversation ID type check:', {
              type: typeof difyConversationId,
              length: difyConversationId.length,
              hasWhitespace: /\s/.test(difyConversationId),
              value: difyConversationId,
            });
          }

          const difyPayload: DifyChatRequestPayload = {
            ...payloadForExistingStream,
            user: currentUserId, // Use dynamically obtained currentUserId
            response_mode: 'streaming',
            conversation_id: difyConversationId, // Use Dify conversation ID, not db ID
            auto_generate_name: false,
          };

          const streamServiceResponse = await streamDifyChat(
            difyPayload,
            appConfig.appId, // Use ensured appId
            newlyFetchedConvId => {
              if (
                newlyFetchedConvId &&
                difyConversationId !== newlyFetchedConvId
              ) {
                // Update Dify conversation ID
                setDifyConversationId(newlyFetchedConvId);

                // Also update db ID to keep in sync
                setCurrentConversationId(newlyFetchedConvId);

                if (currentPathname !== `/chat/${newlyFetchedConvId}`) {
                  router.replace(`/chat/${newlyFetchedConvId}`, {
                    scroll: false,
                  });
                }

                // If got new Dify conversation ID, re-query db conversation ID
                if (!finalDbConvUUID) {
                  // Async query, do not block streaming
                  getConversationByExternalId(newlyFetchedConvId)
                    .then(result => {
                      if (result.success && result.data) {
                        finalDbConvUUID = result.data.id;
                        setDbConversationUUID(finalDbConvUUID);
                        console.log(
                          `[handleSubmit] Found db conversation ID: ${finalDbConvUUID}`
                        );
                      } else {
                        console.warn(
                          `[handleSubmit] No db record found, Dify conversation ID=${newlyFetchedConvId}`
                        );
                      }
                    })
                    .catch(err => {
                      console.error(
                        '[handleSubmit] Failed to query db conversation ID in callback:',
                        err
                      );
                    });
                }
              }
            },
            onNodeEvent // Pass node event callback for chatflow node control
          );
          answerStream = streamServiceResponse.answerStream;
          finalRealConvId =
            streamServiceResponse.getConversationId() ||
            difyConversationId ||
            undefined; // Fallback to currentConvId
          finalTaskId = streamServiceResponse.getTaskId() || undefined;

          // Get completionPromise for metadata handling
          completionPromise = streamServiceResponse.completionPromise;

          // Update Dify conversation ID
          if (finalRealConvId && finalRealConvId !== difyConversationId) {
            setDifyConversationId(finalRealConvId);

            // If got new Dify conversation ID, re-query db conversation ID
            if (!finalDbConvUUID && finalRealConvId !== difyConversationId) {
              try {
                const result =
                  await getConversationByExternalId(finalRealConvId);

                if (result.success && result.data) {
                  finalDbConvUUID = result.data.id;
                  setDbConversationUUID(finalDbConvUUID);
                  console.log(
                    `[handleSubmit] Found db conversation ID: ${finalDbConvUUID}`
                  );
                } else {
                  console.warn(
                    `[handleSubmit] No db record found, Dify conversation ID=${finalRealConvId}`
                  );
                }
              } catch (dbError) {
                console.error(
                  `[handleSubmit] Failed to query db conversation ID:`,
                  dbError
                );
              }
            }
          }

          // Update task ID
          if (
            finalTaskId &&
            useChatStore.getState().currentTaskId !== finalTaskId
          ) {
            setCurrentTaskId(finalTaskId);
          }

          // Log current state
          console.log('[handleSubmit] Existing conversation handled, state:', {
            finalRealConvId,
            finalDbConvUUID,
            storeConversationId: useChatStore.getState().currentConversationId,
            urlPath: window.location.pathname,
          });
        }

        if (!answerStream) {
          throw new Error('Answer stream is undefined after API call.');
        }

        for await (const answerChunk of answerStream) {
          if (
            useChatStore.getState().streamingMessageId === null &&
            assistantMessageId === null
          ) {
            const assistantMessage = addMessage({
              text: '',
              isUser: false,
              isStreaming: true,
            });
            assistantMessageId = assistantMessage.id;
            useChatStore.setState({ streamingMessageId: assistantMessageId });
            setIsWaitingForResponse(false);

            // For new conversation, realConvId and taskId should already be obtained from initiateNewConversation
            // For existing conversation, they are from streamDifyChat
            // No need to get from response.getConversationId() etc here

            // If new conversation, update pending status to streaming_message
            if (isNewConversationFlow && finalRealConvId) {
              updatePendingStatus(finalRealConvId, 'streaming_message');
            }
          }

          if (assistantMessageId) {
            if (
              useChatStore.getState().streamingMessageId === assistantMessageId
            ) {
              chunkBufferRef.current += answerChunk;
              // Streaming update optimization:
              // 1. Time interval: 30ms (more frequent updates)
              // 2. Content trigger: newline or length > 200 chars (smaller batches)
              // 3. Ensure every character is displayed in time
              if (
                Date.now() - lastAppendTime >= CHUNK_APPEND_INTERVAL ||
                chunkBufferRef.current.includes('\n') ||
                chunkBufferRef.current.length > 200
              ) {
                flushChunkBuffer(assistantMessageId);
                lastAppendTime = Date.now();
              } else if (!appendTimerRef.current) {
                appendTimerRef.current = setTimeout(() => {
                  flushChunkBuffer(assistantMessageId);
                  lastAppendTime = Date.now();
                }, CHUNK_APPEND_INTERVAL);
              }
            } else {
              console.log(
                '[handleSubmit] Stream was stopped externally, breaking chunk processing.'
              );
              if (
                assistantMessageId &&
                !useChatStore
                  .getState()
                  .messages.find(m => m.id === assistantMessageId)
                  ?.wasManuallyStopped
              ) {
                markAsManuallyStopped(assistantMessageId);
              }
              break;
            }
          }
        }

        flushChunkBuffer(assistantMessageId);

        // Wait for and handle Dify metadata
        // After streaming ends, try to get full metadata from message_end event
        if (completionPromise) {
          try {
            console.log(
              '[handleSubmit] Waiting for Dify streaming completion info...'
            );
            const completionData = await completionPromise;

            if (assistantMessageId && completionData) {
              const existingMessage = useChatStore
                .getState()
                .messages.find(m => m.id === assistantMessageId);

              // Build enhanced metadata, merge Dify returned info
              const enhancedMetadata = {
                ...(existingMessage?.metadata || {}),
                // Save full Dify metadata
                dify_metadata: completionData.metadata || {},
                dify_usage: completionData.usage || {},
                dify_retriever_resources:
                  completionData.retrieverResources || [],
                // Retain frontend-generated metadata
                frontend_metadata: {
                  stopped_manually: existingMessage?.metadata?.stopped_manually,
                  stopped_at: existingMessage?.metadata?.stopped_at,
                  attachments: existingMessage?.metadata?.attachments,
                  sequence_index: existingMessage?.sequence_index || 1,
                },
              };

              // Update assistant message metadata and token stats
              updateMessage(assistantMessageId, {
                metadata: enhancedMetadata,
                token_count:
                  completionData.usage?.total_tokens ||
                  existingMessage?.token_count,
                persistenceStatus: 'pending', // Mark as pending, includes full metadata
              });

              console.log(
                '[handleSubmit] Updated assistant message Dify metadata:',
                {
                  messageId: assistantMessageId,
                  difyMetadata: completionData.metadata,
                  usage: completionData.usage,
                  retrieverResources:
                    completionData.retrieverResources?.length || 0,
                }
              );
            }
          } catch (metadataError) {
            console.error(
              '[handleSubmit] Failed to get Dify metadata:',
              metadataError
            );
            // Metadata failure does not affect main flow, continue
          }
        } else {
          console.log(
            '[handleSubmit] No completionPromise, skip metadata handling'
          );
        }

        // After streaming ends, we need to:
        // 1. Ensure all IDs are up to date
        // 2. Try to save user and assistant messages
        // Ensure Dify conversation ID and db ID are up to date (mainly for new conversation)
        if (finalRealConvId) {
          // Update Dify conversation ID
          if (difyConversationId !== finalRealConvId) {
            setDifyConversationId(finalRealConvId);
          }

          // Update db ID
          if (
            useChatStore.getState().currentConversationId !== finalRealConvId
          ) {
            setCurrentConversationId(finalRealConvId);
          }

          // Update URL
          if (currentPathname !== `/chat/${finalRealConvId}`) {
            router.replace(`/chat/${finalRealConvId}`, { scroll: false });
          }
        }

        // Task ID should have been set at stream start
        if (
          finalTaskId &&
          useChatStore.getState().currentTaskId !== finalTaskId
        ) {
          setCurrentTaskId(finalTaskId);
        }

        // If new conversation, update pending status after stream ends
        if (isNewConversationFlow && finalRealConvId) {
          updatePendingStatus(
            finalRealConvId,
            'stream_completed_title_pending'
          );
        }

        // Message persistence logic:
        // 1. Only save messages after getting valid db conversation ID
        // 2. Save user message first, then assistant message
        // Fix: ensure db ID acquisition logic is robust
        // Fix: re-acquire latest db conversation ID to avoid losing it due to scope
        let currentDbConvId = finalDbConvUUID || dbConversationUUID;

        // If still no db ID, try to re-query with current state
        if (!currentDbConvId && finalRealConvId) {
          console.log(
            `[handleSubmit] Re-query db conversation ID, Dify conversation ID=${finalRealConvId}`
          );
          try {
            const result = await getConversationByExternalId(finalRealConvId);
            if (result.success && result.data) {
              currentDbConvId = result.data.id;
              setDbConversationUUID(currentDbConvId);
              console.log(
                `[handleSubmit] Re-query success, db conversation ID=${currentDbConvId}`
              );
            }
          } catch (error) {
            console.error(
              `[handleSubmit] Failed to re-query db conversation ID:`,
              error
            );
          }
        }

        if (currentDbConvId) {
          console.log(
            `[handleSubmit] Streaming ended, start saving messages, db conversation ID=${currentDbConvId}`
          );

          // Save user message (check if already saved)
          if (
            userMessage &&
            userMessage.persistenceStatus !== 'saved' &&
            !userMessage.db_id
          ) {
            console.log(
              `[handleSubmit] Save user message after streaming, ID=${userMessage.id}, db conversation ID=${currentDbConvId}`
            );
            saveMessage(userMessage, currentDbConvId).catch(err => {
              console.error(
                '[handleSubmit] Failed to save user message after streaming:',
                err
              );
            });
          } else if (userMessage) {
            console.log(
              `[handleSubmit] User message already saved, skip duplicate save, ID=${userMessage.id}, db_id=${userMessage.db_id}, status=${userMessage.persistenceStatus}`
            );
          }

          // Save assistant message
          if (assistantMessageId) {
            // After streaming ends, save assistant message immediately, no more delay
            // Because streaming is done, message content should be complete
            console.log(
              `[handleSubmit] Save assistant message immediately, ID=${assistantMessageId}, db conversation ID=${currentDbConvId}`
            );

            // Get latest message object to ensure content is complete
            const finalAssistantMessage = useChatStore
              .getState()
              .messages.find(m => m.id === assistantMessageId);

            // Fix: ensure assistant message is finalized before saving
            if (finalAssistantMessage) {
              // If message is still streaming, finalize it first
              if (finalAssistantMessage.isStreaming) {
                console.log(
                  `[handleSubmit] Assistant message still streaming, finalize first: ${assistantMessageId}`
                );
                finalizeStreamingMessage(assistantMessageId);
              }

              // Check if message needs saving (looser condition)
              const needsSaving =
                !finalAssistantMessage.db_id &&
                finalAssistantMessage.persistenceStatus !== 'saved' &&
                finalAssistantMessage.text.trim().length > 0;

              if (needsSaving) {
                console.log(
                  `[handleSubmit] Start saving assistant message, content length=${finalAssistantMessage.text.length}, db ID=${currentDbConvId}`
                );

                // Update message status to pending
                updateMessage(assistantMessageId, {
                  persistenceStatus: 'pending',
                });

                saveMessage(finalAssistantMessage, currentDbConvId).catch(
                  err => {
                    console.error(
                      '[handleSubmit] Failed to save assistant message:',
                      err
                    );
                    // On save failure, update status
                    if (assistantMessageId) {
                      updateMessage(assistantMessageId, {
                        persistenceStatus: 'error',
                      });
                    }
                  }
                );
              } else {
                console.log(
                  `[handleSubmit] Assistant message does not need saving: has db_id=${!!finalAssistantMessage.db_id}, status=${finalAssistantMessage.persistenceStatus}, content length=${finalAssistantMessage.text.length}`
                );
              }
            } else {
              console.warn(
                `[handleSubmit] Assistant message not found: ${assistantMessageId}`
              );
            }
          }
        } else {
          console.warn(
            `[handleSubmit] Streaming ended, but no db conversation ID, cannot save messages`
          );

          // Try to query db conversation ID again from Dify conversation ID
          if (finalRealConvId) {
            console.log(
              `[handleSubmit] Try one last time to query db conversation ID, Dify conversation ID=${finalRealConvId}`
            );
            getConversationByExternalId(finalRealConvId)
              .then(result => {
                if (result.success && result.data) {
                  console.log(
                    `[handleSubmit] Queried db conversation ID, start saving messages, ID=${result.data.id}`
                  );
                  // Set db conversation ID
                  finalDbConvUUID = result.data.id;
                  setDbConversationUUID(result.data.id);

                  // Save user and assistant messages
                  if (
                    userMessage &&
                    userMessage.persistenceStatus !== 'saved'
                  ) {
                    saveMessage(userMessage, result.data.id).catch(err => {
                      console.error(
                        '[handleSubmit] Failed to save user message after second query:',
                        err
                      );
                    });
                  }

                  if (assistantMessageId) {
                    const assistantMessage = useChatStore
                      .getState()
                      .messages.find(m => m.id === assistantMessageId);
                    if (
                      assistantMessage &&
                      assistantMessage.persistenceStatus !== 'saved'
                    ) {
                      saveMessage(assistantMessage, result.data.id).catch(
                        err => {
                          console.error(
                            '[handleSubmit] Failed to save assistant message after second query:',
                            err
                          );
                        }
                      );
                    }
                  }
                } else {
                  console.error(
                    `[handleSubmit] Still failed to get db conversation ID after final query, cannot save messages`
                  );
                }
              })
              .catch(err => {
                console.error(
                  '[handleSubmit] Failed to query db conversation ID after second try:',
                  err
                );
              });
          }
        }
      } catch (error) {
        console.error('[handleSubmit] Error occurred during streaming:', error);
        streamError = error as Error;
        const errorMessage = streamError?.message || 'Unknown error'; // Ensure error message is not empty

        // Error handling:
        // 1. Update UI state, show error message
        // 2. If have db conversation ID, try to save user message and error placeholder assistant message
        if (assistantMessageId) {
          // If assistant message already created, set error state
          setMessageError(assistantMessageId, errorMessage);

          // If have db conversation ID, try to save assistant error message
          if (finalDbConvUUID && assistantMessageId) {
            // Ensure assistantMessageId is not null
            const assistantMessage = useChatStore
              .getState()
              .messages.find(m => m.id === assistantMessageId);
            if (
              assistantMessage &&
              assistantMessage.persistenceStatus !== 'saved'
            ) {
              console.log(
                `[handleSubmit] Save error assistant message, ID=${assistantMessageId}`
              );
              // Set persistence status to pending
              updateMessage(assistantMessageId, {
                persistenceStatus: 'pending',
              });
              saveMessage(assistantMessage, finalDbConvUUID).catch(err => {
                console.error(
                  '[handleSubmit] Failed to save error assistant message:',
                  err
                );
                // Update message status to error
                if (assistantMessageId) {
                  // Double check not null
                  updateMessage(assistantMessageId, {
                    persistenceStatus: 'error',
                  });
                }
              });
            }
          }
        } else {
          // If assistant message not created, add an error message to UI
          const errorAssistantMessage = addMessage({
            text: `Sorry, an error occurred while processing your request: ${errorMessage}`,
            isUser: false,
            error: errorMessage,
            persistenceStatus: 'pending', // Set persistence status to pending
          });

          // If have db conversation ID, try to save user message and error placeholder assistant message
          if (finalDbConvUUID) {
            // Save user message
            if (userMessage && userMessage.persistenceStatus !== 'saved') {
              console.log(
                `[handleSubmit] Save user message in error handler, ID=${userMessage.id}`
              );
              saveMessage(userMessage, finalDbConvUUID).catch(err => {
                console.error(
                  '[handleSubmit] Failed to save user message in error handler:',
                  err
                );
              });
            }

            // Save error placeholder assistant message
            console.log(
              `[handleSubmit] Save error placeholder assistant message, ID=${errorAssistantMessage.id}`
            );
            saveMessage(errorAssistantMessage, finalDbConvUUID).catch(err => {
              console.error(
                '[handleSubmit] Failed to save error placeholder assistant message:',
                err
              );
              // Update message status to error
              updateMessage(errorAssistantMessage.id, {
                persistenceStatus: 'error',
              });
            });

            // If error message save fails, try to create an empty placeholder assistant message
            // Ensure error message is string
            const errorText =
              typeof errorMessage === 'string' && errorMessage
                ? `Assistant reply failed: ${errorMessage}`
                : 'Assistant reply failed: Unknown error';

            saveErrorPlaceholder(finalDbConvUUID, 'error', errorText).catch(
              err => {
                console.error(
                  '[handleSubmit] Failed to create error placeholder assistant message:',
                  err
                );
              }
            );
          } else {
            console.warn(
              '[handleSubmit] Could not get db conversation ID, error message will not be persisted'
            );
          }
        }
      } finally {
        if (appendTimerRef.current) clearTimeout(appendTimerRef.current);

        if (assistantMessageId) {
          const finalMessageState = useChatStore
            .getState()
            .messages.find(m => m.id === assistantMessageId);
          if (finalMessageState && finalMessageState.isStreaming) {
            finalizeStreamingMessage(assistantMessageId);

            // Fix: in finally block, handle assistant message save in unified way
            // Whether ended normally or stopped, always ensure assistant message is saved
            const currentDbConvId = finalDbConvUUID || dbConversationUUID;
            if (
              currentDbConvId &&
              finalMessageState.persistenceStatus !== 'saved' &&
              !finalMessageState.db_id
            ) {
              console.log(
                `[handleSubmit-finally] Unified save for assistant message, ID=${assistantMessageId}, wasManuallyStopped=${finalMessageState.wasManuallyStopped}`
              );

              // Get latest message state
              const latestMessage = useChatStore
                .getState()
                .messages.find(m => m.id === assistantMessageId);
              if (latestMessage && latestMessage.text.trim().length > 0) {
                updateMessage(assistantMessageId, {
                  persistenceStatus: 'pending',
                });

                if (latestMessage.wasManuallyStopped) {
                  // Use special save method for stopped assistant message
                  saveStoppedAssistantMessage(
                    latestMessage,
                    currentDbConvId
                  ).catch(err => {
                    console.error(
                      '[handleSubmit-finally] Failed to save stopped assistant message:',
                      err
                    );
                    if (assistantMessageId) {
                      updateMessage(assistantMessageId, {
                        persistenceStatus: 'error',
                      });
                    }
                  });
                } else {
                  // Use normal save method
                  saveMessage(latestMessage, currentDbConvId).catch(err => {
                    console.error(
                      '[handleSubmit-finally] Failed to save assistant message:',
                      err
                    );
                    if (assistantMessageId) {
                      updateMessage(assistantMessageId, {
                        persistenceStatus: 'error',
                      });
                    }
                  });
                }
              }
            }

            // When streaming response ends (skeleton disappears), ensure current conversation is highlighted in sidebar
            // Maintain current sidebar expanded state
            const currentConvId = useChatStore.getState().currentConversationId;
            if (currentConvId) {
              try {
                // Check if current route is chat page
                const currentPath = window.location.pathname;
                if (currentPath === `/chat/${currentConvId}`) {
                  // Use selectItem method from sidebar store to select current conversation
                  const { selectItem } = await import(
                    '@lib/stores/sidebar-store'
                  ).then(m => m.useSidebarStore.getState());
                  selectItem('chat', currentConvId, true);
                }
              } catch (error) {
                console.error(
                  '[Streaming End] Failed to highlight conversation:',
                  error
                );
              }
            }

            // If new conversation and stream ended normally, update pending status
            if (isNewConversationFlow && finalRealConvId) {
              // Note: do not set to title_resolved here, as title fetching is async
              // Title resolution is handled internally by useCreateConversation
              updatePendingStatus(
                finalRealConvId,
                'stream_completed_title_pending'
              );
            }
          }
        }
        setIsWaitingForResponse(false);
        isSubmittingRef.current = false;
      }
    },
    [
      currentUserId, // Replaces currentUserIdentifier
      ensureAppReady, // Replaces currentAppId, use force-wait method
      validateConfig, // New: validate config method
      conversationAppId, // New: original appId for historical conversation
      addMessage,
      setIsWaitingForResponse,
      isWelcomeScreen,
      setIsWelcomeScreen,
      finalizeStreamingMessage,
      markAsManuallyStopped,
      setMessageError,
      setCurrentConversationId,
      setCurrentTaskId,
      router,
      currentPathname,
      flushChunkBuffer,
      initiateNewConversation,
      updatePendingStatus,
      difyConversationId,
      saveMessage,
      saveStoppedAssistantMessage,
      updateMessage,
      dbConversationUUID,
      onNodeEvent,
      saveErrorPlaceholder,
    ]
  );

  // New: direct send message function
  // Equivalent to entering message in input box and clicking send
  // Fully reuses existing handleSubmit logic, including validation and state management
  const sendDirectMessage = useCallback(
    async (messageText: string, files?: unknown[]) => {
      if (!messageText.trim()) {
        console.warn(
          '[sendDirectMessage] Message content is empty, skip sending'
        );
        return;
      }

      // Temporarily set message to input store (so handleSubmit can read it)
      const { setMessage } = useChatInputStore.getState();
      const originalMessage = useChatInputStore.getState().message;

      try {
        // Set message content
        setMessage(messageText);

        // Call existing handleSubmit logic
        await handleSubmit(messageText, files, {});
      } catch (error) {
        console.error('[sendDirectMessage] Send failed:', error);
        // Restore original message
        setMessage(originalMessage);
        throw error;
      }
    },
    [handleSubmit]
  );

  const handleStopProcessing = useCallback(async () => {
    const state = useChatStore.getState();
    const currentStreamingId = state.streamingMessageId;
    const currentTaskId = state.currentTaskId;

    // New: state check and fix before stopping
    // If streaming message is actually finished but state not updated, fix state first
    if (currentStreamingId) {
      const streamingMessage = state.messages.find(
        m => m.id === currentStreamingId
      );

      if (streamingMessage && streamingMessage.isStreaming) {
        // Check if message looks finished (has content and not updated recently)
        const messageContent = streamingMessage.text;
        const hasContent = messageContent && messageContent.trim().length > 0;

        // If message has content but no task ID, may be zombie streaming state
        if (hasContent && !currentTaskId) {
          console.warn(
            `[handleStopProcessing] Detected possible zombie streaming state, message has content but no task ID: ${currentStreamingId}`
          );

          // Auto fix: finalize message
          finalizeStreamingMessage(currentStreamingId);
          setIsWaitingForResponse(false);

          // Try to save message
          const currentDbConvId = dbConversationUUID;
          if (
            currentDbConvId &&
            streamingMessage.persistenceStatus !== 'saved' &&
            !streamingMessage.db_id
          ) {
            console.log(
              `[handleStopProcessing] Auto save fixed message: ${currentStreamingId}`
            );
            updateMessage(currentStreamingId, { persistenceStatus: 'pending' });
            saveMessage(streamingMessage, currentDbConvId).catch(err => {
              console.error('[handleStopProcessing] Auto save failed:', err);
              updateMessage(currentStreamingId, { persistenceStatus: 'error' });
            });
          }

          console.log(`[handleStopProcessing] Zombie streaming state fixed`);

          // Fix: after zombie state fix, also reset key state to avoid button stuck
          // Ensure user can resubmit, but do not affect message save logic
          isSubmittingRef.current = false;
          console.log(
            '[handleStopProcessing] Zombie state fix complete, user can resubmit'
          );
          return; // Fix done, no need to continue stop operation
        }
      }
    }

    // Check if user is logged in
    if (!currentUserId) {
      console.error(
        'useChatInterface.handleStopProcessing: User not authenticated.'
      );
      return;
    }

    // Fix: stop operation does not need to validate app config, use current config directly
    // Stop should respond immediately, should not trigger full-screen validation spinner
    // Even if app config is problematic, local stop is still effective
    let appConfig: { appId: string; instance: ServiceInstance } | null = null;

    // Try to get current app config, but do not force validation
    if (currentAppId && currentAppInstance) {
      appConfig = { appId: currentAppId, instance: currentAppInstance };
      console.log(
        `[handleStopProcessing] Using current app config: ${appConfig.appId}`
      );
    } else {
      console.warn(
        '[handleStopProcessing] Current app config unavailable, only perform local stop'
      );
    }

    if (currentStreamingId) {
      if (appendTimerRef.current) {
        clearTimeout(appendTimerRef.current);
        appendTimerRef.current = null;
      }
      flushChunkBuffer(currentStreamingId);
      markAsManuallyStopped(currentStreamingId);

      const currentConvId = useChatStore.getState().currentConversationId;
      const urlIndicatesNew =
        window.location.pathname === '/chat/new' ||
        window.location.pathname.includes('/chat/temp-');
      const isNewConversationFlow = urlIndicatesNew && !currentConvId; // Re-evaluate based on current state
      if (isNewConversationFlow && currentConvId) {
        updatePendingStatus(currentConvId, 'stream_completed_title_pending');
      }

      // Only try remote stop if have valid app config and task ID
      if (currentTaskId && appConfig) {
        try {
          await stopDifyStreamingTask(
            appConfig.appId,
            currentTaskId,
            currentUserId
          );
          setCurrentTaskId(null);
        } catch (error) {
          console.error(
            `[handleStopProcessing] Error calling stopDifyStreamingTask:`,
            error
          );
          // Remote stop failure does not affect local stop
        }
      } else if (currentTaskId) {
        console.warn(
          '[handleStopProcessing] No valid app config, skip remote stop'
        );
        setCurrentTaskId(null); // Clear task ID
      }

      // Add persistence handling for interrupted message
      // 1. Mark message as manually stopped
      // 2. Update message metadata, add stop state marker
      // 3. If db ID available, save stopped message immediately
      // 4. If db ID not available, try to query and save
      const assistantMessage = useChatStore
        .getState()
        .messages.find(m => m.id === currentStreamingId);
      if (assistantMessage) {
        // Update message metadata, add stop state marker
        const updatedMetadata = {
          ...(assistantMessage.metadata || {}),
          stopped_manually: true,
          stopped_at: new Date().toISOString(),
        };

        // Update message state, add stop marker
        updateMessage(currentStreamingId, {
          metadata: updatedMetadata,
          wasManuallyStopped: true,
          persistenceStatus: 'pending', // Mark as pending
        });

        // Key fix: do not save assistant message immediately, avoid duplicate save with handleSubmit
        // Assistant message save will be handled in handleSubmit finally block
        console.log(
          `[handleStopProcessing] Marked assistant message as stopped, waiting for unified save, ID=${currentStreamingId}`
        );
      }

      // Fix: smart user message save logic (avoid duplicate save)
      // Only save in new conversation or if user message is truly unsaved
      const currentDbConvId = dbConversationUUID;
      if (currentDbConvId) {
        // Find most recent unsaved user message
        const messages = useChatStore.getState().messages;
        const recentUserMessage = messages
          .filter(m => m.isUser && m.persistenceStatus !== 'saved' && !m.db_id)
          .pop(); // Get last unsaved user message

        if (recentUserMessage) {
          // Key fix: check if new conversation, avoid duplicate save
          const urlIndicatesNew =
            window.location.pathname === '/chat/new' ||
            window.location.pathname.includes('/chat/temp-');
          const isNewConversationFlow = urlIndicatesNew || !difyConversationId;

          if (isNewConversationFlow) {
            // New conversation: user message may not be saved yet, save now
            console.log(
              `[handleStopProcessing] Found unsaved user message in new conversation, save now, ID=${recentUserMessage.id}`
            );
            saveMessage(recentUserMessage, currentDbConvId).catch(error => {
              console.error(
                '[handleStopProcessing] Failed to save user message:',
                error
              );
            });
          } else {
            // Historical conversation: user message should have been saved in handleSubmit, skip duplicate save
            console.log(
              `[handleStopProcessing] Found unsaved user message in historical conversation, but may have been saved in handleSubmit, skip duplicate save, ID=${recentUserMessage.id}`
            );
          }
        }
      } else if (difyConversationId) {
        // If db ID not available but have Dify conversation ID, try to query db ID and save user message
        console.log(
          `[handleStopProcessing] Try to query db ID and save user message, Dify conversation ID=${difyConversationId}`
        );
        getConversationByExternalId(difyConversationId)
          .then(result => {
            if (result.success && result.data) {
              const messages = useChatStore.getState().messages;
              const recentUserMessage = messages
                .filter(
                  m => m.isUser && m.persistenceStatus !== 'saved' && !m.db_id
                )
                .pop();

              if (recentUserMessage) {
                // Also check if new conversation
                const urlIndicatesNew =
                  window.location.pathname === '/chat/new' ||
                  window.location.pathname.includes('/chat/temp-');
                const isNewConversationFlow =
                  urlIndicatesNew || !difyConversationId;

                if (isNewConversationFlow) {
                  console.log(
                    `[handleStopProcessing] Queried db ID, save user message in new conversation, ID=${recentUserMessage.id}`
                  );
                  saveMessage(recentUserMessage, result.data.id).catch(
                    error => {
                      console.error(
                        '[handleStopProcessing] Failed to save user message after query:',
                        error
                      );
                    }
                  );
                } else {
                  console.log(
                    `[handleStopProcessing] Queried db ID, but user message in historical conversation may have been saved, skip, ID=${recentUserMessage.id}`
                  );
                }
              }
            }
          })
          .catch(error => {
            console.error(
              '[handleStopProcessing] Failed to query db ID:',
              error
            );
          });
      }
    }

    // Fix: after stop operation, reset key state to ensure user can resubmit
    // Unconditionally reset, avoid button stuck due to inconsistent state
    setIsWaitingForResponse(false);
    isSubmittingRef.current = false;

    console.log(
      '[handleStopProcessing] Normal stop flow complete, user can resubmit'
    );
  }, [
    currentUserId,
    currentAppId, // Use currentAppId and currentAppInstance directly
    currentAppInstance,
    markAsManuallyStopped,
    setCurrentTaskId,
    setIsWaitingForResponse,
    updatePendingStatus,
    flushChunkBuffer,
    dbConversationUUID,
    difyConversationId,
    updateMessage,
    saveMessage,
    finalizeStreamingMessage,
  ]);

  // New: streaming state check and auto-fix mechanism
  // Periodically check for "zombie" streaming messages (stream ended but state not updated)
  // This solves state inconsistency caused by abnormal streaming end in some apps
  useEffect(() => {
    const checkStreamingState = () => {
      const state = useChatStore.getState();
      const { streamingMessageId, messages, currentTaskId } = state;

      if (streamingMessageId) {
        const streamingMessage = messages.find(
          m => m.id === streamingMessageId
        );

        if (streamingMessage && streamingMessage.isStreaming) {
          // Check if task ID exists but no actual network activity
          // If message content hasn't changed in 30 seconds, may be "zombie" streaming state
          const messageContent = streamingMessage.text;
          const messageId = streamingMessage.id;

          // Use ref to store last checked message content and time
          if (!lastStreamingCheckRef.current) {
            lastStreamingCheckRef.current = {
              messageId,
              content: messageContent,
              lastUpdateTime: Date.now(),
            };
            return;
          }

          const {
            messageId: lastMessageId,
            content: lastContent,
            lastUpdateTime,
          } = lastStreamingCheckRef.current;

          // If same message and content hasn't changed
          if (messageId === lastMessageId && messageContent === lastContent) {
            const timeSinceLastUpdate = Date.now() - lastUpdateTime;

            // If no update for over 30 seconds, treat as zombie state
            if (timeSinceLastUpdate > 30000) {
              console.warn(
                `[Streaming State Check] Detected zombie streaming message, auto-fix: ${messageId}`
              );

              // Auto-fix: finalize message and clear state
              finalizeStreamingMessage(messageId);
              setIsWaitingForResponse(false);

              // Clear task ID
              if (currentTaskId) {
                setCurrentTaskId(null);
              }

              // Reset check state
              lastStreamingCheckRef.current = null;

              // Try to save message (if have db ID)
              const currentDbConvId = dbConversationUUID;
              if (
                currentDbConvId &&
                streamingMessage.persistenceStatus !== 'saved' &&
                !streamingMessage.db_id
              ) {
                console.log(
                  `[Streaming State Check] Auto save fixed message: ${messageId}`
                );
                updateMessage(messageId, { persistenceStatus: 'pending' });
                saveMessage(streamingMessage, currentDbConvId).catch(err => {
                  console.error(
                    '[Streaming State Check] Auto save failed:',
                    err
                  );
                  updateMessage(messageId, { persistenceStatus: 'error' });
                });
              }
            }
          } else {
            // Content changed, update check state
            lastStreamingCheckRef.current = {
              messageId,
              content: messageContent,
              lastUpdateTime: Date.now(),
            };
          }
        } else {
          // Message not found or not streaming, clear check state
          lastStreamingCheckRef.current = null;
        }
      } else {
        // No streaming message, clear check state
        lastStreamingCheckRef.current = null;
      }
    };

    // Check streaming state every 10 seconds
    const interval = setInterval(checkStreamingState, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [
    finalizeStreamingMessage,
    setIsWaitingForResponse,
    setCurrentTaskId,
    dbConversationUUID,
    updateMessage,
    saveMessage,
  ]);

  return {
    messages,
    handleSubmit,
    handleStopProcessing,
    sendDirectMessage, // Expose direct send message function
    isProcessing: useChatStore(selectIsProcessing),
    isWaitingForResponse: useChatStore(state => state.isWaitingForResponse),
    // Expose AppId loading and error state for UI to respond
    isAppConfigLoading: isLoadingAppId,
    appConfigError: errorLoadingAppId,
    isUserLoggedIn: !!currentUserId, // For UI to check if user is logged in
    difyConversationId, // Expose Dify conversation ID
    conversationAppId, // Expose original appId for historical conversation, for debugging and UI
    // Expose state clear function for new conversation button and app switch to clear conversation state
    clearConversationState: useCallback(() => {
      console.log('[useChatInterface] Clear conversation state');
      setDifyConversationId(null);
      setDbConversationUUID(null);
      setConversationAppId(null);
    }, []),
  };
}
