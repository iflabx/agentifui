'use client';

import {
  type ContentImageUploadResult,
  type ValidationResult,
  deleteContentImage,
  uploadContentImage,
  validateImageFile,
} from '@lib/services/content-image-upload-service';

import { useCallback, useState } from 'react';

/**
 * State type for content image upload
 */
export interface ContentImageUploadState {
  isUploading: boolean;
  isDeleting: boolean;
  progress: number;
  error: string | null;
  status: 'idle' | 'uploading' | 'success' | 'error' | 'deleting';
}

/**
 * Hook for content image upload, delete, and validation
 *
 * Provides state management and operations for uploading images
 * to the internal content-images object storage APIs
 *
 * @returns Object with state and operation functions
 */
export function useContentImageUpload() {
  const [state, setState] = useState<ContentImageUploadState>({
    isUploading: false,
    isDeleting: false,
    progress: 0,
    error: null,
    status: 'idle',
  });

  /**
   * Validate image file before upload
   *
   * @param file - File to validate
   * @returns Validation result
   */
  const validateFile = useCallback((file: File): ValidationResult => {
    return validateImageFile(file);
  }, []);

  /**
   * Upload content image to object storage
   *
   * @param file - Image file to upload
   * @param userId - User ID for file path generation
   * @returns Upload result with public URL and file path
   * @throws Error if upload fails
   */
  const uploadImage = useCallback(
    async (file: File, userId: string): Promise<ContentImageUploadResult> => {
      setState(prev => ({
        ...prev,
        isUploading: true,
        status: 'uploading',
        progress: 0,
        error: null,
      }));

      try {
        // Upload image using service layer (validation happens there)
        const result = await uploadContentImage(file, userId);

        setState(prev => ({
          ...prev,
          isUploading: false,
          status: 'success',
          progress: 100,
        }));

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Upload failed';

        setState(prev => ({
          ...prev,
          isUploading: false,
          status: 'error',
          error: errorMessage,
        }));

        throw error;
      }
    },
    []
  );

  /**
   * Delete content image from object storage
   *
   * @param filePath - File path in storage (e.g., user-{userId}/filename.jpg)
   * @throws Error if deletion fails
   */
  const deleteImage = useCallback(async (filePath: string): Promise<void> => {
    setState(prev => ({
      ...prev,
      isDeleting: true,
      status: 'deleting',
      error: null,
    }));

    try {
      await deleteContentImage(filePath);

      setState(prev => ({
        ...prev,
        isDeleting: false,
        status: 'success',
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Delete failed';

      setState(prev => ({
        ...prev,
        isDeleting: false,
        status: 'error',
        error: errorMessage,
      }));

      throw error;
    }
  }, []);

  /**
   * Reset upload/delete state to idle
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
    uploadImage,
    deleteImage,
    validateFile,
    resetState,
  };
}
