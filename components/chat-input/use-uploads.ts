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
  files: { file?: File; name?: string; size?: number; type?: string }[],
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
    files
      .map(entry =>
        validateInputFile(
          slot,
          entry.file ?? {
            name: entry.name ?? '',
            size: entry.size ?? NaN,
            type: entry.type ?? '',
          }
        )
      )
      .find(Boolean) ||
    null
  );
}

export function uploadValidationMessage(
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

export async function uploadScopedAttachment({
  scope,
  draftId,
  appId,
  actorId,
  actorEpoch,
  isCurrentActor,
  transfer,
  onError,
}: {
  scope: string;
  draftId: string;
  appId: string;
  actorId: string;
  actorEpoch: number;
  isCurrentActor: () => boolean;
  transfer: (file: File) => Promise<{ id: string; previewUrl?: string }>;
  onError: (error: unknown) => string;
}) {
  if (!isCurrentActor()) return;
  const store = useAttachmentStore.getState();
  const file = store.getFiles(scope).find(entry => entry.id === draftId);
  if (!file?.file || file.status === 'uploading' || file.status === 'success')
    return;
  const attempt = store.beginUpload(scope, draftId);
  if (attempt === undefined) return;
  try {
    const { id, previewUrl } = await transfer(file.file);
    if (isCurrentActor())
      useAttachmentStore.getState().finishUpload(scope, draftId, attempt, {
        uploadedId: id,
        previewUrl,
        appId,
        actorId,
        actorEpoch,
      });
  } catch (error) {
    if (isCurrentActor())
      useAttachmentStore.getState().finishUpload(scope, draftId, attempt, {
        error: onError(error),
      });
  }
}

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
        !attachment?.file ||
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
      await uploadScopedAttachment({
        scope,
        draftId: fileId,
        appId: currentAppId,
        actorId: sessionUserId,
        actorEpoch,
        isCurrentActor,
        transfer: async file => {
          const response = await uploadDifyFile(
            currentAppId,
            file,
            sessionUserId
          );
          return {
            id: response.id,
            previewUrl:
              response.preview_url || response.source_url || undefined,
          };
        },
        onError: error => {
          onRequirementsChanged?.();
          return error instanceof Error
            ? error.message
            : t('input.uploadFailed');
        },
      });
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
