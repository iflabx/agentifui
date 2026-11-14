import type { ChatMessage } from '@lib/stores/chat-store';
import type { ServiceInstance } from '@lib/types/database';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { executeChatStop } from './stop-flow';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface UseChatStopHandlerInput {
  currentPathname?: string | null;
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

export function useChatStopHandler({
  currentPathname,
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
}: UseChatStopHandlerInput) {
  const viewEpoch = useRef(0);
  useLayoutEffect(() => {
    viewEpoch.current += 1;
    return () => {
      viewEpoch.current += 1;
    };
  }, [currentPathname, currentUserId, currentAppId]);
  return useCallback(async () => {
    const epoch = viewEpoch.current;
    return executeChatStop({
      isCurrent: () => viewEpoch.current === epoch,
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
  }, [
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
  ]);
}
