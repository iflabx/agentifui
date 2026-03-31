import type { ChatResolvedAppConfig } from '@lib/hooks/chat-interface/app-config';
import type {
  OnCreateConversationNodeEvent,
  UseCreateConversationReturn,
} from '@lib/hooks/create-conversation/types';
import type { ChatMessage } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import type { MutableRefObject } from 'react';

import type { ChatModerationTranslator } from './error-utils';
import {
  mapChatUploadFilesToDifyFiles,
  mapChatUploadFilesToMessageAttachments,
} from './file-mappers';
import {
  persistChatMessagesAfterStreaming,
  syncChatStateAfterStreaming,
} from './post-stream';
import {
  applyChatCompletionMetadata,
  consumeChatAnswerStream,
} from './stream-consume';
import {
  finalizeChatSubmitStream,
  handleChatSubmitStreamError,
} from './submit-recovery';
import {
  prepareChatSubmitConversationState,
  startExistingChatConversation,
  startNewChatConversation,
} from './submit-start';
import type {
  AssistantMessagePersistenceFallback,
  ChatStreamCompletionData,
  DifyLocalFile,
} from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

function buildAssistantPersistenceFallback(input: {
  assistantMessageId: string | null;
  assistantText: string;
  completionData: ChatStreamCompletionData | null;
}): AssistantMessagePersistenceFallback | null {
  if (!input.assistantText.trim()) {
    return null;
  }

  const completionMetadata = input.completionData
    ? {
        dify_metadata: input.completionData.metadata || {},
        dify_usage: input.completionData.usage || {},
        dify_retriever_resources: input.completionData.retrieverResources || [],
        frontend_metadata: {
          sequence_index: 1,
        },
      }
    : undefined;

  return {
    id: input.assistantMessageId,
    text: input.assistantText,
    tokenCount: input.completionData?.usage?.total_tokens,
    metadata: completionMetadata,
  };
}

interface ExecuteChatSubmitInput {
  message: string;
  files?: unknown[];
  inputs?: Record<string, unknown>;
  currentUserId: string;
  appConfig: ChatResolvedAppConfig;
  isWelcomeScreen: boolean;
  currentPathname: string | null;
  difyConversationId: string | null;
  dbConversationUUID: string | null;
  onNodeEvent?: OnCreateConversationNodeEvent;
  isSubmittingRef: MutableRefObject<boolean>;
  chunkBufferRef: MutableRefObject<string>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  setIsWelcomeScreen: (value: boolean) => void;
  setDifyConversationId: (conversationId: string | null) => void;
  setDbConversationUUID: (conversationId: string | null) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setIsWaitingForResponse: (status: boolean) => void;
  addMessage: (messageData: Omit<ChatMessage, 'id'>) => ChatMessage;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  setMessageError: (id: string, error: string | null) => void;
  finalizeStreamingMessage: (id: string) => void;
  markAsManuallyStopped: (id: string) => void;
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
}

export async function executeChatSubmit(
  input: ExecuteChatSubmitInput
): Promise<void> {
  input.isSubmittingRef.current = true;
  input.setIsWaitingForResponse(true);

  const messageAttachments = mapChatUploadFilesToMessageAttachments(
    input.files
  );
  const userMessage = input.addMessage({
    text: input.message,
    isUser: true,
    attachments: messageAttachments,
    persistenceStatus: 'pending',
    sequence_index: 0,
  });

  if (input.isWelcomeScreen) {
    input.setIsWelcomeScreen(false);
    if (window.location.pathname === '/chat/new') {
      window.history.replaceState({}, '', `/chat/temp-${Date.now()}`);
    }
  }

  let assistantMessageId: string | null = null;
  let finalRealConvId: string | undefined;
  let finalTaskId: string | undefined;
  let finalDbConvUUID: string | null = null;
  let completionPromise: Promise<ChatStreamCompletionData> | undefined;
  let answerStream: AsyncGenerator<string, void, undefined> | undefined;
  let assistantFallback: AssistantMessagePersistenceFallback | null = null;

  const urlIndicatesNew =
    window.location.pathname === '/chat/new' ||
    window.location.pathname.includes('/chat/temp-');
  const isNewConversationFlow = prepareChatSubmitConversationState({
    urlIndicatesNew,
    difyConversationId: input.difyConversationId,
    setDifyConversationId: input.setDifyConversationId,
    setCurrentConversationId: input.setCurrentConversationId,
  });

  input.chunkBufferRef.current = '';

  try {
    const difyFiles = mapChatUploadFilesToDifyFiles(input.files);

    const submitStartResult = isNewConversationFlow
      ? await startNewChatConversation({
          payload: {
            query: input.message,
            user: input.currentUserId,
            inputs: input.inputs || {},
            ...(difyFiles ? { files: difyFiles } : {}),
          },
          appId: input.appConfig.appId,
          currentUserId: input.currentUserId,
          userMessage,
          currentPathname: input.currentPathname,
          initiateNewConversation: input.initiateNewConversation,
          setDbConversationUUID: input.setDbConversationUUID,
          setCurrentConversationId: input.setCurrentConversationId,
          setCurrentTaskId: input.setCurrentTaskId,
          navigateToConversation: input.navigateToConversation,
          saveMessage: input.saveMessage,
          onNodeEvent: input.onNodeEvent,
        })
      : await startExistingChatConversation({
          message: input.message,
          inputs: input.inputs,
          difyFiles: difyFiles as DifyLocalFile[] | undefined,
          appId: input.appConfig.appId,
          currentUserId: input.currentUserId,
          difyConversationId: input.difyConversationId as string,
          dbConversationUUID: input.dbConversationUUID,
          userMessage,
          currentPathname: input.currentPathname,
          saveMessage: input.saveMessage,
          setDifyConversationId: input.setDifyConversationId,
          setCurrentConversationId: input.setCurrentConversationId,
          setDbConversationUUID: input.setDbConversationUUID,
          setCurrentTaskId: input.setCurrentTaskId,
          navigateToConversation: input.navigateToConversation,
          onNodeEvent: input.onNodeEvent,
        });

    answerStream = submitStartResult.answerStream;
    finalRealConvId = submitStartResult.finalRealConvId;
    finalTaskId = submitStartResult.finalTaskId;
    finalDbConvUUID = submitStartResult.finalDbConvUUID;
    completionPromise = submitStartResult.completionPromise;

    if (!answerStream) {
      throw new Error('Answer stream is undefined after API call.');
    }

    const answerStreamResult = await consumeChatAnswerStream({
      answerStream,
      assistantMessageId,
      isNewConversationFlow,
      finalRealConvId,
      addMessage: input.addMessage,
      setIsWaitingForResponse: input.setIsWaitingForResponse,
      updatePendingStatus: input.updatePendingStatus,
      chunkBufferRef: input.chunkBufferRef,
      appendTimerRef: input.appendTimerRef,
      flushChunkBuffer: input.flushChunkBuffer,
      markAsManuallyStopped: input.markAsManuallyStopped,
      chunkAppendInterval: input.chunkAppendInterval,
    });
    assistantMessageId = answerStreamResult.assistantMessageId;

    const completionData = await applyChatCompletionMetadata({
      completionPromise,
      assistantMessageId,
      updateMessage: input.updateMessage,
    });

    assistantFallback = buildAssistantPersistenceFallback({
      assistantMessageId,
      assistantText: answerStreamResult.assistantText,
      completionData,
    });

    finalDbConvUUID = await persistChatMessagesAfterStreaming({
      finalDbConvUUID,
      dbConversationUUID: input.dbConversationUUID,
      finalRealConvId,
      userMessage,
      assistantMessageId,
      assistantFallback,
      setDbConversationUUID: input.setDbConversationUUID,
      finalizeStreamingMessage: input.finalizeStreamingMessage,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
    });

    syncChatStateAfterStreaming({
      finalRealConvId,
      finalTaskId,
      difyConversationId: input.difyConversationId,
      currentPathname: input.currentPathname,
      isNewConversationFlow,
      setDifyConversationId: input.setDifyConversationId,
      setCurrentConversationId: input.setCurrentConversationId,
      setCurrentTaskId: input.setCurrentTaskId,
      updatePendingStatus: input.updatePendingStatus,
      navigateToConversation: input.navigateToConversation,
    });
  } catch (error) {
    handleChatSubmitStreamError({
      error,
      assistantMessageId,
      finalDbConvUUID,
      userMessage,
      addMessage: input.addMessage,
      setMessageError: input.setMessageError,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
      saveErrorPlaceholder: input.saveErrorPlaceholder,
      moderationT: input.moderationT,
    });
  } finally {
    if (input.appendTimerRef.current) {
      clearTimeout(input.appendTimerRef.current);
    }

    await finalizeChatSubmitStream({
      assistantMessageId,
      finalDbConvUUID,
      dbConversationUUID: input.dbConversationUUID,
      finalizeStreamingMessage: input.finalizeStreamingMessage,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
      saveStoppedAssistantMessage: input.saveStoppedAssistantMessage,
      isNewConversationFlow,
      finalRealConvId,
    });

    input.setIsWaitingForResponse(false);
    input.isSubmittingRef.current = false;
  }
}
