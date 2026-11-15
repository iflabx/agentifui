import { useAttachmentStore } from './attachment-store';
import { clearChatInputScopeCache } from './chat-input-scope-cache';
import { useChatInputStore } from './chat-input-store';
import { useLangchainDraftStore } from './langchain-draft-store';
import { usePendingConversationStore } from './pending-conversation-store';
import { useFilePreviewStore } from './ui/file-preview-store';

export function syncChatDraftActor(
  actorId: string | null,
  sessionId?: string | null
) {
  const input = useChatInputStore.getState();
  const langchain = useLangchainDraftStore.getState();
  const inputChanged = input.setActor(actorId, sessionId);
  if (!inputChanged && langchain.actorId === actorId) return;
  langchain.setActor(actorId, inputChanged);
  usePendingConversationStore.setState({ pendingConversations: new Map() });
  useAttachmentStore.getState().resetAll();
  clearChatInputScopeCache();
  useFilePreviewStore.getState().closePreview();
  useFilePreviewStore.getState().clearCache();
}
