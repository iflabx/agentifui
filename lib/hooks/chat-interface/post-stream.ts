import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import {
  persistUserMessageIfNeeded,
  resolveDbConversationUuidByExternalId,
} from './conversation-db';

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

    if (useChatStore.getState().currentConversationId !== input.finalRealConvId) {
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
  setDbConversationUUID: (conversationId: string) => void;
  finalizeStreamingMessage: (id: string) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
}

function persistAssistantMessageAfterStreaming(input: {
  assistantMessageId: string;
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
    `[handleSubmit] Save assistant message immediately, ID=${input.assistantMessageId}, db conversation ID=${input.conversationId}`
  );

  const assistantMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.assistantMessageId);

  if (!assistantMessage) {
    console.warn(
      `[handleSubmit] Assistant message not found: ${input.assistantMessageId}`
    );
    return;
  }

  if (assistantMessage.isStreaming) {
    console.log(
      `[handleSubmit] Assistant message still streaming, finalize first: ${input.assistantMessageId}`
    );
    input.finalizeStreamingMessage(input.assistantMessageId);
  }

  const latestAssistantMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.assistantMessageId);

  if (!latestAssistantMessage) {
    console.warn(
      `[handleSubmit] Assistant message not found after finalize: ${input.assistantMessageId}`
    );
    return;
  }

  const needsSaving =
    !latestAssistantMessage.db_id &&
    latestAssistantMessage.persistenceStatus !== 'saved' &&
    latestAssistantMessage.text.trim().length > 0;

  if (!needsSaving) {
    console.log(
      `[handleSubmit] Assistant message does not need saving: has db_id=${!!latestAssistantMessage.db_id}, status=${latestAssistantMessage.persistenceStatus}, content length=${latestAssistantMessage.text.length}`
    );
    return;
  }

  console.log(
    `[handleSubmit] Start saving assistant message, content length=${latestAssistantMessage.text.length}, db ID=${input.conversationId}`
  );
  input.updateMessage(input.assistantMessageId, {
    persistenceStatus: 'pending',
  });

  void input.saveMessage(latestAssistantMessage, input.conversationId).catch(error => {
    console.error(input.errorLog, error);
    input.updateMessage(input.assistantMessageId, {
      persistenceStatus: 'error',
    });
  });
}

export async function persistChatMessagesAfterStreaming(
  input: PersistChatMessagesAfterStreamingInput
): Promise<string | null> {
  let currentDbConvId = input.finalDbConvUUID || input.dbConversationUUID;

  if (!currentDbConvId && input.finalRealConvId) {
    console.log(
      `[handleSubmit] Re-query db conversation ID, Dify conversation ID=${input.finalRealConvId}`
    );
    currentDbConvId = await resolveDbConversationUuidByExternalId({
      externalId: input.finalRealConvId,
      setDbConversationUUID: input.setDbConversationUUID,
      successLog: '[handleSubmit] Re-query success, db conversation ID=',
      errorLog: '[handleSubmit] Failed to re-query db conversation ID:',
      missingLog: `[handleSubmit] No db record found after re-query, Dify conversation ID=${input.finalRealConvId}`,
    });
  }

  if (currentDbConvId) {
    console.log(
      `[handleSubmit] Streaming ended, start saving messages, db conversation ID=${currentDbConvId}`
    );

    if (
      input.userMessage.persistenceStatus === 'saved' ||
      Boolean(input.userMessage.db_id)
    ) {
      console.log(
        `[handleSubmit] User message already saved, skip duplicate save, ID=${input.userMessage.id}, db_id=${input.userMessage.db_id}, status=${input.userMessage.persistenceStatus}`
      );
    } else {
      persistUserMessageIfNeeded({
        userMessage: input.userMessage,
        conversationId: currentDbConvId,
        saveMessage: input.saveMessage,
        errorLog: '[handleSubmit] Failed to save user message after streaming:',
      });
    }

    if (input.assistantMessageId) {
      persistAssistantMessageAfterStreaming({
        assistantMessageId: input.assistantMessageId,
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

  if (!input.finalRealConvId) {
    return currentDbConvId;
  }

  console.log(
    `[handleSubmit] Try one last time to query db conversation ID, Dify conversation ID=${input.finalRealConvId}`
  );
  currentDbConvId = await resolveDbConversationUuidByExternalId({
    externalId: input.finalRealConvId,
    setDbConversationUUID: input.setDbConversationUUID,
    errorLog: '[handleSubmit] Failed to query db conversation ID after second try:',
    missingLog:
      '[handleSubmit] Still failed to get db conversation ID after final query, cannot save messages',
  });

  if (!currentDbConvId) {
    return currentDbConvId;
  }

  console.log(
    `[handleSubmit] Queried db conversation ID, start saving messages, ID=${currentDbConvId}`
  );

  persistUserMessageIfNeeded({
    userMessage: input.userMessage,
    conversationId: currentDbConvId,
    saveMessage: input.saveMessage,
    errorLog: '[handleSubmit] Failed to save user message after second query:',
  });

  if (input.assistantMessageId) {
    const assistantMessage = useChatStore
      .getState()
      .messages.find(message => message.id === input.assistantMessageId);
    if (assistantMessage && assistantMessage.persistenceStatus !== 'saved') {
      void input.saveMessage(assistantMessage, currentDbConvId).catch(error => {
        console.error(
          '[handleSubmit] Failed to save assistant message after second query:',
          error
        );
      });
    }
  }

  return currentDbConvId;
}
