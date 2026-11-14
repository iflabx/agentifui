import type { ChatSubmissionAccepted } from '@lib/hooks/chat-interface/types';
import { bindChatInputConversation } from '@lib/hooks/use-chat-input-route-sync';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';

export function captureDifyInputSubmission(message: string, userId: string) {
  const input = useChatInputStore.getState();
  const snapshot = input.snapshot();
  const epoch = input.actorEpoch;
  const files = [...useAttachmentStore.getState().getFiles(snapshot.scope)];
  const eligible = input.actorId === userId && snapshot.message === message;
  let accepted = false;
  const ownsActor = () => {
    const current = useChatInputStore.getState();
    return current.actorEpoch === epoch && current.actorId === userId;
  };
  return (appId: string, binding: ChatSubmissionAccepted) => {
    const prefix = JSON.stringify([epoch, userId, appId]).slice(0, -1) + ',';
    if (
      accepted ||
      !eligible ||
      !ownsActor() ||
      !snapshot.scope.startsWith(prefix) ||
      !binding.externalId ||
      !binding.taskId
    )
      return;
    accepted = true;
    useChatInputStore.getState().consumeSnapshot(snapshot);
    useAttachmentStore.getState().consumeFiles(snapshot.scope, files);
    void (async () => {
      if (binding.conversationPersistencePromise) {
        const dbId = await binding.conversationPersistencePromise;
        if (!dbId) return;
      }
      if (!ownsActor()) return;
      await bindChatInputConversation(
        snapshot.scope,
        userId,
        appId,
        binding.externalId
      );
    })().catch(() => undefined);
  };
}
