'use client';

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

  /**
   * Validate file type and size.
   */
  const validateFile = useCallback(
    (file: File): { valid: boolean; error?: string } => {
      const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
      ];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!allowedTypes.includes(file.type)) {
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
    [t]
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
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);

        const response = await fetch('/api/internal/storage/avatar', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        const payload = (await response.json()) as {
          success: boolean;
          url?: string;
          path?: string;
          error?: string;
        };

        if (!response.ok || !payload.success || !payload.url || !payload.path) {
          throw new Error(payload.error || t('errors.uploadFailedGeneric'));
        }

        setState(prev => ({
          ...prev,
          isUploading: false,
          status: 'success',
          progress: 100,
        }));

        return {
          url: payload.url,
          path: payload.path,
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
