import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';

import type { MutableRefObject } from 'react';

import type { ChatStreamCompletionData } from './types';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

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
): Promise<string | null> {
  let assistantMessageId = input.assistantMessageId;
  let lastAppendTime = Date.now();

  for await (const answerChunk of input.answerStream) {
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
  return assistantMessageId;
}

interface ApplyChatCompletionMetadataInput {
  completionPromise?: Promise<ChatStreamCompletionData>;
  assistantMessageId: string | null;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
}

export async function applyChatCompletionMetadata(
  input: ApplyChatCompletionMetadataInput
): Promise<void> {
  if (!input.completionPromise) {
    console.log('[handleSubmit] No completionPromise, skip metadata handling');
    return;
  }

  try {
    console.log('[handleSubmit] Waiting for Dify streaming completion info...');
    const completionData = await input.completionPromise;

    if (!input.assistantMessageId || !completionData) {
      return;
    }

    const existingMessage = useChatStore
      .getState()
      .messages.find(message => message.id === input.assistantMessageId);

    const enhancedMetadata = {
      ...(existingMessage?.metadata || {}),
      dify_metadata: completionData.metadata || {},
      dify_usage: completionData.usage || {},
      dify_retriever_resources: completionData.retrieverResources || [],
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
        completionData.usage?.total_tokens || existingMessage?.token_count,
      persistenceStatus: 'pending',
    });

    console.log('[handleSubmit] Updated assistant message Dify metadata:', {
      messageId: input.assistantMessageId,
      difyMetadata: completionData.metadata,
      usage: completionData.usage,
      retrieverResources: completionData.retrieverResources?.length || 0,
    });
  } catch (metadataError) {
    console.error('[handleSubmit] Failed to get Dify metadata:', metadataError);
  }
}
