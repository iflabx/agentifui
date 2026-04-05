/**
 * Chat message persistence hook (refactored version)
 *
 * This file implements logic for saving, updating, and retrying messages,
 * as well as managing message persistence state.
 * Adapts to the new Result type system and unified data service.
 */
import {
  type MessageSavePayload,
  createPlaceholderAssistantMessageRecord,
  findDuplicateMessage,
  saveMessageRecord,
  updateMessageMetadataRecord,
} from '@lib/services/client/messages-api';
import { ChatMessage, useChatStore } from '@lib/stores/chat-store';

import { useCallback, useRef, useState } from 'react';

// Message persistence status type
// pending: waiting to be saved
// saving: currently saving
// saved: saved successfully
// error: failed to save
export type MessagePersistenceStatus = 'pending' | 'saving' | 'saved' | 'error';

// Retry configuration
// maxRetries: maximum retry attempts
// baseDelayMs: base delay in milliseconds
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000, // 1 second, used for exponential backoff
};

function chatMessageToSavePayload(
  chatMessage: ChatMessage,
  conversationId: string,
  userId?: string
): MessageSavePayload {
  const baseMetadata: Record<string, unknown> = {
    ...(chatMessage.metadata || {}),
  };

  if (chatMessage.wasManuallyStopped && !baseMetadata.stopped_manually) {
    baseMetadata.stopped_manually = true;
    baseMetadata.stopped_at =
      (baseMetadata.stopped_at as string | undefined) ||
      new Date().toISOString();
  }

  if (chatMessage.attachments && chatMessage.attachments.length > 0) {
    baseMetadata.attachments = chatMessage.attachments;
  }

  const sequenceIndex =
    chatMessage.sequence_index !== undefined
      ? chatMessage.sequence_index
      : chatMessage.isUser
        ? 0
        : 1;

  return {
    conversation_id: conversationId,
    user_id: chatMessage.isUser ? userId || null : null,
    role: chatMessage.role || (chatMessage.isUser ? 'user' : 'assistant'),
    content: chatMessage.text,
    metadata: baseMetadata,
    status: chatMessage.error ? 'error' : 'sent',
    external_id: chatMessage.dify_message_id || null,
    token_count: chatMessage.token_count || null,
    sequence_index: sequenceIndex,
  };
}

/**
 * Chat message persistence hook (refactored version)
 * Provides message saving, status updating, and error handling capabilities.
 * Uses the new Result type system for correctness.
 *
 * @param userId Current user ID, used for saving user messages
 * @returns Functions and state related to message persistence
 */
export function useChatMessages(userId?: string) {
  // State to track currently saving messages for concurrency and state management
  const [savingMessages, setSavingMessages] = useState<Set<string>>(new Set());
  const { updateMessage } = useChatStore();

  // Ref to track saving state, avoiding closure issues
  const savingMessagesRef = useRef<Set<string>>(new Set());

  // Add a message to the saving set
  const addSavingMessage = useCallback((messageId: string) => {
    setSavingMessages(prev => {
      const newSet = new Set(prev);
      newSet.add(messageId);
      savingMessagesRef.current = newSet;
      return newSet;
    });
  }, []);

  // Remove a message from the saving set
  const removeSavingMessage = useCallback((messageId: string) => {
    setSavingMessages(prev => {
      const newSet = new Set(prev);
      newSet.delete(messageId);
      savingMessagesRef.current = newSet;
      return newSet;
    });
  }, []);

  // Check if a message is currently being saved
  const isMessageSaving = useCallback((messageId: string): boolean => {
    return savingMessagesRef.current.has(messageId);
  }, []);

  /**
   * Save a message to the database (refactored version)
   * Uses the new Result type system for proper error handling
   *
   * @param message Frontend message object
   * @param conversationId Database conversation ID
   * @param retryCount Number of retry attempts (starts from 0)
   * @returns Whether the save was successful
   */
  const saveMessage = useCallback(
    async (
      message: ChatMessage,
      conversationId: string,
      retryCount: number = 0
    ): Promise<boolean> => {
      // Core logic for saving a message (refactored):
      // 1. Strict parameter validation
      // 2. Check if message is already being saved to avoid duplicates
      // 3. Check if a duplicate exists in the database (deduplication)
      // 4. Update UI state to saving
      // 5. Convert frontend message to database format
      // 6. Call new database API to save (using Result type)
      // 7. Update UI state based on result
      // 8. Retry with exponential backoff if failed

      // Strict parameter validation
      if (!message || !message.id || !conversationId) {
        console.error(
          `[saveMessage] Invalid parameters: message=${!!message}, messageId=${message?.id}, conversationId=${conversationId}`
        );
        return false;
      }

      // Check if message content is empty or too short (avoid saving incomplete messages)
      if (!message.text || message.text.trim().length === 0) {
        console.warn(
          `[saveMessage] Message content is empty, skipping save: messageId=${message.id}`
        );
        return false;
      }

      // Check if message is already being saved to avoid duplicate saves
      if (isMessageSaving(message.id)) {
        console.log(
          `[saveMessage] Message ${message.id} is already being saved, skipping duplicate request`
        );
        return false;
      }

      // Check if message has already been saved successfully
      if (message.persistenceStatus === 'saved' && message.db_id) {
        console.log(
          `[saveMessage] Message ${message.id} already saved, db ID: ${message.db_id}`
        );
        return true;
      }

      try {
        // Check if a duplicate message exists in the database to avoid duplicate saves
        // Uses the new Result type interface
        const duplicateResult = await findDuplicateMessage(
          message.text,
          message.isUser ? 'user' : 'assistant',
          conversationId
        );

        if (duplicateResult.success && duplicateResult.data) {
          console.log(
            `[saveMessage] Message content already exists in database, updating UI state to avoid duplicate save`
          );
          updateMessage(message.id, {
            persistenceStatus: 'saved',
            db_id: duplicateResult.data.id,
            dify_message_id: duplicateResult.data.external_id || undefined,
          });
          return true;
        }

        // Mark message as being saved
        addSavingMessage(message.id);

        // Update UI state to saving
        updateMessage(message.id, { persistenceStatus: 'saving' });

        console.log(
          `[saveMessage] Start saving message, conversationId=${conversationId}, messageId=${message.id}, contentLength=${message.text.length}, retryCount=${retryCount}`
        );

        // Convert to database format and save
        // Uses internal API + Result type
        const dbMessageData = chatMessageToSavePayload(
          message,
          conversationId,
          userId
        );
        const saveResult = await saveMessageRecord(dbMessageData);

        if (!saveResult.success) {
          throw new Error(
            `Failed to save message: ${saveResult.error?.message || 'Unknown error'}, conversationId=${conversationId}`
          );
        }

        const savedMessage = saveResult.data;

        // Save successful, update UI state
        updateMessage(message.id, {
          persistenceStatus: 'saved',
          db_id: savedMessage.id,
          dify_message_id: savedMessage.external_id || undefined,
        });

        console.log(
          `[saveMessage] Message saved successfully, db message ID=${savedMessage.id}, contentLength=${savedMessage.content.length}`
        );

        // Remove from saving set
        removeSavingMessage(message.id);
        return true;
      } catch (error) {
        console.error(`[saveMessage] Error saving message:`, error);

        // If retries remain, retry with exponential backoff
        if (retryCount < RETRY_CONFIG.maxRetries) {
          const delayMs = Math.pow(2, retryCount) * RETRY_CONFIG.baseDelayMs; // Exponential backoff: 1s, 2s, 4s...
          console.log(
            `[saveMessage] Retrying in ${delayMs}ms, attempt #${retryCount + 1}`
          );

          // Retry after delay, using current state
          setTimeout(() => {
            // Get latest message state to ensure content is up to date
            const currentMessage = useChatStore
              .getState()
              .messages.find(m => m.id === message.id);
            if (currentMessage) {
              saveMessage(currentMessage, conversationId, retryCount + 1).catch(
                err => {
                  console.error(
                    `[saveMessage] Retry #${retryCount + 1} failed:`,
                    err
                  );
                }
              );
            }
          }, delayMs);

          // Do not immediately set status to error, wait for retry result
          return false;
        }

        // Max retries reached, update UI state to error
        updateMessage(message.id, { persistenceStatus: 'error' });
        console.error(
          `[saveMessage] Max retries reached (${RETRY_CONFIG.maxRetries}), message save failed`
        );

        // Remove from saving set
        removeSavingMessage(message.id);
        return false;
      }
    },
    [
      userId,
      updateMessage,
      isMessageSaving,
      addSavingMessage,
      removeSavingMessage,
    ]
  );

  /**
   * Save a stopped assistant message (special handling)
   * Ensures that when the user clicks stop, the current assistant message block is saved correctly
   *
   * @param message Assistant message object
   * @param conversationId Database conversation ID
   * @returns Whether the save was successful
   */
  const saveStoppedAssistantMessage = useCallback(
    async (message: ChatMessage, conversationId: string): Promise<boolean> => {
      const persistStoppedMetadata = async (
        stoppedMessage: ChatMessage,
        fallbackStoppedAt?: string
      ): Promise<boolean> => {
        const saved = await saveMessage(stoppedMessage, conversationId);
        if (!saved) {
          return false;
        }

        const latestSavedMessage = useChatStore
          .getState()
          .messages.find(m => m.id === message.id);

        if (!latestSavedMessage?.db_id) {
          return true;
        }

        const stoppedMetadata = {
          ...(latestSavedMessage.metadata || {}),
          stopped_manually: true,
          stopped_at:
            (latestSavedMessage.metadata?.stopped_at as string | undefined) ||
            fallbackStoppedAt ||
            new Date().toISOString(),
        };

        const patchResult = await updateMessageMetadataRecord({
          conversationId,
          messageId: latestSavedMessage.db_id,
          metadata: stoppedMetadata,
        });

        if (!patchResult.success) {
          console.warn(
            '[saveStoppedAssistantMessage] Failed to patch stopped metadata:',
            patchResult.error
          );
          return false;
        }

        updateMessage(message.id, {
          metadata: stoppedMetadata,
          wasManuallyStopped: true,
        });

        return true;
      };

      // Special logic for saving a stopped assistant message:
      // 1. Ensure message content is not empty (even if stopped)
      // 2. Add stop marker to metadata
      // 3. Save immediately, no delay
      if (!message || !message.id || !conversationId) {
        console.error(`[saveStoppedAssistantMessage] Invalid parameters`);
        return false;
      }

      // Ensure message has content, even if very short
      if (!message.text || message.text.trim().length === 0) {
        console.warn(
          `[saveStoppedAssistantMessage] Stopped message content is empty, using default content`
        );
        // Add default content for empty stopped message
        updateMessage(message.id, {
          text: '[Assistant message interrupted]',
          wasManuallyStopped: true,
          metadata: {
            ...message.metadata,
            stopped_manually: true,
            stopped_at: new Date().toISOString(),
          },
        });

        // Get updated message
        const updatedMessage = useChatStore
          .getState()
          .messages.find(m => m.id === message.id);
        if (updatedMessage) {
          return persistStoppedMetadata(
            updatedMessage,
            updatedMessage.metadata?.stopped_at as string | undefined
          );
        }
        return false;
      }

      console.log(
        `[saveStoppedAssistantMessage] Saving stopped assistant message, ID=${message.id}, contentLength=${message.text.length}`
      );

      // Update message state, add stop marker
      const updatedMetadata = {
        ...(message.metadata || {}),
        stopped_manually: true,
        stopped_at: new Date().toISOString(),
      };

      updateMessage(message.id, {
        metadata: updatedMetadata,
        wasManuallyStopped: true,
        persistenceStatus: 'pending', // Mark as pending save
      });

      const updatedMessage = useChatStore
        .getState()
        .messages.find(m => m.id === message.id);

      if (!updatedMessage) {
        return false;
      }

      // Save the stopped message immediately with the updated stopped metadata.
      return persistStoppedMetadata(updatedMessage, updatedMetadata.stopped_at);
    },
    [saveMessage, updateMessage]
  );

  /**
   * Save an error placeholder assistant message (refactored version)
   * Ensures that even if the assistant reply fails, a record is saved in the database
   * Uses the new Result type system
   *
   * @param conversationId Database conversation ID
   * @param status Message status
   * @param errorMessage Error message
   * @returns Whether the save was successful
   */
  const saveErrorPlaceholder = useCallback(
    async (
      conversationId: string,
      status: 'sent' | 'delivered' | 'error' = 'error',
      errorMessage: string = ''
    ): Promise<boolean> => {
      // Create and save an error placeholder assistant message
      // Ensures message pairs even if assistant reply fails
      // Uses new Result type interface
      // Parameter validation
      if (!conversationId) {
        console.error('[saveErrorPlaceholder] conversationId cannot be empty');
        return false;
      }

      // Generate a unique placeholder ID for tracking and logging
      const placeholderId = `error-placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      try {
        console.log(
          `[saveErrorPlaceholder] Creating error placeholder assistant message, conversationId=${conversationId}, placeholderId=${placeholderId}`
        );

        // Use new Result type interface to create placeholder message
        const result = await createPlaceholderAssistantMessageRecord(
          conversationId,
          status,
          errorMessage ||
            `Assistant reply failed (placeholderId: ${placeholderId})`
        );

        if (result.success) {
          console.log(
            `[saveErrorPlaceholder] Successfully created placeholder assistant message, ID=${result.data.id}, placeholderId=${placeholderId}`
          );
          return true;
        } else {
          console.error(
            `[saveErrorPlaceholder] Failed to create placeholder assistant message:`,
            result.error
          );
          return false;
        }
      } catch (error) {
        console.error(
          `[saveErrorPlaceholder] Exception creating placeholder assistant message (placeholderId=${placeholderId}):`,
          error
        );
        return false;
      }
    },
    []
  );

  /**
   * Batch save multiple messages (refactored version)
   * Used to save user and assistant message pairs at once
   * Ensures message content integrity
   *
   * @param messages Array of messages to save
   * @param conversationId Database conversation ID
   * @returns Number of messages saved successfully
   */
  const saveMessages = useCallback(
    async (
      messages: ChatMessage[],
      conversationId: string
    ): Promise<number> => {
      // Batch save logic (refactored):
      // 1. Parameter validation
      // 2. Filter out empty messages to ensure integrity
      // 3. Call saveMessage for each message
      // 4. Return number of successful saves
      if (!messages || !messages.length || !conversationId) {
        console.error(
          `[saveMessages] Invalid parameters: messages=${!!messages}, messagesLength=${messages?.length}, conversationId=${conversationId}`
        );
        return 0;
      }

      // Filter out empty or too short messages to ensure integrity
      const validMessages = messages.filter(
        msg => msg && msg.text && msg.text.trim().length > 0
      );

      if (validMessages.length === 0) {
        console.warn(`[saveMessages] No valid messages to save`);
        return 0;
      }

      console.log(
        `[saveMessages] Start batch saving ${validMessages.length} valid messages (total ${messages.length}), conversationId=${conversationId}`
      );

      let successCount = 0;

      // Save each message in order to ensure sequence
      for (const message of validMessages) {
        const success = await saveMessage(message, conversationId);
        if (success) {
          successCount++;
        }
      }

      console.log(
        `[saveMessages] Batch save complete, successfully saved ${successCount}/${validMessages.length} messages`
      );
      return successCount;
    },
    [saveMessage]
  );

  /**
   * Check if there are messages that need to be persisted (refactored version)
   * @param messages Array of messages
   * @returns Whether there are messages to persist
   */
  const hasMessagesToPersist = useCallback(
    (messages: ChatMessage[]): boolean => {
      return messages.some(
        msg =>
          msg &&
          msg.text &&
          msg.text.trim().length > 0 &&
          (msg.persistenceStatus === 'pending' ||
            (msg.persistenceStatus === 'error' && !msg.db_id))
      );
    },
    []
  );

  /**
   * Validate if a message is complete (new feature)
   * Ensures incomplete messages are not saved
   *
   * @param message Message object
   * @returns Whether the message is complete
   */
  const isMessageComplete = useCallback((message: ChatMessage): boolean => {
    if (!message || !message.id) return false;
    if (!message.text || message.text.trim().length === 0) return false;

    // For streaming messages, check if still streaming
    if (message.isStreaming === true) {
      console.log(
        `[isMessageComplete] Message ${message.id} is still streaming, not saving yet`
      );
      return false;
    }

    return true;
  }, []);

  return {
    saveMessage,
    saveMessages,
    saveStoppedAssistantMessage, // New: save stopped assistant message
    saveErrorPlaceholder,
    hasMessagesToPersist,
    isMessageSaving,
    isMessageComplete, // New: validate message completeness
    savingMessagesCount: savingMessages.size,
  };
}
