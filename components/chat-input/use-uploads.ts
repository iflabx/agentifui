import { uploadDifyFile } from '@lib/services/dify/file-service';
import {
  type AttachmentFile,
  useAttachmentStore,
} from '@lib/stores/attachment-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';

import { useCallback } from 'react';

import type { ChatInputTranslations } from './helpers';

interface UseChatInputUploadsInput {
  addFiles: (files: File[]) => void;
  currentAppId: string | null;
  sessionUserId?: string;
  t: ChatInputTranslations;
  updateFileStatus: (
    fileId: string,
    status: AttachmentFile['status'],
    errorMessage?: string
  ) => void;
  updateFileUploadedId: (fileId: string, uploadedId: string) => void;
}

export function useChatInputUploads({
  addFiles,
  currentAppId,
  sessionUserId,
  t,
  updateFileStatus,
  updateFileUploadedId,
}: UseChatInputUploadsInput) {
  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const filesArray = Array.from(files);
      addFiles(filesArray);

      filesArray.forEach(file => {
        const fileId = `${file.name}-${file.lastModified}-${file.size}`;
        updateFileStatus(fileId, 'uploading');

        const appIdToUse = currentAppId || 'chat-input-warning-no-app-id';
        const userIdToUse = sessionUserId || 'chat-input-warning-no-user-id';

        uploadDifyFile(appIdToUse, file, userIdToUse)
          .then(response => {
            updateFileUploadedId(fileId, response.id);
          })
          .catch(error => {
            updateFileStatus(
              fileId,
              'error',
              error.message || t('input.uploadFailed')
            );
          });
      });
    },
    [
      addFiles,
      currentAppId,
      sessionUserId,
      t,
      updateFileStatus,
      updateFileUploadedId,
    ]
  );

  const handleRetryUpload = useCallback(
    async (fileId: string) => {
      const attachment = useAttachmentStore
        .getState()
        .files.find(file => file.id === fileId);

      if (!attachment) {
        useNotificationStore
          .getState()
          .showNotification(
            `${t('input.retryUpload')}: ${t('input.fileUploadError')} ${fileId}`,
            'error'
          );
        return;
      }

      updateFileStatus(fileId, 'uploading');

      try {
        const appIdToUse = currentAppId || 'chat-input-warning-no-app-id';
        const userIdToUse = sessionUserId || 'chat-input-warning-no-user-id';
        const response = await uploadDifyFile(
          appIdToUse,
          attachment.file,
          userIdToUse
        );
        updateFileUploadedId(fileId, response.id);
      } catch (error) {
        updateFileStatus(
          fileId,
          'error',
          (error as Error).message || t('input.retryUpload')
        );
        useNotificationStore
          .getState()
          .showNotification(
            `${t('input.fileUploadError')} ${attachment.name}: ${(error as Error)?.message || t('input.unknownError')}`,
            'error'
          );
      }
    },
    [currentAppId, sessionUserId, t, updateFileStatus, updateFileUploadedId]
  );

  return {
    handleFileSelect,
    handleRetryUpload,
  };
}
