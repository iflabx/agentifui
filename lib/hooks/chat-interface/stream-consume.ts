import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import type { MutableRefObject } from 'react';

import type { ChatAnswerStreamResult, ChatStreamCompletionData } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;
const COMPLETION_METADATA_WAIT_TIMEOUT_MS = 1500;

interface ConsumeChatAnswerStreamInput {
  answerStream: AsyncGenerator<string, void, undefined>;
  assistantMessageId: string | null;
  isNewConversationFlow: boolean;
  finalRealConvId?: string;
  addMessage: (messageData: Omit<ChatMessage, 'id'>) => ChatMessage;
  setIsWaitingForResponse: (status: boolean) => void;
  updatePendingStatus: (
    id: string,
    status: PendingConversation['status']
  ) => void;
  chunkBufferRef: MutableRefObject<string>;
  appendTimerRef: MutableRefObject<NodeJS.Timeout | null>;
  flushChunkBuffer: (id: string | null) => void;
  markAsManuallyStopped: (id: string) => void;
  chunkAppendInterval: number;
}

export async function consumeChatAnswerStream(
  input: ConsumeChatAnswerStreamInput
): Promise<ChatAnswerStreamResult> {
  let assistantMessageId = input.assistantMessageId;
  let assistantText = '';
  let lastAppendTime = Date.now();

  for await (const answerChunk of input.answerStream) {
    assistantText += answerChunk;

    if (
      useChatStore.getState().streamingMessageId === null &&
      assistantMessageId === null
    ) {
      const assistantMessage = input.addMessage({
        text: '',
        isUser: false,
        isStreaming: true,
      });
      assistantMessageId = assistantMessage.id;
      useChatStore.setState({ streamingMessageId: assistantMessageId });
      input.setIsWaitingForResponse(false);

      if (input.isNewConversationFlow && input.finalRealConvId) {
        input.updatePendingStatus(input.finalRealConvId, 'streaming_message');
      }
    }

    if (assistantMessageId) {
      if (useChatStore.getState().streamingMessageId === assistantMessageId) {
        input.chunkBufferRef.current += answerChunk;
        if (
          Date.now() - lastAppendTime >= input.chunkAppendInterval ||
          input.chunkBufferRef.current.includes('\n') ||
          input.chunkBufferRef.current.length > 200
        ) {
          input.flushChunkBuffer(assistantMessageId);
          lastAppendTime = Date.now();
        } else if (!input.appendTimerRef.current) {
          input.appendTimerRef.current = setTimeout(() => {
            input.flushChunkBuffer(assistantMessageId);
            lastAppendTime = Date.now();
          }, input.chunkAppendInterval);
        }
      } else {
        console.log(
          '[handleSubmit] Stream was stopped externally, breaking chunk processing.'
        );
        if (
          !useChatStore
            .getState()
            .messages.find(message => message.id === assistantMessageId)
            ?.wasManuallyStopped
        ) {
          input.markAsManuallyStopped(assistantMessageId);
        }
        break;
      }
    }
  }

  input.flushChunkBuffer(assistantMessageId);
  return {
    assistantMessageId,
    assistantText,
  };
}

interface ApplyChatCompletionMetadataInput {
  completionPromise?: Promise<ChatStreamCompletionData>;
  assistantMessageId: string | null;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  waitTimeoutMs?: number;
}

function applyCompletionDataToAssistantMessage(input: {
  assistantMessageId: string;
  completionData: ChatStreamCompletionData;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
}) {
  const existingMessage = useChatStore
    .getState()
    .messages.find(message => message.id === input.assistantMessageId);

  const enhancedMetadata = {
    ...(existingMessage?.metadata || {}),
    dify_metadata: input.completionData.metadata || {},
    dify_usage: input.completionData.usage || {},
    dify_retriever_resources: input.completionData.retrieverResources || [],
    frontend_metadata: {
      stopped_manually: existingMessage?.metadata?.stopped_manually,
      stopped_at: existingMessage?.metadata?.stopped_at,
      attachments: existingMessage?.metadata?.attachments,
      sequence_index: existingMessage?.sequence_index || 1,
    },
  };

  input.updateMessage(input.assistantMessageId, {
    metadata: enhancedMetadata,
    token_count:
      input.completionData.usage?.total_tokens || existingMessage?.token_count,
    persistenceStatus: 'pending',
  });

  console.log('[handleSubmit] Updated assistant message Dify metadata:', {
    messageId: input.assistantMessageId,
    difyMetadata: input.completionData.metadata,
    usage: input.completionData.usage,
    retrieverResources: input.completionData.retrieverResources?.length || 0,
  });
}

export async function applyChatCompletionMetadata(
  input: ApplyChatCompletionMetadataInput
): Promise<ChatStreamCompletionData | null> {
  if (!input.completionPromise) {
    console.log('[handleSubmit] No completionPromise, skip metadata handling');
    return null;
  }

  const waitTimeoutMs =
    input.waitTimeoutMs ?? COMPLETION_METADATA_WAIT_TIMEOUT_MS;

  console.log('[handleSubmit] Waiting for Dify streaming completion info...');

  const completionWork = input.completionPromise
    .then(completionData => {
      if (!input.assistantMessageId || !completionData) {
        return completionData || null;
      }

      applyCompletionDataToAssistantMessage({
        assistantMessageId: input.assistantMessageId,
        completionData,
        updateMessage: input.updateMessage,
      });

      return completionData;
    })
    .catch(metadataError => {
      console.error(
        '[handleSubmit] Failed to get Dify metadata:',
        metadataError
      );
      return null;
    });

  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const raceResult = await Promise.race([
      completionWork,
      new Promise<null>(resolve => {
        timeoutId = setTimeout(() => resolve(null), waitTimeoutMs);
      }),
    ]);

    if (raceResult === null) {
      console.warn(
        `[handleSubmit] completionPromise still pending after ${waitTimeoutMs}ms, continue persisting assistant message without blocking`
      );
    }

    return raceResult;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
