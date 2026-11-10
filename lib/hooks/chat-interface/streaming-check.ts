import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';

import type { MutableRefObject } from 'react';

import type { ChatStreamingCheckSnapshot } from './types';

interface RunStreamingStateConsistencyCheckInput {
  lastStreamingCheckRef: MutableRefObject<ChatStreamingCheckSnapshot | null>;
  finalizeStreamingMessage: (messageId: string) => void;
  setIsWaitingForResponse: (status: boolean) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  dbConversationUUID: string | null;
  updateMessage: (
    id: string,
    updates: Partial<Omit<ChatMessage, 'id' | 'isUser'>>
  ) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
}

export function runStreamingStateConsistencyCheck(
  input: RunStreamingStateConsistencyCheckInput
): void {
  const state = useChatStore.getState();
  const { streamingMessageId, messages, currentTaskId } = state;

  if (!streamingMessageId) {
    input.lastStreamingCheckRef.current = null;
    return;
  }

  const streamingMessage = messages.find(
    message => message.id === streamingMessageId
  );

  if (!streamingMessage || !streamingMessage.isStreaming) {
    input.lastStreamingCheckRef.current = null;
    return;
  }

  const messageContent = streamingMessage.text;
  const messageId = streamingMessage.id;

  if (!input.lastStreamingCheckRef.current) {
    input.lastStreamingCheckRef.current = {
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
  } = input.lastStreamingCheckRef.current;

  if (messageId !== lastMessageId || messageContent !== lastContent) {
    input.lastStreamingCheckRef.current = {
      messageId,
      content: messageContent,
      lastUpdateTime: Date.now(),
    };
    return;
  }

  const timeSinceLastUpdate = Date.now() - lastUpdateTime;
  if (timeSinceLastUpdate <= 30000) {
    return;
  }

  console.warn(
    `[Streaming State Check] Detected zombie streaming message, auto-fix: ${messageId}`
  );

  input.finalizeStreamingMessage(messageId);
  input.setIsWaitingForResponse(false);

  if (currentTaskId) {
    input.setCurrentTaskId(null);
  }

  input.lastStreamingCheckRef.current = null;

  if (
    input.dbConversationUUID &&
    streamingMessage.persistenceStatus !== 'saved' &&
    !streamingMessage.db_id
  ) {
    console.log(
      `[Streaming State Check] Auto save fixed message: ${messageId}`
    );
    input.updateMessage(messageId, { persistenceStatus: 'pending' });
    void input
      .saveMessage(streamingMessage, input.dbConversationUUID)
      .catch(error => {
        console.error('[Streaming State Check] Auto save failed:', error);
        input.updateMessage(messageId, { persistenceStatus: 'error' });
      });
  }
}
