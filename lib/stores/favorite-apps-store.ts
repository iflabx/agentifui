import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FavoriteApp {
  instanceId: string;
  displayName: string;
  description?: string;
  iconUrl?: string;
  appType: 'model' | 'marketplace';
  dify_apptype?:
    | 'agent'
    | 'chatbot'
    | 'text-generation'
    | 'chatflow'
    | 'workflow';
  addedAt: string;
  lastUsedAt: string;
}

interface FavoriteAppsState {
  favoriteApps: FavoriteApp[];
  isLoading: boolean;
  error: string | null;
  // Added: expanded/collapsed state, default is collapsed
  isExpanded: boolean;

  // Actions
  addFavoriteApp: (app: Omit<FavoriteApp, 'addedAt' | 'lastUsedAt'>) => void;
  removeFavoriteApp: (instanceId: string) => void;
  updateLastUsed: (instanceId: string) => void;
  loadFavoriteApps: () => Promise<void>;
  clearFavoriteApps: () => void;
  isFavorite: (instanceId: string) => boolean;
  // Added: simple background sync method, non-blocking update
  syncWithAppList: (apps: any[]) => void;
  // Added: expand/collapse toggle methods
  toggleExpanded: () => void;
  setExpanded: (expanded: boolean) => void;
}

export const useFavoriteAppsStore = create<FavoriteAppsState>()(
  persist(
    (set, get) => ({
      favoriteApps: [],
      isLoading: false,
      error: null,
      // Default collapsed state
      isExpanded: false,

      addFavoriteApp: app => {
        const now = new Date().toISOString();
        const newApp: FavoriteApp = {
          ...app,
          addedAt: now,
          lastUsedAt: now,
        };

        set(state => {
          // Check if already exists
          const exists = state.favoriteApps.some(
            existingApp => existingApp.instanceId === app.instanceId
          );

          if (exists) {
            // If exists, update lastUsedAt
            return {
              favoriteApps: state.favoriteApps.map(existingApp =>
                existingApp.instanceId === app.instanceId
                  ? { ...existingApp, lastUsedAt: now }
                  : existingApp
              ),
            };
          } else {
            // If not exists, add new app
            return {
              favoriteApps: [...state.favoriteApps, newApp].sort(
                (a, b) =>
                  new Date(b.lastUsedAt).getTime() -
                  new Date(a.lastUsedAt).getTime()
              ),
              // Removed limit: allow user to favorite any number of apps
            };
          }
        });
      },

      removeFavoriteApp: instanceId => {
        set(state => ({
          favoriteApps: state.favoriteApps.filter(
            app => app.instanceId !== instanceId
          ),
        }));
      },

      updateLastUsed: instanceId => {
        const now = new Date().toISOString();
        set(state => ({
          favoriteApps: state.favoriteApps
            .map(app =>
              app.instanceId === instanceId ? { ...app, lastUsedAt: now } : app
            )
            .sort(
              (a, b) =>
                new Date(b.lastUsedAt).getTime() -
                new Date(a.lastUsedAt).getTime()
            ),
        }));
      },

      loadFavoriteApps: async () => {
        set({ isLoading: true, error: null });

        try {
          // Here you can load user's favorite apps from server
          // Currently using local storage, so just set loading to false
          set({ isLoading: false });
        } catch (error) {
          set({
            isLoading: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load favorite apps',
          });
        }
      },

      clearFavoriteApps: () => {
        set({ favoriteApps: [] });
      },

      isFavorite: instanceId => {
        return get().favoriteApps.some(app => app.instanceId === instanceId);
      },

      syncWithAppList: (apps: any[]) => {
        const state = get();
        if (state.favoriteApps.length === 0) return;

        // Enhanced sync: update app info and remove deleted apps
        const validFavoriteApps: FavoriteApp[] = [];
        let hasRemovedApps = false;

        state.favoriteApps.forEach(favoriteApp => {
          // Fix: use instance_id for matching, since favoriteApp.instanceId stores instance_id
          const matchedApp = apps.find(
            app => app.instance_id === favoriteApp.instanceId
          );

          if (matchedApp) {
            // App still exists, update info
            const appMetadata = matchedApp.config?.app_metadata;
            validFavoriteApps.push({
              ...favoriteApp,
              displayName:
                matchedApp.display_name ||
                matchedApp.name ||
                favoriteApp.displayName,
              description:
                matchedApp.description ||
                appMetadata?.brief_description ||
                favoriteApp.description,
              iconUrl: appMetadata?.icon_url || favoriteApp.iconUrl,
              dify_apptype:
                appMetadata?.dify_apptype || favoriteApp.dify_apptype,
            });
          } else {
            // App has been deleted, do not add to new list
            hasRemovedApps = true;
            console.log(
              `[FavoriteApps] Cleaned up deleted app: ${favoriteApp.displayName} (${favoriteApp.instanceId})`
            );
          }
        });

        // Check if there are changes (info updated or app deleted)
        const hasInfoChanges =
          validFavoriteApps.length !== state.favoriteApps.length ||
          validFavoriteApps.some((updated, index) => {
            const original = state.favoriteApps[index];
            return (
              !original ||
              updated.displayName !== original.displayName ||
              updated.description !== original.description ||
              updated.iconUrl !== original.iconUrl
            );
          });

        if (hasRemovedApps || hasInfoChanges) {
          console.log(
            `[FavoriteApps] Sync complete - info updated: ${hasInfoChanges}, apps removed: ${hasRemovedApps}`
          );
          set({ favoriteApps: validFavoriteApps });
        }
      },

      toggleExpanded: () => {
        set(state => ({ isExpanded: !state.isExpanded }));
      },

      setExpanded: (expanded: boolean) => {
        set({ isExpanded: expanded });
      },
    }),
    {
      name: 'favorite-apps-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist favoriteApps array
      partialize: state => ({
        favoriteApps: state.favoriteApps,
      }),
    }
  )
);

// Export a convenient hook to automatically add to favorites after app usage
export function useAutoAddFavoriteApp() {
  const { addFavoriteApp, updateLastUsed } = useFavoriteAppsStore();

  const addToFavorites = async (instanceId: string) => {
    console.log(`[addToFavorites] Add app to favorites: ${instanceId}`);

    try {
      const response = await fetch(
        `/api/internal/apps?instanceId=${encodeURIComponent(instanceId)}`,
        {
          method: 'GET',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        console.error(
          `[addToFavorites] Failed to query app info: ${instanceId}`
        );
        return;
      }

      const payload = (await response.json()) as {
        success: boolean;
        app?: {
          instance_id: string;
          display_name: string | null;
          description: string | null;
          config?: any;
          provider_name?: string;
        };
      };

      const instance = payload.app;
      if (!payload.success || !instance) {
        console.error(
          `[addToFavorites] Failed to query app info: ${instanceId}`
        );
        return;
      }

      // Handle found app instance
      const appMetadata = instance.config?.app_metadata;
      console.log(
        `[addToFavorites] Found app instance: ${instanceId}, provider: ${instance.provider_name || 'unknown'}`
      );

      // Key fix: only add marketplace type apps, skip model type
      const appType = appMetadata?.app_type || 'marketplace';

      if (appType !== 'marketplace') {
        console.log(
          `[addToFavorites] Skip non-marketplace app: ${instance.display_name || instanceId} (type: ${appType})`
        );
        return;
      }

      const favoriteApp = {
        instanceId: instance.instance_id,
        displayName: instance.display_name || instance.instance_id,
        description: instance.description || appMetadata?.brief_description,
        iconUrl: appMetadata?.icon_url,
        appType: 'marketplace' as const,
        dify_apptype: appMetadata?.dify_apptype || 'chatflow',
      };

      addFavoriteApp(favoriteApp);

      console.log(
        `[addToFavorites] Successfully added to favorites: ${instance.display_name || instanceId}`
      );
    } catch (error) {
      console.error(
        `[addToFavorites] Failed to add to favorites:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  return { addToFavorites, updateLastUsed };
}
