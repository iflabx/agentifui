import { useAttachmentStore } from './attachment-store';
import { clearChatInputScopeCache } from './chat-input-scope-cache';
import { useChatInputStore } from './chat-input-store';
import { useLangchainDraftStore } from './langchain-draft-store';
import { useFilePreviewStore } from './ui/file-preview-store';

export function syncChatDraftActor(actorId: string | null) {
  const input = useChatInputStore.getState();
  const langchain = useLangchainDraftStore.getState();
  if (input.actorId === actorId && langchain.actorId === actorId) return;
  input.setActor(actorId);
  langchain.setActor(actorId);
  useAttachmentStore.getState().resetAll();
  clearChatInputScopeCache();
  useFilePreviewStore.getState().closePreview();
  useFilePreviewStore.getState().clearCache();
}
