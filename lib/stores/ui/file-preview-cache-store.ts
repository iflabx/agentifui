/**
 * File Preview Cache Store
 * @description Centralized cache management for file preview content
 * Integrates with existing project cache cleanup system
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getCacheKey } from './file-preview-cache-store/helpers';
import { createFilePreviewCacheState } from './file-preview-cache-store/state';
import type { FilePreviewCacheState } from './file-preview-cache-store/types';

export const useFilePreviewCacheStore = create<FilePreviewCacheState>()(
  persist(createFilePreviewCacheState, {
    name: 'file-preview-cache-storage',
    storage: createJSONStorage(() => localStorage),
    partialize: state => ({
      config: state.config,
      stats: state.stats,
    }),
    onRehydrateStorage: () => state => {
      if (state) {
        state.runtimeCache = new Map();
      }
    },
  })
);

export { getCacheKey };

if (typeof window !== 'undefined') {
  setInterval(
    () => {
      const store = useFilePreviewCacheStore.getState();
      store.cleanup();
    },
    5 * 60 * 1000
  );
}
