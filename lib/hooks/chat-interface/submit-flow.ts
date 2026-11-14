import type { ChatResolvedAppConfig } from '@lib/hooks/chat-interface/app-config';
import type {
  OnCreateConversationNodeEvent,
  UseCreateConversationReturn,
} from '@lib/hooks/create-conversation/types';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';
import { normalizeCompletedAssistantReply } from '@lib/utils/think-parser';

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
  ChatSubmissionAccepted,
  ChatSubmissionBinding,
  ChatViewScope,
  DifyLocalFile,
} from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface AssistantPersistenceFallbackBuildResult {
  assistantFallback: AssistantMessagePersistenceFallback | null;
  normalizedText: string;
  changed: boolean;
  metadata?: Record<string, unknown>;
  usedFallback: boolean;
}

function buildAssistantPersistenceFallback(input: {
  assistantMessageId: string | null;
  assistantText: string;
  completionData: ChatStreamCompletionData | null;
  incompleteAnswerMessage: string;
  assistantWasManuallyStopped: boolean;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
}): AssistantPersistenceFallbackBuildResult {
  const normalizedAssistantContent = input.assistantWasManuallyStopped
    ? {
        content: input.assistantText,
        changed: false,
        usedFallback: false,
      }
    : normalizeCompletedAssistantReply(
        input.assistantText,
        input.incompleteAnswerMessage
      );
  const assistantText = normalizedAssistantContent.content;

  if (!assistantText.trim()) {
    return {
      assistantFallback: null,
      normalizedText: assistantText,
      changed: normalizedAssistantContent.changed,
      usedFallback: normalizedAssistantContent.usedFallback,
    };
  }

  const frontendMetadata = {
    sequence_index: 1,
    ...(normalizedAssistantContent.usedFallback
      ? { incomplete_assistant_fallback: true }
      : {}),
  };

  const completionMetadata = input.completionData
    ? {
        dify_metadata: input.completionData.metadata || {},
        dify_usage: input.completionData.usage || {},
        dify_retriever_resources: input.completionData.retrieverResources || [],
        frontend_metadata: frontendMetadata,
      }
    : {
        frontend_metadata: frontendMetadata,
      };

  if (normalizedAssistantContent.changed && input.assistantMessageId) {
    const existingMessage = useChatStore
      .getState()
      .messages.find(message => message.id === input.assistantMessageId);

    input.updateMessage(input.assistantMessageId, {
      text: assistantText,
      ...(normalizedAssistantContent.usedFallback
        ? {
            metadata: {
              ...(existingMessage?.metadata || {}),
              ...completionMetadata,
            },
          }
        : {}),
    });
  }

  return {
    assistantFallback: {
      id: input.assistantMessageId,
      text: assistantText,
      tokenCount: input.completionData?.usage?.total_tokens,
      metadata: completionMetadata,
      wasManuallyStopped: input.assistantWasManuallyStopped,
    },
    normalizedText: assistantText,
    changed: normalizedAssistantContent.changed,
    metadata: completionMetadata,
    usedFallback: normalizedAssistantContent.usedFallback,
  };
}

interface ExecuteChatSubmitInput {
  onAccepted?: (accepted: ChatSubmissionAccepted) => void;
  viewScope?: ChatViewScope;
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
  incompleteAnswerMessage: string;
}

export async function executeChatSubmit(
  input: ExecuteChatSubmitInput
): Promise<void> {
  const isCurrent = input.viewScope?.isCurrent || (() => true);
  const guard =
    <Args extends unknown[]>(callback: (...args: Args) => void) =>
    (...args: Args) => {
      if (isCurrent()) callback(...args);
    };
  const original = input;
  input = {
    ...input,
    setIsWelcomeScreen: guard(input.setIsWelcomeScreen),
    setDifyConversationId: guard(input.setDifyConversationId),
    setDbConversationUUID: guard(input.setDbConversationUUID),
    setCurrentConversationId: guard(input.setCurrentConversationId),
    setCurrentTaskId: guard(input.setCurrentTaskId),
    setIsWaitingForResponse: guard(input.setIsWaitingForResponse),
    addMessage: message =>
      isCurrent()
        ? original.addMessage(message)
        : { ...message, id: crypto.randomUUID() },
    updateMessage: guard(input.updateMessage),
    setMessageError: guard(input.setMessageError),
    finalizeStreamingMessage: guard(input.finalizeStreamingMessage),
    markAsManuallyStopped: guard(input.markAsManuallyStopped),
    flushChunkBuffer: guard(input.flushChunkBuffer),
    onNodeEvent: input.onNodeEvent ? guard(input.onNodeEvent) : undefined,
    navigateToConversation: id => {
      if (isCurrent()) {
        input.viewScope?.onRouteAdopted(`/chat/${id}`);
        original.navigateToConversation(id);
      }
    },
  };
  input.isSubmittingRef.current = true;
  input.setIsWaitingForResponse(true);

  const messageAttachments = mapChatUploadFilesToMessageAttachments(
    input.files,
    input.appConfig.appId
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
      const temporaryPath = `/chat/temp-${Date.now()}`;
      input.viewScope?.onRouteAdopted(temporaryPath);
      window.history.replaceState({}, '', temporaryPath);
    }
  }

  let assistantMessageId: string | null = null;
  let finalRealConvId: string | undefined;
  let finalTaskId: string | undefined;
  let finalDbConvUUID: string | null = null;
  let completionPromise: Promise<ChatStreamCompletionData> | undefined;
  let conversationPersistencePromise: Promise<string | null> | undefined;
  let answerStream: AsyncGenerator<string, void, undefined> | undefined;
  let assistantFallback: AssistantMessagePersistenceFallback | null = null;
  let getBinding: (() => ChatSubmissionBinding) | undefined;
  const refreshBinding = () => {
    const binding = getBinding?.();
    finalRealConvId = binding?.externalId || finalRealConvId;
    finalTaskId = binding?.taskId || finalTaskId;
    finalDbConvUUID = binding?.dbConversationId || finalDbConvUUID;
  };
  const onAccepted = (accepted: ChatSubmissionAccepted) => {
    finalRealConvId = accepted.externalId;
    finalTaskId = accepted.taskId;
    input.setCurrentTaskId(accepted.taskId);
    input.onAccepted?.(accepted);
  };

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
          onAccepted,
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
          viewScope: input.viewScope,
        })
      : await startExistingChatConversation({
          onAccepted,
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
    conversationPersistencePromise =
      submitStartResult.conversationPersistencePromise;
    getBinding = submitStartResult.getBinding;

    if (!answerStream) {
      throw new Error('Answer stream is undefined after API call.');
    }

    const answerStreamResult = await consumeChatAnswerStream({
      onInterrupted: snapshot => {
        assistantMessageId = snapshot.assistantMessageId;
        assistantFallback = {
          id: snapshot.assistantMessageId,
          text: snapshot.assistantText,
        };
      },
      isCurrent,
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
    refreshBinding();

    const completionData = await applyChatCompletionMetadata({
      completionPromise,
      assistantMessageId,
      updateMessage: input.updateMessage,
      isCurrent,
    });

    const latestAssistantMessage = assistantMessageId
      ? useChatStore
          .getState()
          .messages.find(message => message.id === assistantMessageId)
      : null;

    const assistantPersistenceFallback = buildAssistantPersistenceFallback({
      assistantMessageId,
      assistantText: answerStreamResult.assistantText,
      completionData,
      incompleteAnswerMessage: input.incompleteAnswerMessage,
      assistantWasManuallyStopped:
        latestAssistantMessage?.wasManuallyStopped === true,
      updateMessage: input.updateMessage,
    });
    assistantFallback = assistantPersistenceFallback.assistantFallback;

    finalDbConvUUID = await persistChatMessagesAfterStreaming({
      finalDbConvUUID,
      dbConversationUUID: input.dbConversationUUID,
      conversationPersistencePromise,
      finalRealConvId,
      allowCurrentConversationFallback: false,
      userMessage,
      userMessagePreviewFileIds: completionData?.userMessageFileIds,
      assistantMessageId,
      assistantFallback,
      setDbConversationUUID: input.setDbConversationUUID,
      finalizeStreamingMessage: input.finalizeStreamingMessage,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
      saveStoppedAssistantMessage: input.saveStoppedAssistantMessage,
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
    refreshBinding();
    if (!finalDbConvUUID && conversationPersistencePromise) {
      finalDbConvUUID = await conversationPersistencePromise;
    }
    handleChatSubmitStreamError({
      error,
      assistantMessageId,
      assistantFallback,
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
    if (isCurrent() && input.appendTimerRef.current) {
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
    if (isCurrent()) input.isSubmittingRef.current = false;
  }
}
