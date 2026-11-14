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

  const original = useChatInputStore.getState().snapshot();
  useChatInputStore.getState().setMessage(input.messageText);
  const submitted = useChatInputStore.getState().snapshot();
  try {
    await input.handleSubmit(input.messageText, input.files, {});
  } catch (error) {
    const store = useChatInputStore.getState();
    const current = store.snapshot();
    if (
      store.resolveScope(submitted.scope) === current.scope &&
      current.revision === submitted.revision &&
      current.message === submitted.message
    )
      store.setMessage(original.message);
    console.error('[sendDirectMessage] Send failed:', error);
    throw error;
  }
}
