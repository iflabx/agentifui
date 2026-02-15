import { previewDifyFile } from '@lib/services/dify/file-service';
import type { DifyFilePreviewResponse } from '@lib/services/dify/types';
import type { MessageAttachment } from '@lib/stores/chat-store';
import { create } from 'zustand';

import {
  getCacheKey,
  useFilePreviewCacheStore,
} from './file-preview-cache-store';

interface FilePreviewState {
  // Basic State
  isPreviewOpen: boolean;
  currentPreviewFile: MessageAttachment | null;

  // API State
  isLoading: boolean;
  error: string | null;

  // Content Data
  previewContent: Blob | null;
  contentHeaders: DifyFilePreviewResponse['headers'] | null;

  // Actions
  openPreview: (file: MessageAttachment, appId?: string) => Promise<void>;
  closePreview: () => void;
  downloadFile: () => Promise<void>;
  clearError: () => void;
  clearCache: () => void;
}

export const useFilePreviewStore = create<FilePreviewState>((set, get) => ({
  // Basic State
  isPreviewOpen: false,
  currentPreviewFile: null,

  // API State
  isLoading: false,
  error: null,

  // Content Data
  previewContent: null,
  contentHeaders: null,

  // Actions
  openPreview: async (file: MessageAttachment, appId?: string) => {
    // Use appId from parameter or file, with fallback
    const finalAppId = appId || file.app_id;

    if (!finalAppId) {
      set({
        error: 'No application ID available for file preview',
        isPreviewOpen: true,
        currentPreviewFile: file,
        isLoading: false,
      });
      return;
    }

    // Generate cache key
    const cacheKey = getCacheKey(finalAppId, file.upload_file_id);
    const cacheStore = useFilePreviewCacheStore.getState();

    // Try to get from cache first
    const cachedEntry = cacheStore.get(cacheKey);

    if (cachedEntry) {
      // Cache hit - use cached content
      set({
        isPreviewOpen: true,
        currentPreviewFile: file,
        previewContent: cachedEntry.content,
        contentHeaders: cachedEntry.headers,
        isLoading: false,
        error: null,
      });
      return;
    }

    // Cache miss - show loading and fetch from API
    set({
      isPreviewOpen: true,
      currentPreviewFile: file,
      isLoading: true,
      error: null,
      previewContent: null,
      contentHeaders: null,
    });

    try {
      // Call the previewDifyFile API
      const response = await previewDifyFile(
        finalAppId,
        file.upload_file_id,
        { as_attachment: false } // Preview mode
      );

      // Store in cache
      const cached = cacheStore.set(
        cacheKey,
        response.content,
        response.headers
      );

      // Log cache status for debugging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[File Preview] Cache ${cached ? 'stored' : 'skipped'} for ${file.name} (${(response.content.size / 1024).toFixed(1)}KB)`
        );
      }

      set({
        previewContent: response.content,
        contentHeaders: response.headers,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to preview file';
      set({
        error: errorMessage,
        isLoading: false,
        previewContent: null,
        contentHeaders: null,
      });
    }
  },

  closePreview: () => {
    // Clean up any object URLs to prevent memory leaks
    const { previewContent } = get();
    if (previewContent) {
      // Note: We'll handle Object URL cleanup in components
    }

    set({
      isPreviewOpen: false,
      currentPreviewFile: null,
      previewContent: null,
      contentHeaders: null,
      error: null,
      isLoading: false,
    });
  },

  downloadFile: async () => {
    const { currentPreviewFile } = get();
    if (!currentPreviewFile) return;

    const finalAppId = currentPreviewFile.app_id;
    if (!finalAppId) {
      set({ error: 'No application ID available for file download' });
      return;
    }

    try {
      // Call the API with attachment mode
      const response = await previewDifyFile(
        finalAppId,
        currentPreviewFile.upload_file_id,
        { as_attachment: true } // Download mode
      );

      // Create download link
      const url = URL.createObjectURL(response.content);
      const link = document.createElement('a');
      link.href = url;
      link.download = currentPreviewFile.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to download file';
      set({ error: errorMessage });
    }
  },

  clearError: () => set({ error: null }),

  clearCache: () => {
    const cacheStore = useFilePreviewCacheStore.getState();
    cacheStore.clear();

    if (process.env.NODE_ENV === 'development') {
      console.log('[File Preview] Cache cleared');
    }
  },
}));
