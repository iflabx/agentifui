import { useChatInputStore } from '@lib/stores/chat-input-store';

interface SendDirectChatMessageInput {
  messageText: string;
  files?: unknown[];
  handleSubmit: (
    message: string,
    files?: unknown[],
    inputs?: Record<string, unknown>
  ) => Promise<unknown>;
}

export async function sendDirectChatMessage(
  input: SendDirectChatMessageInput
): Promise<void> {
  if (!input.messageText.trim()) {
    console.warn('[sendDirectMessage] Message content is empty, skip sending');
    return;
  }

  const { setMessage } = useChatInputStore.getState();
  const originalMessage = useChatInputStore.getState().message;

  try {
    setMessage(input.messageText);
    await input.handleSubmit(input.messageText, input.files, {});
  } catch (error) {
    console.error('[sendDirectMessage] Send failed:', error);
    setMessage(originalMessage);
    throw error;
  }
}
