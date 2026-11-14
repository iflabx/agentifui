import { stopDifyStreamingTask } from '@lib/services/dify/chat-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import type { ServiceInstance } from '@lib/types/database';
import { resolveStoppedResponseSnapshot } from '@lib/utils/stopped-message-content';

import type { MutableRefObject } from 'react';

import { resolveChatStopAppConfig } from './app-config';
import { resolveDbConversationUuidByExternalId } from './conversation-db';
import { chatSubmissionOwners } from './submission-owner';

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
}

export async function stopRemoteStreamingTaskIfNeeded(
  input: StopRemoteStreamingTaskIfNeededInput
): Promise<boolean> {
  if (input.currentTaskId && input.appId) {
    try {
      const result = await stopDifyStreamingTask(
        input.appId,
        input.currentTaskId,
        input.currentUserId
      );
      if (result.result !== 'success') return false;
      return true;
    } catch (error) {
      console.error(
        '[handleStopProcessing] Error calling stopDifyStreamingTask:',
        error
      );
    }
    return false;
  }

  if (input.currentTaskId) {
    console.warn(
      '[handleStopProcessing] No valid app config, skip remote stop'
    );
  }
  return false;
}

interface PersistStoppedStreamingStateInput {
  assistantSnapshot?: ChatMessage | null;
  userSnapshot?: ChatMessage | null;
  canSaveForNewConversation?: boolean;
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
  const assistantMessage =
    input.assistantSnapshot === undefined
      ? useChatStore
          .getState()
          .messages.find(message => message.id === input.currentStreamingId)
      : input.assistantSnapshot;
  const recentUserMessage =
    input.userSnapshot === undefined
      ? findLatestUnsavedUserMessage()
      : input.userSnapshot;
  const canSaveForNewConversation =
    input.canSaveForNewConversation ??
    (isNewConversationUrl() || !input.difyConversationId);
  let stoppedAssistantMessage: ChatMessage | null = null;

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
    stoppedAssistantMessage = {
      ...assistantMessage,
      isStreaming: false,
      metadata: updatedMetadata,
      wasManuallyStopped: true,
      persistenceStatus: 'pending',
    };

    console.log(
      `[handleStopProcessing] Marked assistant message as stopped, waiting for unified save, ID=${input.currentStreamingId}`
    );
  }

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
  isCurrent?: () => boolean;
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

const stoppingTasks = new Set<string>();

export interface ChatStopResult {
  confirmed: boolean;
  current: boolean;
  taskId?: string;
}

export async function executeChatStop(
  input: ExecuteChatStopInput
): Promise<ChatStopResult> {
  const state = useChatStore.getState();
  const currentTaskId = state.currentTaskId;
  const currentStreamingId = state.streamingMessageId;
  const submission = chatSubmissionOwners.get(input.isSubmittingRef);
  const outcome = (confirmed: boolean, current: boolean): ChatStopResult => ({
    confirmed,
    current,
    ...(currentTaskId ? { taskId: currentTaskId } : {}),
  });
  if (!input.currentUserId || (submission && !submission.isCurrent()))
    return outcome(false, false);
  const appConfig = submission?.appConfig || resolveChatStopAppConfig(input);
  type CancellationInstance = ServiceInstance & {
    descriptor?: { effectiveActions?: { cancellation?: boolean } };
  };
  const instance = appConfig?.instance as CancellationInstance | undefined;
  const currentInstance = input.currentAppInstance as
    CancellationInstance | undefined;
  if (
    instance?.descriptor?.effectiveActions?.cancellation === false ||
    (currentInstance?.instance_id === appConfig?.appId &&
      currentInstance?.descriptor?.effectiveActions?.cancellation === false)
  )
    return outcome(false, input.isCurrent?.() ?? true);

  const actor = useChatInputStore.getState();
  const selectedAppId = useCurrentAppStore.getState().currentAppId;
  let detached = false;
  const isCurrent = () =>
    !detached &&
    (submission?.isCurrent() ?? input.isCurrent?.() ?? true) &&
    useChatStore.getState().currentTaskId === currentTaskId;
  const unsubscribeApp = useCurrentAppStore.subscribe(next => {
    if (next.currentAppId !== selectedAppId) detached = true;
  });
  const unsubscribeInput = useChatInputStore.subscribe(next => {
    if (
      next.actorEpoch !== actor.actorEpoch ||
      next.resolveScope(actor.currentRoute) !== next.currentRoute
    )
      detached = true;
  });
  const unsubscribeChat = useChatStore.subscribe(next => {
    if (next.currentTaskId !== currentTaskId) detached = true;
  });
  const guard =
    <Args extends unknown[]>(callback: (...args: Args) => void) =>
    (...args: Args) => {
      if (isCurrent()) callback(...args);
    };
  const key = JSON.stringify([
    actor.actorEpoch,
    input.currentUserId,
    appConfig?.appId,
    currentTaskId,
  ]);
  if (stoppingTasks.has(key)) {
    unsubscribeApp();
    unsubscribeInput();
    unsubscribeChat();
    return outcome(false, isCurrent());
  }
  stoppingTasks.add(key);
  try {
    if (!currentTaskId) {
      const fixed = await fixZombieStreamingStateIfNeeded({
        currentStreamingId,
        currentTaskId,
        dbConversationUUID: input.dbConversationUUID,
        finalizeStreamingMessage: guard(input.finalizeStreamingMessage),
        setIsWaitingForResponse: guard(input.setIsWaitingForResponse),
        updateMessage: guard(input.updateMessage),
        saveMessage: input.saveMessage,
      });
      if (fixed && isCurrent()) input.isSubmittingRef.current = false;
      return outcome(false, isCurrent());
    }
    if (!appConfig) return outcome(false, isCurrent());
    if (isCurrent() && currentStreamingId)
      input.flushChunkBuffer(currentStreamingId);
    const assistantSnapshot =
      useChatStore
        .getState()
        .messages.find(message => message.id === currentStreamingId) || null;
    const userSnapshot = findLatestUnsavedUserMessage() || null;
    const canSaveForNewConversation =
      isNewConversationUrl() || !input.difyConversationId;
    const confirmed = await stopRemoteStreamingTaskIfNeeded({
      currentTaskId,
      currentUserId: input.currentUserId,
      appId: appConfig.appId,
    });
    if (!confirmed) return outcome(false, isCurrent());

    let stoppedSnapshot = assistantSnapshot;
    let stoppedId = currentStreamingId;
    if (isCurrent()) {
      stoppedId = useChatStore.getState().streamingMessageId;
      if (input.appendTimerRef.current) {
        clearTimeout(input.appendTimerRef.current);
        input.appendTimerRef.current = null;
      }
      if (stoppedId) {
        input.flushChunkBuffer(stoppedId);
        stoppedSnapshot =
          useChatStore
            .getState()
            .messages.find(message => message.id === stoppedId) ||
          stoppedSnapshot;
        input.markAsManuallyStopped(stoppedId);
        input.finalizeStreamingMessage(stoppedId);
      }
    }
    if (stoppedId && stoppedSnapshot) {
      await persistStoppedStreamingState({
        currentStreamingId: stoppedId,
        assistantSnapshot: stoppedSnapshot,
        userSnapshot,
        canSaveForNewConversation,
        dbConversationUUID: input.dbConversationUUID,
        difyConversationId: input.difyConversationId,
        setDbConversationUUID: guard(input.setDbConversationUUID),
        updateMessage: guard(input.updateMessage),
        saveMessage: input.saveMessage,
        saveStoppedAssistantMessage: input.saveStoppedAssistantMessage,
      });
    }
    const current = isCurrent();
    if (current) {
      input.setIsWaitingForResponse(false);
      input.isSubmittingRef.current = false;
      input.setCurrentTaskId(null);
    }
    submission?.onStopped();
    return outcome(true, current);
  } finally {
    stoppingTasks.delete(key);
    unsubscribeApp();
    unsubscribeInput();
    unsubscribeChat();
  }
}
