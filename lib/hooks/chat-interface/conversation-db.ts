import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import type { ChatMessage } from '@lib/stores/chat-store';

interface ResolveDbConversationUuidInput {
  externalId: string;
  setDbConversationUUID: (conversationId: string) => void;
  errorLog: string;
  missingLog: string;
  successLog?: string;
}

export async function resolveDbConversationUuidByExternalId(
  input: ResolveDbConversationUuidInput
): Promise<string | null> {
  try {
    const result = await getConversationByExternalId(input.externalId);

    if (result.success && result.data) {
      const dbConversationId = result.data.id;
      input.setDbConversationUUID(dbConversationId);
      if (input.successLog) {
        console.log(`${input.successLog}${dbConversationId}`);
      }
      return dbConversationId;
    }

    console.warn(input.missingLog);
    return null;
  } catch (error) {
    console.error(input.errorLog, error);
    return null;
  }
}

interface PersistUserMessageIfNeededInput {
  userMessage: ChatMessage | null | undefined;
  conversationId: string | null;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  successLog?: string;
  errorLog: string;
}

export function persistUserMessageIfNeeded(
  input: PersistUserMessageIfNeededInput
): void {
  if (
    !input.conversationId ||
    !input.userMessage ||
    input.userMessage.persistenceStatus === 'saved'
  ) {
    return;
  }

  void input
    .saveMessage(input.userMessage, input.conversationId)
    .then(() => {
      if (input.successLog) {
        console.log(`${input.successLog}${input.userMessage?.id}`);
      }
    })
    .catch(error => {
      console.error(input.errorLog, error);
    });
}
