import {
  type ChatModerationTranslator,
  formatChatUiError,
  isKnownModerationError,
} from '@lib/hooks/chat-interface/error-utils';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

type ChatMessageUpdates = Partial<Omit<ChatMessage, 'id' | 'isUser'>>;

interface HandleChatSubmitStreamErrorInput {
  error: unknown;
  assistantMessageId: string | null;
  finalDbConvUUID: string | null;
  userMessage: ChatMessage;
  addMessage: (messageData: Omit<ChatMessage, 'id'>) => ChatMessage;
  setMessageError: (id: string, error: string | null) => void;
  updateMessage: (id: string, updates: ChatMessageUpdates) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  saveErrorPlaceholder: (
    conversationId: string,
    status?: 'sent' | 'delivered' | 'error',
    errorMessage?: string
  ) => Promise<boolean>;
  moderationT: ChatModerationTranslator;
}

export function handleChatSubmitStreamError(
  input: HandleChatSubmitStreamErrorInput
): Error {
  console.error('[handleSubmit] Error occurred during streaming:', input.error);
  const streamError =
    input.error instanceof Error ? input.error : new Error(String(input.error));
  const { errorMessage, errorCode } = formatChatUiError(
    streamError,
    'Unknown error',
    'dify-proxy',
    {
      moderationT: input.moderationT,
    }
  );

  if (input.assistantMessageId) {
    input.setMessageError(input.assistantMessageId, errorMessage);

    if (input.finalDbConvUUID) {
      const assistantMessage = useChatStore
        .getState()
        .messages.find(message => message.id === input.assistantMessageId);
      if (assistantMessage && assistantMessage.persistenceStatus !== 'saved') {
        console.log(
          `[handleSubmit] Save error assistant message, ID=${input.assistantMessageId}`
        );
        input.updateMessage(input.assistantMessageId, {
          persistenceStatus: 'pending',
        });
        void input
          .saveMessage(assistantMessage, input.finalDbConvUUID)
          .catch(error => {
            console.error(
              '[handleSubmit] Failed to save error assistant message:',
              error
            );
            input.updateMessage(input.assistantMessageId!, {
              persistenceStatus: 'error',
            });
          });
      }
    }

    return streamError;
  }

  const displayErrorMessage = isKnownModerationError(errorCode)
    ? errorMessage
    : `Sorry, an error occurred while processing your request: ${errorMessage}`;

  const errorAssistantMessage = input.addMessage({
    text: displayErrorMessage,
    isUser: false,
    error: errorMessage,
    persistenceStatus: 'pending',
  });

  if (input.finalDbConvUUID) {
    if (input.userMessage.persistenceStatus !== 'saved') {
      console.log(
        `[handleSubmit] Save user message in error handler, ID=${input.userMessage.id}`
      );
      void input
        .saveMessage(input.userMessage, input.finalDbConvUUID)
        .catch(error => {
          console.error(
            '[handleSubmit] Failed to save user message in error handler:',
            error
          );
        });
    }

    console.log(
      `[handleSubmit] Save error placeholder assistant message, ID=${errorAssistantMessage.id}`
    );
    void input
      .saveMessage(errorAssistantMessage, input.finalDbConvUUID)
      .catch(error => {
        console.error(
          '[handleSubmit] Failed to save error placeholder assistant message:',
          error
        );
        input.updateMessage(errorAssistantMessage.id, {
          persistenceStatus: 'error',
        });
      });

    const errorText = isKnownModerationError(errorCode)
      ? errorMessage
      : errorMessage
        ? `Assistant reply failed: ${errorMessage}`
        : 'Assistant reply failed: Unknown error';

    void input
      .saveErrorPlaceholder(input.finalDbConvUUID, 'error', errorText)
      .catch(error => {
        console.error(
          '[handleSubmit] Failed to create error placeholder assistant message:',
          error
        );
      });
  } else {
    console.warn(
      '[handleSubmit] Could not get db conversation ID, error message will not be persisted'
    );
  }

  return streamError;
}

interface FinalizeChatSubmitStreamInput {
  assistantMessageId: string | null;
  finalDbConvUUID: string | null;
  dbConversationUUID: string | null;
  finalizeStreamingMessage: (id: string) => void;
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
  isNewConversationFlow: boolean;
  finalRealConvId?: string;
}

export async function finalizeChatSubmitStream(
  input: FinalizeChatSubmitStreamInput
): Promise<void> {
  if (!input.assistantMessageId) {
    return;
  }

  const finalMessageState = useChatStore
    .getState()
    .messages.find(message => message.id === input.assistantMessageId);
  if (!finalMessageState || !finalMessageState.isStreaming) {
    return;
  }

  input.finalizeStreamingMessage(input.assistantMessageId);

  const currentDbConvId = input.finalDbConvUUID || input.dbConversationUUID;
  if (
    currentDbConvId &&
    finalMessageState.persistenceStatus !== 'saved' &&
    !finalMessageState.db_id
  ) {
    console.log(
      `[handleSubmit-finally] Unified save for assistant message, ID=${input.assistantMessageId}, wasManuallyStopped=${finalMessageState.wasManuallyStopped}`
    );

    const latestMessage = useChatStore
      .getState()
      .messages.find(message => message.id === input.assistantMessageId);
    if (latestMessage && latestMessage.text.trim().length > 0) {
      input.updateMessage(input.assistantMessageId, {
        persistenceStatus: 'pending',
      });

      if (latestMessage.wasManuallyStopped) {
        try {
          await input.saveStoppedAssistantMessage(
            latestMessage,
            currentDbConvId
          );
        } catch (error) {
          console.error(
            '[handleSubmit-finally] Failed to save stopped assistant message:',
            error
          );
          input.updateMessage(input.assistantMessageId, {
            persistenceStatus: 'error',
          });
        }
      } else {
        try {
          await input.saveMessage(latestMessage, currentDbConvId);
        } catch (error) {
          console.error(
            '[handleSubmit-finally] Failed to save assistant message:',
            error
          );
          input.updateMessage(input.assistantMessageId, {
            persistenceStatus: 'error',
          });
        }
      }
    }
  }

  const currentConvId = useChatStore.getState().currentConversationId;
  if (currentConvId) {
    try {
      const currentPath = window.location.pathname;
      if (currentPath === `/chat/${currentConvId}`) {
        const { useSidebarStore } = await import('@lib/stores/sidebar-store');
        useSidebarStore.getState().selectItem('chat', currentConvId, true);
      }
    } catch (error) {
      console.error('[Streaming End] Failed to highlight conversation:', error);
    }
  }

  if (input.isNewConversationFlow && input.finalRealConvId) {
    usePendingConversationStore
      .getState()
      .updateStatus(input.finalRealConvId, 'stream_completed_title_pending');
  }
}
