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

    const previewFileId =
      messageFiles[index]?.upload_file_id || messageFiles[index]?.id;
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

  return messages.some(
    message =>
      hasAttachmentsWithoutPreviewId(message) || needsResultFiles(message)
  );
}

function needsResultFiles(message: ChatMessage): boolean {
  return (
    !message.isUser &&
    Boolean(message.db_id && message.dify_message_id) &&
    message.difyResultFiles === undefined
  );
}

function projectResultAttachments(
  message: ChatMessage,
  remote?: ConversationMessage
): ChatMessage {
  const attachments = Array.isArray(remote?.result_files)
    ? remote.result_files.flatMap((file): MessageAttachment[] => {
        if (
          !file ||
          typeof file.key !== 'string' ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/i.test(
            file.key
          )
        )
          return [];
        return [
          {
            id: file.key,
            upload_file_id: file.key,
            name:
              typeof file.name === 'string' && file.name ? file.name : file.key,
            size:
              Number.isSafeInteger(file.size) && file.size > 0 ? file.size : 0,
            type: file.image === true ? 'image/*' : 'application/octet-stream',
            source: 'dify-output',
            resultMessageId: message.db_id,
          },
        ];
      })
    : [];
  return {
    ...message,
    difyResultFiles: attachments,
  };
}

export function applyAttachmentPreviewIds(
  chatMessages: ChatMessage[],
  difyMessages: ConversationMessage[]
): ChatMessage[] {
  if (chatMessages.length === 0) {
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
    if (needsResultFiles(message)) {
      changed = true;
      return projectResultAttachments(
        message,
        difyMessageById.get(message.dify_message_id!)
      );
    }
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
  let response = await getConversationMessages(input.appId, {
    conversation_id: input.conversationId,
    user: input.userId,
    limit: Math.min(100, Math.max(input.chatMessages.length, 20)),
  });
  const history = [...response.data];
  const pending = new Set(
    input.chatMessages
      .filter(needsResultFiles)
      .map(message => message.dify_message_id)
  );
  const cursors = new Set<string>();
  for (
    let page = 1;
    page < 20 && pending.size && response.has_more;
    page += 1
  ) {
    response.data.forEach(message => pending.delete(message.id));
    const cursor = response.data.at(-1)?.id;
    if (!pending.size || !cursor || cursors.has(cursor)) break;
    cursors.add(cursor);
    response = await getConversationMessages(input.appId, {
      conversation_id: input.conversationId,
      user: input.userId,
      first_id: cursor,
      limit: 100,
    });
    history.push(...response.data);
  }
  return applyAttachmentPreviewIds(input.chatMessages, history);
}
