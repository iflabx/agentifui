import {
  agentPath,
  readAgentRequestError,
} from '@lib/services/client/langchain-api';
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

let previewGeneration = 0;

async function fetchPreview(
  file: MessageAttachment,
  appId: string,
  fileId: string,
  download: boolean
): Promise<DifyFilePreviewResponse> {
  if (file.source !== 'agent-input')
    return previewDifyFile(appId, fileId, {
      as_attachment: download,
    });
  const response = await fetch(
    agentPath(appId, `/files/${encodeURIComponent(fileId)}`),
    {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok) throw await readAgentRequestError(response);
  return {
    content: await response.blob(),
    headers: {
      contentType:
        response.headers.get('content-type') || 'application/octet-stream',
      contentDisposition:
        response.headers.get('content-disposition') ?? undefined,
    },
  };
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
    const generation = ++previewGeneration;
    const previewFileId = file.upload_file_id || file.preview_file_id || '';

    // Preserve the file's original app context first; only fall back to the caller appId.
    const finalAppId = file.app_id || appId;

    if (!finalAppId || !previewFileId) {
      set({
        error: !finalAppId
          ? 'No application ID available for file preview'
          : 'No file ID available for file preview',
        isPreviewOpen: true,
        currentPreviewFile: file,
        isLoading: false,
      });
      return;
    }

    const previewFile =
      file.app_id === finalAppId ? file : { ...file, app_id: finalAppId };

    // Generate cache key
    const cacheKey = getCacheKey(finalAppId, previewFileId);
    const cacheStore = useFilePreviewCacheStore.getState();

    // Try to get from cache first
    const cachedEntry =
      file.source === 'agent-input' ? undefined : cacheStore.get(cacheKey);

    if (cachedEntry) {
      // Cache hit - use cached content
      set({
        isPreviewOpen: true,
        currentPreviewFile: previewFile,
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
      currentPreviewFile: previewFile,
      isLoading: true,
      error: null,
      previewContent: null,
      contentHeaders: null,
    });

    try {
      // Call the previewDifyFile API
      const response = await fetchPreview(
        previewFile,
        finalAppId,
        previewFileId,
        false
      );
      if (generation !== previewGeneration) return;

      // Store in cache
      const cached =
        file.source !== 'agent-input' &&
        cacheStore.set(cacheKey, response.content, response.headers);

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
      if (generation !== previewGeneration) return;
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
    previewGeneration += 1;
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
    const generation = previewGeneration;
    const { currentPreviewFile } = get();
    if (!currentPreviewFile) return;
    const previewFileId =
      currentPreviewFile.upload_file_id ||
      currentPreviewFile.preview_file_id ||
      '';

    const finalAppId = currentPreviewFile.app_id;
    if (!finalAppId || !previewFileId) {
      set({
        error: !finalAppId
          ? 'No application ID available for file download'
          : 'No file ID available for file download',
      });
      return;
    }

    try {
      // Call the API with attachment mode
      const response = await fetchPreview(
        currentPreviewFile,
        finalAppId,
        previewFileId,
        true
      );
      if (generation !== previewGeneration) return;

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
      if (generation !== previewGeneration) return;
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to download file';
      set({ error: errorMessage });
    }
  },

  clearError: () => set({ error: null }),

  clearCache: () => {
    previewGeneration += 1;
    const cacheStore = useFilePreviewCacheStore.getState();
    cacheStore.clear();

    if (process.env.NODE_ENV === 'development') {
      console.log('[File Preview] Cache cleared');
    }
  },
}));
