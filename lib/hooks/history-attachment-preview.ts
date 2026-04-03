import { getConversationMessages } from '@lib/services/dify/message-service';
import type { ConversationMessage } from '@lib/services/dify/types';
import type { ChatMessage, MessageAttachment } from '@lib/stores/chat-store';

export function resolveHistoryAttachmentPreviewUserId(input: {
  sessionUserId?: string | null;
  profileUserId?: string | null;
}): string | null {
  const sessionUserId = input.sessionUserId?.trim();
  if (sessionUserId) {
    return sessionUserId;
  }

  const profileUserId = input.profileUserId?.trim();
  return profileUserId || null;
}

function hasAttachmentsWithoutPreviewId(message: ChatMessage): boolean {
  return Boolean(
    message.isUser &&
      message.attachments?.some(
        attachment => !attachment.preview_file_id && attachment.upload_file_id
      )
  );
}

function getUserMessageFiles(
  message: ConversationMessage | undefined
): ConversationMessage['message_files'] {
  return (message?.message_files || []).filter(
    file => file.belongs_to === 'user'
  );
}

function applyPreviewIdsToAttachments(
  attachments: MessageAttachment[],
  messageFiles: ConversationMessage['message_files']
): MessageAttachment[] {
  let changed = false;

  const nextAttachments = attachments.map((attachment, index) => {
    if (attachment.preview_file_id) {
      return attachment;
    }

    const previewFileId = messageFiles[index]?.id;
    if (!previewFileId) {
      return attachment;
    }

    changed = true;
    return {
      ...attachment,
      preview_file_id: previewFileId,
    };
  });

  return changed ? nextAttachments : attachments;
}

function findPreviewSourceByAssistantId(
  message: ChatMessage,
  difyMessageById: Map<string, ConversationMessage>
): ConversationMessage | null {
  if (!message.dify_message_id) {
    return null;
  }

  return difyMessageById.get(message.dify_message_id) || null;
}

function findPreviewSourceByQuery(
  message: ChatMessage,
  difyMessages: ConversationMessage[],
  usedMessageIds: Set<string>
): ConversationMessage | null {
  const normalizedQuery = message.text.trim();
  if (!normalizedQuery) {
    return null;
  }

  for (const difyMessage of difyMessages) {
    if (usedMessageIds.has(difyMessage.id)) {
      continue;
    }

    if (difyMessage.query.trim() !== normalizedQuery) {
      continue;
    }

    if (getUserMessageFiles(difyMessage).length === 0) {
      continue;
    }

    usedMessageIds.add(difyMessage.id);
    return difyMessage;
  }

  return null;
}

export function hasPendingAttachmentPreviewSync(
  messages: ChatMessage[]
): boolean {
  if (messages.some(message => message.isStreaming)) {
    return false;
  }

  return messages.some(hasAttachmentsWithoutPreviewId);
}

export function applyAttachmentPreviewIds(
  chatMessages: ChatMessage[],
  difyMessages: ConversationMessage[]
): ChatMessage[] {
  if (chatMessages.length === 0 || difyMessages.length === 0) {
    return chatMessages;
  }

  const sortedDifyMessages = [...difyMessages].sort(
    (left, right) => left.created_at - right.created_at
  );
  const difyMessageById = new Map(
    sortedDifyMessages.map(message => [message.id, message] as const)
  );
  const usedFallbackMessageIds = new Set<string>();

  let changed = false;
  const nextMessages = chatMessages.map((message, index) => {
    if (!hasAttachmentsWithoutPreviewId(message) || !message.attachments) {
      return message;
    }

    const nextAssistantMessage = chatMessages
      .slice(index + 1)
      .find(candidate => !candidate.isUser);

    const assistantPreviewSource =
      nextAssistantMessage &&
      findPreviewSourceByAssistantId(nextAssistantMessage, difyMessageById);
    const previewSource =
      getUserMessageFiles(assistantPreviewSource || undefined).length > 0
        ? assistantPreviewSource
        : findPreviewSourceByQuery(
            message,
            sortedDifyMessages,
            usedFallbackMessageIds
          );

    const nextAttachments = applyPreviewIdsToAttachments(
      message.attachments,
      getUserMessageFiles(previewSource || undefined)
    );

    if (nextAttachments === message.attachments) {
      return message;
    }

    changed = true;
    return {
      ...message,
      attachments: nextAttachments,
    };
  });

  return changed ? nextMessages : chatMessages;
}

export async function fetchAttachmentPreviewIds(input: {
  appId: string;
  conversationId: string;
  userId: string;
  chatMessages: ChatMessage[];
}): Promise<ChatMessage[]> {
  const response = await getConversationMessages(input.appId, {
    conversation_id: input.conversationId,
    user: input.userId,
    limit: Math.max(input.chatMessages.length, 20),
  });

  return applyAttachmentPreviewIds(input.chatMessages, response.data);
}
