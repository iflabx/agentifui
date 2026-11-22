import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';

import { useCallback } from 'react';

import {
  type AgentAttachmentSlot,
  type AgentInputCapabilities,
  validateInputFile,
  validateInputFileCount,
} from '../../packages/shared/src/agent-input';

export function validateChatAttachments(
  capabilities: AgentInputCapabilities | null,
  files: { file: File }[],
  continuingConversation = false
): string | null {
  if (capabilities?.status !== 'ready') return 'INPUT_CAPABILITIES_UNAVAILABLE';
  const slots = capabilities.attachmentSlots.filter(
    slot => slot.target === 'files'
  );
  if (
    slots.length > 1 ||
    capabilities.attachmentSlots.some(
      slot =>
        !continuingConversation && slot.target === 'inputs' && slot.minCount > 0
    )
  )
    return 'INPUT_CAPABILITIES_UNSUPPORTED';
  const slot = slots[0];
  if (!slot) return files.length ? 'INPUT_UPLOAD_DISABLED' : null;
  return (
    validateInputFileCount(slot, files.length) ||
    files.map(entry => validateInputFile(slot, entry.file)).find(Boolean) ||
    null
  );
}

function uploadValidationMessage(
  code: string,
  slot: AgentAttachmentSlot,
  t: UploadTranslations
) {
  if (code === 'INPUT_TOO_MANY_FILES')
    return t('fileTypeSelector.maxFilesReached', { maxFiles: slot.maxCount });
  if (code === 'INPUT_FILE_TYPE') return t('fileUpload.unsupportedFormat');
  if (code === 'INPUT_FILE_SIZE') return t('fileUpload.fileTooLarge');
  return t('input.capabilitiesUnsupported');
}

type UploadTranslations = (
  key: string,
  params?: Record<string, string | number>
) => string;

interface UseChatInputUploadsInput {
  scope: string | null;
  currentAppId: string | null;
  sessionUserId?: string;
  t: UploadTranslations;
  slot?: AgentAttachmentSlot;
  onRequirementsChanged?: () => void;
}

export function useChatInputUploads({
  scope,
  currentAppId,
  sessionUserId,
  t,
  slot,
  onRequirementsChanged,
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
      if (
        !attachment ||
        !slot ||
        attachment.status === 'uploading' ||
        attachment.status === 'success'
      )
        return;
      const validationError =
        validateInputFile(slot, attachment.file) ||
        (store.getFiles(scope).length > slot.maxCount
          ? 'INPUT_TOO_MANY_FILES'
          : null);
      if (validationError) {
        useNotificationStore
          .getState()
          .showNotification(
            uploadValidationMessage(validationError, slot, t),
            'error',
            3000
          );
        return;
      }
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
          previewUrl: response.preview_url || response.source_url || undefined,
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
        onRequirementsChanged?.();
      }
    },
    [
      scope,
      currentAppId,
      sessionUserId,
      t,
      isCurrentActor,
      actorEpoch,
      slot,
      onRequirementsChanged,
    ]
  );

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      if (!isCurrentActor()) return;
      if (!scope || !currentAppId || !sessionUserId || !slot) {
        useNotificationStore
          .getState()
          .showNotification(t('input.uploadFailed'), 'error', 3000);
        return;
      }
      const store = useAttachmentStore.getState();
      const reservation = store.reserveFiles(Array.from(files), slot, scope);
      if (reservation.error) {
        useNotificationStore
          .getState()
          .showNotification(
            uploadValidationMessage(reservation.error, slot, t),
            'error',
            3000
          );
        return;
      }
      reservation.ids.forEach(id => {
        void upload(id);
      });
    },
    [scope, currentAppId, sessionUserId, t, upload, isCurrentActor, slot]
  );

  return { handleFileSelect, handleRetryUpload: upload };
}
