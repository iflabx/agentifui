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
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { selectIsProcessing, useChatStore } from '@lib/stores/chat-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

import { useCallback } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

import { useChatConversationState } from './chat-interface/conversation-state';
import { sendDirectChatMessage } from './chat-interface/direct-send';
import type { ChatModerationTranslator } from './chat-interface/error-utils';
import { useChatStopHandler } from './chat-interface/stop-handler';
import { useChatStreamingState } from './chat-interface/streaming-state';
import { useChatSubmitHandler } from './chat-interface/submit-handler';
import type { ChatNodeEvent } from './chat-interface/types';
import { useChatMessages } from './use-chat-messages';
import { useCreateConversation } from './use-create-conversation';

// Remove hardcoded DIFY_APP_IDENTIFIER and currentUserIdentifier
// These will be obtained from store and auth hook
// Streaming experience optimization: reduce batch update interval for better responsiveness
// Lowered from 100ms to 30ms for smoother streaming effect
const CHUNK_APPEND_INTERVAL = 30;

interface UseChatInterfaceOptions {
  preferredRouteAppId?: string | null;
}

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
  onNodeEvent?: (event: ChatNodeEvent) => void,
  options: UseChatInterfaceOptions = {}
) {
  const router = useRouter();
  const currentPathname = usePathname();
  const tModerationBase = useTranslations('errors.system.moderation');
  const tChatMessages = useTranslations('pages.chat.messages');
  const moderationT = useCallback<ChatModerationTranslator>(
    (key, values) => tModerationBase(key, values),
    [tModerationBase]
  );
  const incompleteAnswerMessage = tChatMessages('incompleteAnswer');
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

  const {
    difyConversationId,
    setDifyConversationId,
    dbConversationUUID,
    setDbConversationUUID,
    conversationAppId,
    clearConversationState,
  } = useChatConversationState(currentPathname);

  const { isSubmittingRef, chunkBufferRef, appendTimerRef, flushChunkBuffer } =
    useChatStreamingState({
      appendMessageChunk,
      finalizeStreamingMessage,
      setIsWaitingForResponse,
      setCurrentTaskId,
      dbConversationUUID,
      updateMessage,
      saveMessage,
    });

  const navigateToConversation = useCallback(
    (conversationId: string) => {
      router.replace(`/chat/${conversationId}`, { scroll: false });
    },
    [router]
  );

  const handleSubmit = useChatSubmitHandler({
    currentUserId,
    conversationAppId,
    preferredRouteAppId: options.preferredRouteAppId ?? null,
    ensureAppReady,
    validateConfig,
    addMessage,
    setIsWaitingForResponse,
    isWelcomeScreen,
    setIsWelcomeScreen,
    finalizeStreamingMessage,
    markAsManuallyStopped,
    setMessageError,
    setDifyConversationId,
    setDbConversationUUID,
    setCurrentConversationId,
    setCurrentTaskId,
    currentPathname,
    difyConversationId,
    dbConversationUUID,
    onNodeEvent,
    isSubmittingRef,
    chunkBufferRef,
    appendTimerRef,
    updateMessage,
    updatePendingStatus,
    saveMessage,
    saveStoppedAssistantMessage,
    saveErrorPlaceholder,
    initiateNewConversation,
    navigateToConversation,
    flushChunkBuffer,
    chunkAppendInterval: CHUNK_APPEND_INTERVAL,
    moderationT,
    incompleteAnswerMessage,
  });

  // New: direct send message function
  // Equivalent to entering message in input box and clicking send
  // Fully reuses existing handleSubmit logic, including validation and state management
  const sendDirectMessage = useCallback(
    (messageText: string, files?: unknown[]) =>
      sendDirectChatMessage({
        messageText,
        files,
        handleSubmit,
      }),
    [handleSubmit]
  );

  const handleStopProcessing = useChatStopHandler({
    currentUserId,
    currentAppId,
    currentAppInstance,
    dbConversationUUID,
    difyConversationId,
    isSubmittingRef,
    appendTimerRef,
    setDbConversationUUID,
    setCurrentTaskId,
    setIsWaitingForResponse,
    markAsManuallyStopped,
    flushChunkBuffer,
    updateMessage,
    saveMessage,
    saveStoppedAssistantMessage,
    finalizeStreamingMessage,
  });

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
    clearConversationState,
  };
}
