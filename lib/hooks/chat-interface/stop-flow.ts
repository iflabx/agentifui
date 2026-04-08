import { stopDifyStreamingTask } from '@lib/services/dify/chat-service';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { ServiceInstance } from '@lib/types/database';
import { resolveStoppedResponseSnapshot } from '@lib/utils/stopped-message-content';

import type { MutableRefObject } from 'react';

import { resolveChatStopAppConfig } from './app-config';
import { resolveDbConversationUuidByExternalId } from './conversation-db';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

function findLatestUnsavedUserMessage(): ChatMessage | undefined {
  return useChatStore
    .getState()
    .messages.filter(
      message =>
        message.isUser &&
        message.persistenceStatus !== 'saved' &&
        !message.db_id
    )
    .pop();
}

function isNewConversationUrl(): boolean {
  return (
    window.location.pathname === '/chat/new' ||
    window.location.pathname.includes('/chat/temp-')
  );
}

interface FixZombieStreamingStateIfNeededInput {
  currentStreamingId: string | null;
  currentTaskId: string | null;
  dbConversationUUID: string | null;
  finalizeStreamingMessage: (id: string) => void;
  setIsWaitingForResponse: (status: boolean) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
}

export async function fixZombieStreamingStateIfNeeded(
  input: FixZombieStreamingStateIfNeededInput
): Promise<boolean> {
  if (!input.currentStreamingId) {
    return false;
  }

  const streamingMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.currentStreamingId);

  if (!streamingMessage || !streamingMessage.isStreaming) {
    return false;
  }

  const hasContent = Boolean(streamingMessage.text?.trim().length);
  if (!hasContent || input.currentTaskId) {
    return false;
  }

  console.warn(
    `[handleStopProcessing] Detected possible zombie streaming state, message has content but no task ID: ${input.currentStreamingId}`
  );

  input.finalizeStreamingMessage(input.currentStreamingId);
  input.setIsWaitingForResponse(false);

  if (
    input.dbConversationUUID &&
    streamingMessage.persistenceStatus !== 'saved' &&
    !streamingMessage.db_id
  ) {
    console.log(
      `[handleStopProcessing] Auto save fixed message: ${input.currentStreamingId}`
    );
    input.updateMessage(input.currentStreamingId, {
      persistenceStatus: 'pending',
    });
    try {
      await input.saveMessage(streamingMessage, input.dbConversationUUID);
    } catch (error) {
      console.error('[handleStopProcessing] Auto save failed:', error);
      input.updateMessage(input.currentStreamingId, {
        persistenceStatus: 'error',
      });
    }
  }

  console.log('[handleStopProcessing] Zombie streaming state fixed');
  return true;
}

interface StopRemoteStreamingTaskIfNeededInput {
  currentTaskId: string | null;
  currentUserId: string;
  appId?: string;
  setCurrentTaskId: (taskId: string | null) => void;
}

export async function stopRemoteStreamingTaskIfNeeded(
  input: StopRemoteStreamingTaskIfNeededInput
): Promise<void> {
  if (input.currentTaskId && input.appId) {
    try {
      await stopDifyStreamingTask(
        input.appId,
        input.currentTaskId,
        input.currentUserId
      );
      input.setCurrentTaskId(null);
    } catch (error) {
      console.error(
        '[handleStopProcessing] Error calling stopDifyStreamingTask:',
        error
      );
    }
    return;
  }

  if (input.currentTaskId) {
    console.warn(
      '[handleStopProcessing] No valid app config, skip remote stop'
    );
    input.setCurrentTaskId(null);
  }
}

interface PersistStoppedStreamingStateInput {
  currentStreamingId: string;
  dbConversationUUID: string | null;
  difyConversationId: string | null;
  setDbConversationUUID: (conversationId: string) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  saveStoppedAssistantMessage: (
    message: ChatMessage,
    conversationId: string
  ) => Promise<boolean>;
}

export async function persistStoppedStreamingState(
  input: PersistStoppedStreamingStateInput
): Promise<void> {
  const assistantMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.currentStreamingId);

  if (assistantMessage) {
    const updatedMetadata = {
      ...(assistantMessage.metadata || {}),
      stopped_manually: true,
      stopped_at: new Date().toISOString(),
      stopped_response_text: resolveStoppedResponseSnapshot({
        text: assistantMessage.text,
        metadata: assistantMessage.metadata,
      }),
    };

    input.updateMessage(input.currentStreamingId, {
      metadata: updatedMetadata,
      wasManuallyStopped: true,
      persistenceStatus: 'pending',
    });

    console.log(
      `[handleStopProcessing] Marked assistant message as stopped, waiting for unified save, ID=${input.currentStreamingId}`
    );
  }

  const recentUserMessage = findLatestUnsavedUserMessage();
  const canSaveForNewConversation =
    isNewConversationUrl() || !input.difyConversationId;

  let resolvedDbConversationId = input.dbConversationUUID;
  if (!resolvedDbConversationId && input.difyConversationId) {
    console.log(
      `[handleStopProcessing] Try to query db ID while stopping, Dify conversation ID=${input.difyConversationId}`
    );
    resolvedDbConversationId = await resolveDbConversationUuidByExternalId({
      externalId: input.difyConversationId,
      setDbConversationUUID: input.setDbConversationUUID,
      errorLog: '[handleStopProcessing] Failed to query db ID:',
      missingLog: `[handleStopProcessing] No db record found while stopping, Dify conversation ID=${input.difyConversationId}`,
    });
  }

  if (!resolvedDbConversationId) {
    return;
  }

  if (recentUserMessage) {
    if (canSaveForNewConversation) {
      console.log(
        `[handleStopProcessing] Found unsaved user message in new conversation, save now, ID=${recentUserMessage.id}`
      );
      try {
        await input.saveMessage(recentUserMessage, resolvedDbConversationId);
      } catch (error) {
        console.error(
          '[handleStopProcessing] Failed to save user message:',
          error
        );
      }
    } else {
      console.log(
        `[handleStopProcessing] Found unsaved user message in historical conversation, but may have been saved in handleSubmit, skip duplicate save, ID=${recentUserMessage.id}`
      );
    }
  }

  const stoppedAssistantMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.currentStreamingId);

  if (!stoppedAssistantMessage) {
    return;
  }

  console.log(
    `[handleStopProcessing] Persist stopped assistant message immediately, ID=${input.currentStreamingId}`
  );

  try {
    await input.saveStoppedAssistantMessage(
      stoppedAssistantMessage,
      resolvedDbConversationId
    );
  } catch (error) {
    console.error(
      '[handleStopProcessing] Failed to persist stopped assistant message:',
      error
    );
  }
}

interface ExecuteChatStopInput {
  currentUserId: string | undefined;
  currentAppId: string | null | undefined;
  currentAppInstance: ServiceInstance | null | undefined;
  dbConversationUUID: string | null;
  difyConversationId: string | null;
  isSubmittingRef: MutableRefObject<boolean>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  setDbConversationUUID: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  setIsWaitingForResponse: (status: boolean) => void;
  markAsManuallyStopped: (id: string) => void;
  flushChunkBuffer: (id: string | null) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  saveStoppedAssistantMessage: (
    message: ChatMessage,
    conversationId: string
  ) => Promise<boolean>;
  finalizeStreamingMessage: (id: string) => void;
}

export async function executeChatStop(
  input: ExecuteChatStopInput
): Promise<void> {
  const state = useChatStore.getState();
  const currentStreamingId = state.streamingMessageId;
  const currentTaskId = state.currentTaskId;

  if (
    await fixZombieStreamingStateIfNeeded({
      currentStreamingId,
      currentTaskId,
      dbConversationUUID: input.dbConversationUUID,
      finalizeStreamingMessage: input.finalizeStreamingMessage,
      setIsWaitingForResponse: input.setIsWaitingForResponse,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
    })
  ) {
    input.isSubmittingRef.current = false;
    console.log(
      '[handleStopProcessing] Zombie state fix complete, user can resubmit'
    );
    return;
  }

  if (!input.currentUserId) {
    console.error(
      'useChatInterface.handleStopProcessing: User not authenticated.'
    );
    return;
  }

  const appConfig = resolveChatStopAppConfig({
    currentAppId: input.currentAppId,
    currentAppInstance: input.currentAppInstance,
  });

  if (currentStreamingId) {
    if (input.appendTimerRef.current) {
      clearTimeout(input.appendTimerRef.current);
      input.appendTimerRef.current = null;
    }
    input.flushChunkBuffer(currentStreamingId);
    input.markAsManuallyStopped(currentStreamingId);

    await stopRemoteStreamingTaskIfNeeded({
      currentTaskId,
      currentUserId: input.currentUserId,
      appId: appConfig?.appId,
      setCurrentTaskId: input.setCurrentTaskId,
    });

    await persistStoppedStreamingState({
      currentStreamingId,
      dbConversationUUID: input.dbConversationUUID,
      difyConversationId: input.difyConversationId,
      setDbConversationUUID: input.setDbConversationUUID,
      updateMessage: input.updateMessage,
      saveMessage: input.saveMessage,
      saveStoppedAssistantMessage: input.saveStoppedAssistantMessage,
    });
  }

  input.setIsWaitingForResponse(false);
  input.isSubmittingRef.current = false;

  console.log(
    '[handleStopProcessing] Normal stop flow complete, user can resubmit'
  );
}
