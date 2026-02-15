/**
 * SSO Providers Management Store
 * @description Manages SSO providers state using Zustand
 * @module lib/stores/sso-providers-store
 */
import { callInternalDataAction } from '@lib/db/internal-data-api';
import {
  CreateSsoProviderData,
  SsoProtocol,
  SsoProvider,
} from '@lib/types/database';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SsoProviderFilters {
  protocol?: SsoProtocol;
  enabled?: boolean;
  search?: string;
  sortBy?: 'name' | 'protocol' | 'created_at' | 'display_order';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

interface SsoProviderStats {
  total: number;
  enabled: number;
  disabled: number;
  byProtocol: Record<SsoProtocol, number>;
}

interface UpdateSsoProviderData {
  name?: string;
  protocol?: SsoProtocol;
  settings?: SsoProvider['settings'];
  client_id?: string | null;
  client_secret?: string | null;
  metadata_url?: string | null;
  enabled?: boolean;
  display_order?: number;
  button_text?: string | null;
}

/**
 * Loading states for different operations
 */
interface LoadingState {
  providers: boolean;
  stats: boolean;
  providerDetail: boolean;
  updating: boolean;
  deleting: boolean;
  creating: boolean;
  toggling: boolean;
  reordering: boolean;
}

/**
 * Filter options for UI components
 */
interface FilterOptions {
  protocols: SsoProtocol[];
  enabledOptions: Array<{ value: boolean; label: string }>;
}

/**
 * SSO Providers management state interface
 */
interface SsoProvidersState {
  // Data state
  providers: SsoProvider[];
  stats: SsoProviderStats | null;
  selectedProvider: SsoProvider | null;
  selectedProviderIds: string[];

  // Filter options data
  filterOptions: FilterOptions;

  // Pagination and filtering
  filters: SsoProviderFilters;
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };

  // Loading state
  loading: LoadingState;
  error: string | null;

  // UI state
  showProviderDetail: boolean;
  showCreateForm: boolean;
  showEditForm: boolean;
  showDeleteConfirm: boolean;

  // Actions
  loadProviders: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadProviderDetail: (providerId: string) => Promise<void>;
  loadFilterOptions: () => Promise<void>;

  updateFilters: (filters: Partial<SsoProviderFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  selectProvider: (provider: SsoProvider) => void;
  selectProviders: (providerIds: string[]) => void;
  toggleProviderSelection: (providerId: string) => void;
  clearSelection: () => void;

  // Provider operations
  addProvider: (data: CreateSsoProviderData) => Promise<boolean>;
  editProvider: (id: string, data: UpdateSsoProviderData) => Promise<boolean>;
  removeProvider: (id: string) => Promise<boolean>;
  toggleProviderStatus: (id: string, enabled: boolean) => Promise<boolean>;
  reorderProviders: (
    updates: Array<{ id: string; display_order: number }>
  ) => Promise<boolean>;

  // UI operations
  showCreateProviderForm: () => void;
  showEditProviderForm: (provider: SsoProvider) => void;
  showDeleteProviderConfirm: (provider: SsoProvider) => void;
  showProviderDetailModal: (provider: SsoProvider) => void;
  hideCreateForm: () => void;
  hideEditForm: () => void;
  hideDeleteConfirm: () => void;
  hideProviderDetailModal: () => void;

  // Cleanup
  clearError: () => void;
  resetStore: () => void;
}

/**
 * Initial state values
 */
const initialState = {
  providers: [],
  stats: null,
  selectedProvider: null,
  selectedProviderIds: [],
  filterOptions: {
    protocols: ['CAS', 'SAML', 'OAuth2', 'OIDC'] as SsoProtocol[],
    enabledOptions: [
      { value: true, label: 'Enabled' },
      { value: false, label: 'Disabled' },
    ],
  },
  filters: {
    page: 1,
    pageSize: 20,
    sortBy: 'display_order' as const,
    sortOrder: 'asc' as const,
  },
  pagination: {
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  },
  loading: {
    providers: false,
    stats: false,
    providerDetail: false,
    updating: false,
    deleting: false,
    creating: false,
    toggling: false,
    reordering: false,
  },
  error: null,
  showProviderDetail: false,
  showCreateForm: false,
  showEditForm: false,
  showDeleteConfirm: false,
};

export const useSsoProvidersStore = create<SsoProvidersState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Load providers list
      loadProviders: async () => {
        const state = get();
        set(state => ({
          loading: { ...state.loading, providers: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<{
            providers: SsoProvider[];
            total: number;
            page: number;
            pageSize: number;
            totalPages: number;
          }>('sso.getSsoProviders', { filters: state.filters });

          if (result.success) {
            set(state => ({
              providers: result.data.providers,
              pagination: {
                total: result.data.total,
                page: result.data.page,
                pageSize: result.data.pageSize,
                totalPages: result.data.totalPages,
              },
              loading: { ...state.loading, providers: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load SSO providers',
              loading: { ...state.loading, providers: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load SSO providers',
            loading: { ...state.loading, providers: false },
          }));
        }
      },

      // Load statistics
      loadStats: async () => {
        set(state => ({
          loading: { ...state.loading, stats: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<SsoProviderStats>(
            'sso.getSsoProviderStats'
          );

          if (result.success) {
            set(state => ({
              stats: result.data,
              loading: { ...state.loading, stats: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load statistics',
              loading: { ...state.loading, stats: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load statistics',
            loading: { ...state.loading, stats: false },
          }));
        }
      },

      // Load provider detail
      loadProviderDetail: async (providerId: string) => {
        set(state => ({
          loading: { ...state.loading, providerDetail: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<SsoProvider | null>(
            'sso.getSsoProviderById',
            { id: providerId }
          );

          if (result.success) {
            set(state => ({
              selectedProvider: result.data,
              loading: { ...state.loading, providerDetail: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load provider details',
              loading: { ...state.loading, providerDetail: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load provider details',
            loading: { ...state.loading, providerDetail: false },
          }));
        }
      },

      // Load filter options (placeholder for future enhancement)
      loadFilterOptions: async () => {
        // Currently using static options, could be enhanced to load from API
        return Promise.resolve();
      },

      // Update filters
      updateFilters: (filters: Partial<SsoProviderFilters>) => {
        set(state => ({
          filters: { ...state.filters, ...filters },
          pagination: { ...state.pagination, page: 1 }, // Reset to first page
        }));
        // Trigger reload after filter update
        get().loadProviders();
      },

      // Set page
      setPage: (page: number) => {
        set(state => ({
          filters: { ...state.filters, page },
          pagination: { ...state.pagination, page },
        }));
        get().loadProviders();
      },

      // Set page size
      setPageSize: (pageSize: number) => {
        set(state => ({
          filters: { ...state.filters, pageSize, page: 1 },
          pagination: { ...state.pagination, pageSize, page: 1 },
        }));
        get().loadProviders();
      },

      // Select provider
      selectProvider: (provider: SsoProvider) => {
        set({ selectedProvider: provider });
      },

      // Select multiple providers
      selectProviders: (providerIds: string[]) => {
        set({ selectedProviderIds: providerIds });
      },

      // Toggle provider selection
      toggleProviderSelection: (providerId: string) => {
        set(state => ({
          selectedProviderIds: state.selectedProviderIds.includes(providerId)
            ? state.selectedProviderIds.filter(id => id !== providerId)
            : [...state.selectedProviderIds, providerId],
        }));
      },

      // Clear selection
      clearSelection: () => {
        set({ selectedProviderIds: [], selectedProvider: null });
      },

      // Add provider
      addProvider: async (data: CreateSsoProviderData) => {
        set(state => ({
          loading: { ...state.loading, creating: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<SsoProvider>(
            'sso.createSsoProvider',
            { data }
          );

          if (result.success) {
            set(state => ({
              loading: { ...state.loading, creating: false },
              showCreateForm: false,
            }));
            // Reload providers list
            await get().loadProviders();
            await get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to create SSO provider',
              loading: { ...state.loading, creating: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to create SSO provider',
            loading: { ...state.loading, creating: false },
          }));
          return false;
        }
      },

      // Edit provider
      editProvider: async (id: string, data: UpdateSsoProviderData) => {
        set(state => ({
          loading: { ...state.loading, updating: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<SsoProvider>(
            'sso.updateSsoProvider',
            { id, data }
          );

          if (result.success) {
            set(state => ({
              loading: { ...state.loading, updating: false },
              showEditForm: false,
              selectedProvider: result.data,
            }));
            // Reload providers list
            await get().loadProviders();
            await get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to update SSO provider',
              loading: { ...state.loading, updating: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to update SSO provider',
            loading: { ...state.loading, updating: false },
          }));
          return false;
        }
      },

      // Remove provider
      removeProvider: async (id: string) => {
        set(state => ({
          loading: { ...state.loading, deleting: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<void>(
            'sso.deleteSsoProvider',
            { id }
          );

          if (result.success) {
            set(state => ({
              loading: { ...state.loading, deleting: false },
              showDeleteConfirm: false,
              selectedProvider: null,
            }));
            // Reload providers list
            await get().loadProviders();
            await get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to delete SSO provider',
              loading: { ...state.loading, deleting: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to delete SSO provider',
            loading: { ...state.loading, deleting: false },
          }));
          return false;
        }
      },

      // Toggle provider status
      toggleProviderStatus: async (id: string, enabled: boolean) => {
        set(state => ({
          loading: { ...state.loading, toggling: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<SsoProvider>(
            'sso.toggleSsoProvider',
            { id, enabled }
          );

          if (result.success) {
            set(state => ({
              loading: { ...state.loading, toggling: false },
            }));
            // Reload providers list
            await get().loadProviders();
            await get().loadStats();
            return true;
          } else {
            set(state => ({
              error:
                result.error?.message || 'Failed to toggle provider status',
              loading: { ...state.loading, toggling: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to toggle provider status',
            loading: { ...state.loading, toggling: false },
          }));
          return false;
        }
      },

      // Reorder providers
      reorderProviders: async (
        updates: Array<{ id: string; display_order: number }>
      ) => {
        set(state => ({
          loading: { ...state.loading, reordering: true },
          error: null,
        }));

        try {
          const result = await callInternalDataAction<void>(
            'sso.updateSsoProviderOrder',
            { updates }
          );

          if (result.success) {
            set(state => ({
              loading: { ...state.loading, reordering: false },
            }));
            // Reload providers list
            await get().loadProviders();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to reorder providers',
              loading: { ...state.loading, reordering: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to reorder providers',
            loading: { ...state.loading, reordering: false },
          }));
          return false;
        }
      },

      // UI operations
      showCreateProviderForm: () => {
        set({ showCreateForm: true, selectedProvider: null });
      },

      showEditProviderForm: (provider: SsoProvider) => {
        set({ showEditForm: true, selectedProvider: provider });
      },

      showDeleteProviderConfirm: (provider: SsoProvider) => {
        set({ showDeleteConfirm: true, selectedProvider: provider });
      },

      showProviderDetailModal: (provider: SsoProvider) => {
        set({ showProviderDetail: true, selectedProvider: provider });
      },

      hideCreateForm: () => {
        set({ showCreateForm: false, selectedProvider: null });
      },

      hideEditForm: () => {
        set({ showEditForm: false, selectedProvider: null });
      },

      hideDeleteConfirm: () => {
        set({ showDeleteConfirm: false, selectedProvider: null });
      },

      hideProviderDetailModal: () => {
        set({ showProviderDetail: false, selectedProvider: null });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },

      // Reset store
      resetStore: () => {
        set(initialState);
      },
    }),
    {
      name: 'sso-providers-store',
    }
  )
);
