import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import type { ChatMessage } from '@lib/stores/chat-store';

import { runStreamingStateConsistencyCheck } from './streaming-check';
import type { ChatStreamingCheckSnapshot } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface UseChatStreamingStateInput {
  appendMessageChunk: (id: string, chunk: string) => void;
  finalizeStreamingMessage: (messageId: string) => void;
  setIsWaitingForResponse: (status: boolean) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  dbConversationUUID: string | null;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
}

interface UseChatStreamingStateReturn {
  isSubmittingRef: MutableRefObject<boolean>;
  chunkBufferRef: MutableRefObject<string>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  flushChunkBuffer: (id: string | null) => void;
}

export function useChatStreamingState({
  appendMessageChunk,
  finalizeStreamingMessage,
  setIsWaitingForResponse,
  setCurrentTaskId,
  dbConversationUUID,
  updateMessage,
  saveMessage,
}: UseChatStreamingStateInput): UseChatStreamingStateReturn {
  const isSubmittingRef = useRef(false);
  const chunkBufferRef = useRef('');
  const appendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamingCheckRef = useRef<ChatStreamingCheckSnapshot | null>(null);

  const flushChunkBuffer = useCallback(
    (id: string | null) => {
      if (id && chunkBufferRef.current) {
        appendMessageChunk(id, chunkBufferRef.current);
        chunkBufferRef.current = '';
      }
      if (appendTimerRef.current) {
        clearTimeout(appendTimerRef.current);
        appendTimerRef.current = null;
      }
    },
    [appendMessageChunk]
  );

  useEffect(() => {
    const interval = setInterval(() => {
      runStreamingStateConsistencyCheck({
        lastStreamingCheckRef,
        finalizeStreamingMessage,
        setIsWaitingForResponse,
        setCurrentTaskId,
        dbConversationUUID,
        updateMessage,
        saveMessage,
      });
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [
    finalizeStreamingMessage,
    setIsWaitingForResponse,
    setCurrentTaskId,
    dbConversationUUID,
    updateMessage,
    saveMessage,
  ]);

  return {
    isSubmittingRef,
    chunkBufferRef,
    appendTimerRef,
    flushChunkBuffer,
  };
}
