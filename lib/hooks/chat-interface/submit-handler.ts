import type { UseCreateConversationReturn } from '@lib/hooks/create-conversation/types';
import type { ChatMessage } from '@lib/stores/chat-store';
import { selectIsProcessing, useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import { useCallback } from 'react';
import type { MutableRefObject } from 'react';

import type { ChatResolvedAppConfig } from './app-config';
import { resolveChatSubmitAppConfig } from './app-config';
import type { ChatModerationTranslator } from './error-utils';
import { executeChatSubmit } from './submit-flow';
import type { ChatNodeEvent } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface UseChatSubmitHandlerInput {
  currentUserId: string | undefined;
  conversationAppId: string | null;
  preferredRouteAppId?: string | null;
  ensureAppReady: () => Promise<ChatResolvedAppConfig>;
  validateConfig: (
    appId?: string,
    context?: 'message' | 'switch' | 'general'
  ) => Promise<void>;
  addMessage: (messageData: Omit<ChatMessage, 'id'>) => ChatMessage;
  setIsWaitingForResponse: (status: boolean) => void;
  isWelcomeScreen: boolean;
  setIsWelcomeScreen: (value: boolean) => void;
  finalizeStreamingMessage: (id: string) => void;
  markAsManuallyStopped: (id: string) => void;
  setMessageError: (id: string, error: string | null) => void;
  setDifyConversationId: (conversationId: string | null) => void;
  setDbConversationUUID: (conversationId: string | null) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  currentPathname: string | null;
  difyConversationId: string | null;
  dbConversationUUID: string | null;
  onNodeEvent?: (event: ChatNodeEvent) => void;
  isSubmittingRef: MutableRefObject<boolean>;
  chunkBufferRef: MutableRefObject<string>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  updatePendingStatus: (
    id: string,
    status: PendingConversation['status']
  ) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  saveStoppedAssistantMessage: (
    message: ChatMessage,
    conversationId: string
  ) => Promise<boolean>;
  saveErrorPlaceholder: (
    conversationId: string,
    status?: 'sent' | 'delivered' | 'error',
    errorMessage?: string
  ) => Promise<boolean>;
  initiateNewConversation: UseCreateConversationReturn['initiateNewConversation'];
  navigateToConversation: (conversationId: string) => void;
  flushChunkBuffer: (id: string | null) => void;
  chunkAppendInterval: number;
  moderationT: ChatModerationTranslator;
  incompleteAnswerMessage: string;
}

export function useChatSubmitHandler({
  currentUserId,
  conversationAppId,
  preferredRouteAppId,
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
  chunkAppendInterval,
  moderationT,
  incompleteAnswerMessage,
}: UseChatSubmitHandlerInput) {
  return useCallback(
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

      if (!currentUserId) {
        console.error('useChatInterface.handleSubmit: User not authenticated.');
        return;
      }

      const appConfig = await resolveChatSubmitAppConfig({
        conversationAppId,
        preferredRouteAppId,
        ensureAppReady,
        validateConfig,
        onErrorMessage: errorMessage => {
          addMessage({
            text: `Sorry, failed to get app config: ${errorMessage}. Please check your network or contact admin.`,
            isUser: false,
            error: errorMessage,
            persistenceStatus: 'error',
          });
        },
      });

      if (!appConfig) {
        return;
      }

      await executeChatSubmit({
        message,
        files,
        inputs,
        currentUserId,
        appConfig,
        isWelcomeScreen,
        currentPathname,
        difyConversationId,
        dbConversationUUID,
        onNodeEvent,
        isSubmittingRef,
        chunkBufferRef,
        appendTimerRef,
        setIsWelcomeScreen,
        setDifyConversationId,
        setDbConversationUUID,
        setCurrentConversationId,
        setCurrentTaskId,
        setIsWaitingForResponse,
        addMessage,
        updateMessage,
        setMessageError,
        finalizeStreamingMessage,
        markAsManuallyStopped,
        updatePendingStatus,
        saveMessage,
        saveStoppedAssistantMessage,
        saveErrorPlaceholder,
        initiateNewConversation,
        navigateToConversation,
        flushChunkBuffer,
        chunkAppendInterval,
        moderationT,
        incompleteAnswerMessage,
      });
    },
    [
      currentUserId,
      conversationAppId,
      preferredRouteAppId,
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
      chunkAppendInterval,
      moderationT,
      incompleteAnswerMessage,
    ]
  );
}
