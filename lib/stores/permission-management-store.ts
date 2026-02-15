'use client';

import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { AppVisibility, ServiceInstance } from '@lib/types/database';
import { create } from 'zustand';

interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
}

interface GroupAppPermission {
  service_instance_id: string;
  is_enabled: boolean;
  usage_quota: number | null;
}

interface AdminAppListItem {
  id: string;
  name: string;
  instance_id: string;
  display_name?: string;
  description?: string;
  config?: Record<string, unknown>;
  visibility?: AppVisibility;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Permission management store - manage app permissions and group assignments
export interface AppWithPermissions extends ServiceInstance {
  // Group permission configuration for the current app
  groupPermissions: Array<{
    group_id: string;
    group_name: string;
    is_enabled: boolean;
    usage_quota: number | null;
  }>;
}

interface PermissionManagementState {
  // Data state
  apps: AppWithPermissions[];
  groups: Group[];
  selectedApp: AppWithPermissions | null;

  // Loading state
  loading: {
    apps: boolean;
    groups: boolean;
    updating: boolean;
  };

  // Error state
  error: string | null;

  // Search and filter
  searchTerm: string;
  visibilityFilter: AppVisibility | 'all';
}

interface PermissionManagementActions {
  // Data loading
  loadApps: () => Promise<void>;
  loadGroups: () => Promise<void>;
  loadAppPermissions: (appId: string) => Promise<void>;

  // App management
  updateAppVisibility: (
    appId: string,
    visibility: AppVisibility
  ) => Promise<boolean>;
  selectApp: (app: AppWithPermissions | null) => void;

  // Group permission management
  setGroupPermission: (
    appId: string,
    groupId: string,
    enabled: boolean,
    quota?: number | null
  ) => Promise<boolean>;

  // Search and filter
  setSearchTerm: (term: string) => void;
  setVisibilityFilter: (filter: AppVisibility | 'all') => void;

  // Utility methods
  getFilteredApps: () => AppWithPermissions[];
  reset: () => void;
}

type PermissionManagementStore = PermissionManagementState &
  PermissionManagementActions;

const initialState: PermissionManagementState = {
  apps: [],
  groups: [],
  selectedApp: null,
  loading: {
    apps: false,
    groups: false,
    updating: false,
  },
  error: null,
  searchTerm: '',
  visibilityFilter: 'all',
};

export const usePermissionManagementStore = create<PermissionManagementStore>(
  (set, get) => ({
    ...initialState,

    // Data loading function
    loadApps: async () => {
      set(state => ({
        loading: { ...state.loading, apps: true },
        error: null,
      }));

      try {
        const response = await fetch('/api/internal/apps?scope=all', {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Failed to load app list: HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          success: boolean;
          apps?: AdminAppListItem[];
          error?: string;
        };

        if (!payload.success) {
          throw new Error(payload.error || 'Failed to load app list');
        }

        const appsData = payload.apps || [];

        // Convert to AppWithPermissions format
        const apps: AppWithPermissions[] = appsData.map(app => ({
          id: app.id,
          provider_id: '', // Empty for now, can be extended later
          display_name: app.display_name || null,
          description: app.description || null,
          instance_id: app.instance_id,
          api_path: '', // Get from config
          is_default: false,
          visibility: (app.visibility as AppVisibility) || 'public',
          config: app.config || {},
          created_at: '',
          updated_at: '',
          groupPermissions: [], // Initially empty, needs to be loaded separately
        }));

        set(state => ({
          apps,
          loading: { ...state.loading, apps: false },
        }));
      } catch (error: unknown) {
        console.error('Failed to load app list:', error);
        set(state => ({
          error: resolveErrorMessage(error, 'Failed to load app list'),
          loading: { ...state.loading, apps: false },
        }));
      }
    },

    loadGroups: async () => {
      set(state => ({
        loading: { ...state.loading, groups: true },
        error: null,
      }));

      try {
        const result =
          await callInternalDataAction<Group[]>('groups.getGroups');

        if (result.success) {
          set(state => ({
            groups: result.data,
            loading: { ...state.loading, groups: false },
          }));
        } else {
          throw new Error(result.error.message);
        }
      } catch (error: unknown) {
        console.error('Failed to load group list:', error);
        set(state => ({
          error: resolveErrorMessage(error, 'Failed to load group list'),
          loading: { ...state.loading, groups: false },
        }));
      }
    },

    loadAppPermissions: async (appId: string) => {
      try {
        const { groups } = get();

        // Get permissions for each group for the given app
        const groupPermissions = await Promise.all(
          groups.map(async group => {
            const result = await callInternalDataAction<GroupAppPermission[]>(
              'groups.getGroupAppPermissions',
              { groupId: group.id }
            );

            if (result.success) {
              const appPermission = result.data.find(
                p => p.service_instance_id === appId
              );

              return {
                group_id: group.id,
                group_name: group.name,
                is_enabled: appPermission?.is_enabled || false,
                usage_quota: appPermission?.usage_quota || null,
              };
            }

            return {
              group_id: group.id,
              group_name: group.name,
              is_enabled: false,
              usage_quota: null,
            };
          })
        );

        // Update group permission info for the app
        set(state => ({
          apps: state.apps.map(app =>
            app.id === appId ? { ...app, groupPermissions } : app
          ),
          selectedApp:
            state.selectedApp?.id === appId
              ? { ...state.selectedApp, groupPermissions }
              : state.selectedApp,
        }));
      } catch (error: unknown) {
        console.error('Failed to load app permissions:', error);
        set({
          error: resolveErrorMessage(error, 'Failed to load app permissions'),
        });
      }
    },

    // App management function
    updateAppVisibility: async (appId: string, visibility: AppVisibility) => {
      set(state => ({
        loading: { ...state.loading, updating: true },
        error: null,
      }));

      try {
        const response = await fetch('/api/internal/apps', {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: appId, visibility }),
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: string;
        };

        if (response.ok && payload.success) {
          // Data cleanup logic after permission switch
          // When switching from group_only to other permissions, clean up related records in the group permission table
          // If switching to non-group_only permission, remove all related group permission records
          if (visibility !== 'group_only') {
            try {
              const cleanupResult = await callInternalDataAction<void>(
                'groups.removeAllGroupAppPermissions',
                {
                  serviceInstanceId: appId,
                }
              );
              if (!cleanupResult.success) {
                throw cleanupResult.error;
              }
            } catch (cleanupError) {
              console.warn(
                'Warning during group permission cleanup:',
                cleanupError
              );
              // Do not block main process, just log warning
            }
          }

          // Update local state
          set(state => ({
            apps: state.apps.map(app =>
              app.id === appId ? { ...app, visibility } : app
            ),
            selectedApp:
              state.selectedApp?.id === appId
                ? { ...state.selectedApp, visibility }
                : state.selectedApp,
            loading: { ...state.loading, updating: false },
          }));

          // If the currently selected app is the one being updated, reload its permissions
          if (get().selectedApp?.id === appId) {
            await get().loadAppPermissions(appId);
          }

          return true;
        } else {
          throw new Error(payload.error || 'Failed to update app visibility');
        }
      } catch (error: unknown) {
        console.error('Failed to update app visibility:', error);
        set(state => ({
          error: resolveErrorMessage(error, 'Failed to update app visibility'),
          loading: { ...state.loading, updating: false },
        }));
        return false;
      }
    },

    selectApp: (app: AppWithPermissions | null) => {
      set({ selectedApp: app });

      // If an app is selected, load its permission info
      if (app) {
        get().loadAppPermissions(app.id);
      }
    },

    // Group permission management function
    setGroupPermission: async (
      appId: string,
      groupId: string,
      enabled: boolean,
      quota?: number | null
    ) => {
      set(state => ({
        loading: { ...state.loading, updating: true },
        error: null,
      }));

      try {
        const result = await callInternalDataAction<GroupAppPermission>(
          'groups.setGroupAppPermission',
          {
            groupId,
            serviceInstanceId: appId,
            data: {
              is_enabled: enabled,
              usage_quota: quota,
            },
          }
        );

        if (result.success) {
          // Reload app permission info
          await get().loadAppPermissions(appId);

          set(state => ({ loading: { ...state.loading, updating: false } }));
          return true;
        } else {
          throw new Error(result.error.message);
        }
      } catch (error: unknown) {
        console.error('Failed to set group permission:', error);
        set(state => ({
          error: resolveErrorMessage(error, 'Failed to set group permission'),
          loading: { ...state.loading, updating: false },
        }));
        return false;
      }
    },

    // Search and filter functions
    setSearchTerm: (term: string) => {
      set({ searchTerm: term });
    },

    setVisibilityFilter: (filter: AppVisibility | 'all') => {
      set({ visibilityFilter: filter });
    },

    getFilteredApps: () => {
      const { apps, searchTerm, visibilityFilter } = get();

      return apps.filter(app => {
        // Search filter
        const matchesSearch =
          !searchTerm ||
          app.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.instance_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.description?.toLowerCase().includes(searchTerm.toLowerCase());

        // Visibility filter
        const matchesVisibility =
          visibilityFilter === 'all' || app.visibility === visibilityFilter;

        return matchesSearch && matchesVisibility;
      });
    },

    reset: () => {
      set(initialState);
    },
  })
);
