'use client';

import { STORAGE_UPLOAD_POLICIES } from '@lib/shared/storage-upload-policy';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

/**
 * State type for avatar upload.
 */
export interface AvatarUploadState {
  isUploading: boolean;
  isDeleting: boolean;
  progress: number;
  error: string | null;
  status: 'idle' | 'uploading' | 'success' | 'error' | 'deleting';
}

/**
 * Result type for avatar upload.
 */
export interface AvatarUploadResult {
  url: string;
  path: string;
}

const STORAGE_LEGACY_RELAY_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (process.env.NEXT_PUBLIC_STORAGE_LEGACY_RELAY_ENABLED || '')
    .trim()
    .toLowerCase()
);

/**
 * Hook for avatar upload, delete, and URL generation.
 */
export function useAvatarUpload() {
  const [state, setState] = useState<AvatarUploadState>({
    isUploading: false,
    isDeleting: false,
    progress: 0,
    error: null,
    status: 'idle',
  });

  const t = useTranslations('pages.settings.avatarUpload');
  const avatarPolicy = STORAGE_UPLOAD_POLICIES.avatars;

  /**
   * Validate file type and size.
   */
  const validateFile = useCallback(
    (file: File): { valid: boolean; error?: string } => {
      const allowedTypes = avatarPolicy.allowedMimeTypes;
      const maxSize = avatarPolicy.maxBytes;

      if (!allowedTypes.includes(file.type as (typeof allowedTypes)[number])) {
        return {
          valid: false,
          error: t('errors.unsupportedFileType', {
            types: allowedTypes.join(', '),
          }),
        };
      }

      if (file.size > maxSize) {
        return {
          valid: false,
          error: t('errors.fileTooLarge', {
            maxSize: Math.round(maxSize / 1024 / 1024),
          }),
        };
      }

      return { valid: true };
    },
    [avatarPolicy.allowedMimeTypes, avatarPolicy.maxBytes, t]
  );

  /**
   * Upload avatar file and update user profile.
   */
  const uploadAvatar = useCallback(
    async (file: File, userId: string): Promise<AvatarUploadResult> => {
      const validation = validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      setState(prev => ({
        ...prev,
        isUploading: true,
        status: 'uploading',
        progress: 0,
        error: null,
      }));

      try {
        const runLegacyUpload = async (): Promise<AvatarUploadResult> => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('userId', userId);

          const legacyResponse = await fetch('/api/internal/storage/avatar', {
            method: 'POST',
            body: formData,
            credentials: 'include',
          });
          const legacyPayload = (await legacyResponse.json()) as {
            success: boolean;
            url?: string;
            path?: string;
            error?: string;
          };

          if (
            !legacyResponse.ok ||
            !legacyPayload.success ||
            !legacyPayload.url ||
            !legacyPayload.path
          ) {
            throw new Error(
              legacyPayload.error || t('errors.uploadFailedGeneric')
            );
          }

          return {
            url: legacyPayload.url,
            path: legacyPayload.path,
          };
        };

        let uploadResult: AvatarUploadResult;

        try {
          const presignResponse = await fetch(
            '/api/internal/storage/avatar/presign',
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId,
                fileName: file.name,
                contentType: file.type,
                fileSize: file.size,
              }),
            }
          );

          const presignPayload = (await presignResponse.json()) as {
            success: boolean;
            uploadUrl?: string;
            path?: string;
            error?: string;
          };

          if (
            !presignResponse.ok ||
            !presignPayload.success ||
            !presignPayload.uploadUrl ||
            !presignPayload.path
          ) {
            throw new Error(
              presignPayload.error || t('errors.uploadFailedGeneric')
            );
          }

          const uploadResponse = await fetch(presignPayload.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
          });

          if (!uploadResponse.ok) {
            throw new Error(
              `Avatar direct upload failed with status ${uploadResponse.status}`
            );
          }

          const commitResponse = await fetch('/api/internal/storage/avatar', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId,
              path: presignPayload.path,
            }),
          });

          const commitPayload = (await commitResponse.json()) as {
            success: boolean;
            url?: string;
            path?: string;
            error?: string;
          };

          if (
            !commitResponse.ok ||
            !commitPayload.success ||
            !commitPayload.url ||
            !commitPayload.path
          ) {
            throw new Error(
              commitPayload.error || t('errors.uploadFailedGeneric')
            );
          }

          uploadResult = {
            url: commitPayload.url,
            path: commitPayload.path,
          };
        } catch (presignError) {
          if (!STORAGE_LEGACY_RELAY_ENABLED) {
            throw presignError instanceof Error
              ? presignError
              : new Error(t('errors.uploadFailedGeneric'));
          }

          console.warn(
            '[AvatarUpload] presign flow failed, fallback to legacy relay upload:',
            presignError
          );
          uploadResult = await runLegacyUpload();
        }

        setState(prev => ({
          ...prev,
          isUploading: false,
          status: 'success',
          progress: 100,
        }));

        return {
          url: uploadResult.url,
          path: uploadResult.path,
        };
      } catch (error) {
        setState(prev => ({
          ...prev,
          isUploading: false,
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : t('errors.uploadFailedGeneric'),
        }));
        throw error;
      }
    },
    [validateFile, t]
  );

  /**
   * Delete avatar file and clear avatar_url in database.
   */
  const deleteAvatar = useCallback(
    async (filePath: string, userId: string): Promise<void> => {
      setState(prev => ({
        ...prev,
        isDeleting: true,
        status: 'deleting',
        error: null,
      }));

      try {
        const response = await fetch('/api/internal/storage/avatar', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ filePath, userId }),
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: string;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || t('errors.deleteFailedGeneric'));
        }

        setState(prev => ({
          ...prev,
          isDeleting: false,
          status: 'success',
        }));
      } catch (error) {
        setState(prev => ({
          ...prev,
          isDeleting: false,
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : t('errors.deleteFailedGeneric'),
        }));
        throw error;
      }
    },
    [t]
  );

  /**
   * Reset upload/delete state.
   */
  const resetState = useCallback(() => {
    setState({
      isUploading: false,
      isDeleting: false,
      progress: 0,
      error: null,
      status: 'idle',
    });
  }, []);

  return {
    state,
    uploadAvatar,
    deleteAvatar,
    validateFile,
    resetState,
  };
}
