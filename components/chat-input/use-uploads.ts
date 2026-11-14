import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';

import { useCallback } from 'react';

import type { ChatInputTranslations } from './helpers';

interface UseChatInputUploadsInput {
  scope: string | null;
  currentAppId: string | null;
  sessionUserId?: string;
  t: ChatInputTranslations;
}

export function useChatInputUploads({
  scope,
  currentAppId,
  sessionUserId,
  t,
}: UseChatInputUploadsInput) {
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const isCurrentActor = useCallback(() => {
    const actor = useChatInputStore.getState();
    return actor.actorId === sessionUserId && actor.actorEpoch === actorEpoch;
  }, [sessionUserId, actorEpoch]);
  const upload = useCallback(
    async (fileId: string) => {
      if (!scope || !currentAppId || !sessionUserId || !isCurrentActor())
        return;
      const store = useAttachmentStore.getState();
      const attachment = store.getFiles(scope).find(file => file.id === fileId);
      if (!attachment) return;
      const attempt = store.beginUpload(scope, fileId);
      if (attempt === undefined) return;
      try {
        const response = await uploadDifyFile(
          currentAppId,
          attachment.file,
          sessionUserId
        );
        if (!isCurrentActor()) return;
        useAttachmentStore.getState().finishUpload(scope, fileId, attempt, {
          uploadedId: response.id,
          appId: currentAppId,
          actorId: sessionUserId,
          actorEpoch,
        });
      } catch (error) {
        if (!isCurrentActor()) return;
        useAttachmentStore.getState().finishUpload(scope, fileId, attempt, {
          error:
            error instanceof Error ? error.message : t('input.uploadFailed'),
        });
      }
    },
    [scope, currentAppId, sessionUserId, t, isCurrentActor, actorEpoch]
  );

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      if (!isCurrentActor()) return;
      if (!scope || !currentAppId || !sessionUserId) {
        useNotificationStore
          .getState()
          .showNotification(t('input.uploadFailed'), 'error', 3000);
        return;
      }
      const store = useAttachmentStore.getState();
      const existing = new Set(store.getFiles(scope).map(file => file.id));
      store.addFiles(Array.from(files), scope);
      store
        .getFiles(scope)
        .filter(file => !existing.has(file.id))
        .forEach(file => {
          void upload(file.id);
        });
    },
    [scope, currentAppId, sessionUserId, t, upload, isCurrentActor]
  );

  return { handleFileSelect, handleRetryUpload: upload };
}
