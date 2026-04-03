'use client';

import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';

import { useEffect, useRef } from 'react';

import {
  fetchAttachmentPreviewIds,
  hasPendingAttachmentPreviewSync,
} from './history-attachment-preview';

interface UseHistoryAttachmentPreviewSyncInput {
  appId: string | null | undefined;
  conversationId: string;
  messages: ChatMessage[];
  userId: string | null | undefined;
}

function isPersistedConversationId(conversationId: string): boolean {
  return (
    Boolean(conversationId) &&
    conversationId !== 'new' &&
    !conversationId.startsWith('temp-')
  );
}

export function useHistoryAttachmentPreviewSync(
  input: UseHistoryAttachmentPreviewSyncInput
): void {
  const requestVersionRef = useRef(0);
  const lastAttemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !isPersistedConversationId(input.conversationId) ||
      !input.appId ||
      !input.userId ||
      !hasPendingAttachmentPreviewSync(input.messages)
    ) {
      return;
    }

    const attemptKey = [
      input.conversationId,
      input.appId,
      input.userId,
      input.messages
        .map(
          message =>
            `${message.id}:${message.dify_message_id || ''}:${message.text}:${
              message.attachments
                ?.map(
                  attachment =>
                    `${attachment.upload_file_id}:${attachment.preview_file_id || ''}`
                )
                .join(',') || ''
            }`
        )
        .join('|'),
    ].join('::');

    if (lastAttemptKeyRef.current === attemptKey) {
      return;
    }
    lastAttemptKeyRef.current = attemptKey;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let cancelled = false;
    const sourceMessageIds = input.messages
      .map(message => message.id)
      .join('|');

    void fetchAttachmentPreviewIds({
      appId: input.appId,
      conversationId: input.conversationId,
      userId: input.userId,
      chatMessages: input.messages,
    })
      .then(resolvedMessages => {
        if (cancelled || requestVersionRef.current !== requestVersion) {
          return;
        }

        useChatStore.setState(state => {
          if (
            state.messages.map(message => message.id).join('|') !==
            sourceMessageIds
          ) {
            return state;
          }

          if (!hasPendingAttachmentPreviewSync(state.messages)) {
            return state;
          }

          return resolvedMessages === input.messages
            ? state
            : { ...state, messages: resolvedMessages };
        });
      })
      .catch(error => {
        if (cancelled) {
          return;
        }

        lastAttemptKeyRef.current = null;

        console.warn(
          '[Attachment Preview Sync] Failed to resolve attachment preview ids:',
          error
        );
      });

    return () => {
      cancelled = true;
    };
  }, [input.appId, input.conversationId, input.messages, input.userId]);
}
