import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import {
  persistUserMessageIfNeeded,
  resolveDbConversationUuidByExternalId,
} from './conversation-db';
import type { AssistantMessagePersistenceFallback } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface SyncChatStateAfterStreamingInput {
  finalRealConvId?: string;
  finalTaskId?: string;
  difyConversationId: string | null;
  currentPathname: string | null;
  isNewConversationFlow: boolean;
  setDifyConversationId: (conversationId: string) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  updatePendingStatus: (
    id: string,
    status: PendingConversation['status']
  ) => void;
  navigateToConversation: (conversationId: string) => void;
}

export function syncChatStateAfterStreaming(
  input: SyncChatStateAfterStreamingInput
): void {
  if (input.finalRealConvId) {
    if (input.difyConversationId !== input.finalRealConvId) {
      input.setDifyConversationId(input.finalRealConvId);
    }

    if (
      useChatStore.getState().currentConversationId !== input.finalRealConvId
    ) {
      input.setCurrentConversationId(input.finalRealConvId);
    }

    if (input.currentPathname !== `/chat/${input.finalRealConvId}`) {
      input.navigateToConversation(input.finalRealConvId);
    }
  }

  if (
    input.finalTaskId &&
    useChatStore.getState().currentTaskId !== input.finalTaskId
  ) {
    input.setCurrentTaskId(input.finalTaskId);
  }

  if (input.isNewConversationFlow && input.finalRealConvId) {
    input.updatePendingStatus(
      input.finalRealConvId,
      'stream_completed_title_pending'
    );
  }
}

interface PersistChatMessagesAfterStreamingInput {
  finalDbConvUUID: string | null;
  dbConversationUUID: string | null;
  finalRealConvId?: string;
  userMessage: ChatMessage;
  assistantMessageId: string | null;
  assistantFallback?: AssistantMessagePersistenceFallback | null;
  setDbConversationUUID: (conversationId: string) => void;
  finalizeStreamingMessage: (id: string) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
}

function isPersistableConversationExternalId(
  conversationId: string | null | undefined
): conversationId is string {
  if (!conversationId) {
    return false;
  }

  return (
    conversationId !== 'new' &&
    conversationId !== 'history' &&
    !conversationId.startsWith('temp-')
  );
}

function resolveConversationExternalIdForPersistence(
  finalRealConvId?: string
): string | null {
  if (isPersistableConversationExternalId(finalRealConvId)) {
    return finalRealConvId;
  }

  const storeConversationId = useChatStore.getState().currentConversationId;
  if (isPersistableConversationExternalId(storeConversationId)) {
    return storeConversationId;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
  const pathConversationId = match?.[1];

  return isPersistableConversationExternalId(pathConversationId)
    ? pathConversationId
    : null;
}

function resolveLatestMessageForPersistence(
  message: ChatMessage | null | undefined
): ChatMessage | null {
  if (!message?.id) {
    return null;
  }

  return (
    useChatStore.getState().messages.find(item => item.id === message.id) ||
    message
  );
}

function buildAssistantFallbackMessage(input: {
  assistantMessageId: string | null;
  assistantFallback?: AssistantMessagePersistenceFallback | null;
}): ChatMessage | null {
  const fallback = input.assistantFallback;
  const fallbackText = fallback?.text?.trim();

  if (!fallback || !fallbackText) {
    return null;
  }

  return {
    id: fallback.id || input.assistantMessageId || 'assistant-fallback',
    text: fallback.text,
    isUser: false,
    isStreaming: false,
    wasManuallyStopped: fallback.wasManuallyStopped,
    role: 'assistant',
    persistenceStatus: 'pending',
    token_count: fallback.tokenCount,
    metadata: fallback.metadata,
    sequence_index: 1,
  };
}

function resolveAssistantMessageForPersistence(input: {
  assistantMessageId: string | null;
  assistantFallback?: AssistantMessagePersistenceFallback | null;
  finalizeStreamingMessage: (id: string) => void;
}): ChatMessage | null {
  if (input.assistantMessageId) {
    const assistantMessage = useChatStore
      .getState()
      .messages.find(message => message.id === input.assistantMessageId);

    if (assistantMessage?.isStreaming) {
      console.log(
        `[handleSubmit] Assistant message still streaming, finalize first: ${input.assistantMessageId}`
      );
      input.finalizeStreamingMessage(input.assistantMessageId);
    }
  }

  const latestAssistantMessage = input.assistantMessageId
    ? useChatStore
        .getState()
        .messages.find(message => message.id === input.assistantMessageId)
    : null;
  const fallbackAssistantMessage = buildAssistantFallbackMessage(input);

  if (!latestAssistantMessage) {
    return fallbackAssistantMessage;
  }

  if (!fallbackAssistantMessage) {
    return latestAssistantMessage;
  }

  const latestText = latestAssistantMessage.text || '';
  const fallbackText = fallbackAssistantMessage.text || '';

  return {
    ...latestAssistantMessage,
    isStreaming: false,
    role: latestAssistantMessage.role || 'assistant',
    sequence_index: latestAssistantMessage.sequence_index ?? 1,
    text: fallbackText.length > latestText.length ? fallbackText : latestText,
    token_count:
      latestAssistantMessage.token_count ??
      fallbackAssistantMessage.token_count,
    metadata: {
      ...(fallbackAssistantMessage.metadata || {}),
      ...(latestAssistantMessage.metadata || {}),
    },
    wasManuallyStopped:
      latestAssistantMessage.wasManuallyStopped ??
      fallbackAssistantMessage.wasManuallyStopped,
  };
}

function isMessageAlreadyPersisted(
  message: ChatMessage | null | undefined
): boolean {
  return Boolean(message?.db_id) || message?.persistenceStatus === 'saved';
}

function persistAssistantMessageAfterStreaming(input: {
  assistantMessageId: string | null;
  assistantFallback?: AssistantMessagePersistenceFallback | null;
  conversationId: string;
  finalizeStreamingMessage: (id: string) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  errorLog: string;
}): void {
  console.log(
    `[handleSubmit] Save assistant message immediately, ID=${input.assistantMessageId ?? 'fallback-only'}, db conversation ID=${input.conversationId}`
  );

  const assistantMessageForPersistence = resolveAssistantMessageForPersistence({
    assistantMessageId: input.assistantMessageId,
    assistantFallback: input.assistantFallback,
    finalizeStreamingMessage: input.finalizeStreamingMessage,
  });

  if (!assistantMessageForPersistence) {
    console.warn('[handleSubmit] Assistant message not found for persistence');
    return;
  }

  const needsSaving =
    !assistantMessageForPersistence.db_id &&
    assistantMessageForPersistence.persistenceStatus !== 'saved' &&
    assistantMessageForPersistence.text.trim().length > 0;

  if (!needsSaving) {
    console.log(
      `[handleSubmit] Assistant message does not need saving: has db_id=${!!assistantMessageForPersistence.db_id}, status=${assistantMessageForPersistence.persistenceStatus}, content length=${assistantMessageForPersistence.text.length}`
    );
    return;
  }

  console.log(
    `[handleSubmit] Start saving assistant message, content length=${assistantMessageForPersistence.text.length}, db ID=${input.conversationId}`
  );
  if (input.assistantMessageId) {
    input.updateMessage(input.assistantMessageId, {
      persistenceStatus: 'pending',
    });
  }

  void input
    .saveMessage(assistantMessageForPersistence, input.conversationId)
    .catch(error => {
      console.error(input.errorLog, error);
      if (input.assistantMessageId) {
        input.updateMessage(input.assistantMessageId, {
          persistenceStatus: 'error',
        });
      }
    });
}

export async function persistChatMessagesAfterStreaming(
  input: PersistChatMessagesAfterStreamingInput
): Promise<string | null> {
  let currentDbConvId = input.finalDbConvUUID || input.dbConversationUUID;
  const conversationExternalId = resolveConversationExternalIdForPersistence(
    input.finalRealConvId
  );

  if (!currentDbConvId && conversationExternalId) {
    console.log(
      `[handleSubmit] Re-query db conversation ID, Dify conversation ID=${conversationExternalId}`
    );
    currentDbConvId = await resolveDbConversationUuidByExternalId({
      externalId: conversationExternalId,
      setDbConversationUUID: input.setDbConversationUUID,
      successLog: '[handleSubmit] Re-query success, db conversation ID=',
      errorLog: '[handleSubmit] Failed to re-query db conversation ID:',
      missingLog: `[handleSubmit] No db record found after re-query, Dify conversation ID=${conversationExternalId}`,
    });
  }

  if (currentDbConvId) {
    console.log(
      `[handleSubmit] Streaming ended, start saving messages, db conversation ID=${currentDbConvId}`
    );

    const latestUserMessageForPersistence =
      resolveLatestMessageForPersistence(input.userMessage) ||
      input.userMessage;

    if (isMessageAlreadyPersisted(latestUserMessageForPersistence)) {
      console.log(
        `[handleSubmit] User message already saved, skip duplicate save, ID=${latestUserMessageForPersistence.id}, db_id=${latestUserMessageForPersistence.db_id}, status=${latestUserMessageForPersistence.persistenceStatus}`
      );
    } else {
      persistUserMessageIfNeeded({
        userMessage: latestUserMessageForPersistence,
        conversationId: currentDbConvId,
        saveMessage: input.saveMessage,
        errorLog: '[handleSubmit] Failed to save user message after streaming:',
      });
    }

    if (input.assistantMessageId || input.assistantFallback?.text?.trim()) {
      persistAssistantMessageAfterStreaming({
        assistantMessageId: input.assistantMessageId,
        assistantFallback: input.assistantFallback,
        conversationId: currentDbConvId,
        finalizeStreamingMessage: input.finalizeStreamingMessage,
        updateMessage: input.updateMessage,
        saveMessage: input.saveMessage,
        errorLog: '[handleSubmit] Failed to save assistant message:',
      });
    }

    return currentDbConvId;
  }

  console.warn(
    '[handleSubmit] Streaming ended, but no db conversation ID, cannot save messages'
  );

  if (!conversationExternalId) {
    return currentDbConvId;
  }

  console.log(
    `[handleSubmit] Try one last time to query db conversation ID, Dify conversation ID=${conversationExternalId}`
  );
  currentDbConvId = await resolveDbConversationUuidByExternalId({
    externalId: conversationExternalId,
    setDbConversationUUID: input.setDbConversationUUID,
    errorLog:
      '[handleSubmit] Failed to query db conversation ID after second try:',
    missingLog:
      '[handleSubmit] Still failed to get db conversation ID after final query, cannot save messages',
  });

  if (!currentDbConvId) {
    return currentDbConvId;
  }

  console.log(
    `[handleSubmit] Queried db conversation ID, start saving messages, ID=${currentDbConvId}`
  );

  const latestUserMessageForPersistence =
    resolveLatestMessageForPersistence(input.userMessage) || input.userMessage;

  if (isMessageAlreadyPersisted(latestUserMessageForPersistence)) {
    console.log(
      `[handleSubmit] User message already saved, skip duplicate save, ID=${latestUserMessageForPersistence.id}, db_id=${latestUserMessageForPersistence.db_id}, status=${latestUserMessageForPersistence.persistenceStatus}`
    );
  } else {
    persistUserMessageIfNeeded({
      userMessage: latestUserMessageForPersistence,
      conversationId: currentDbConvId,
      saveMessage: input.saveMessage,
      errorLog:
        '[handleSubmit] Failed to save user message after second query:',
    });
  }

  if (input.assistantMessageId || input.assistantFallback?.text?.trim()) {
    persistAssistantMessageAfterStreaming({
      assistantMessageId: input.assistantMessageId,
      assistantFallback: input.assistantFallback,
      conversationId: currentDbConvId,
      finalizeStreamingMessage: input.finalizeStreamingMessage,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
      errorLog:
        '[handleSubmit] Failed to save assistant message after second query:',
    });
  }

  return currentDbConvId;
}
