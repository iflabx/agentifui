import { toggleSelectedProviderIds } from './helpers';
import { initialState } from './state';
import type {
  SsoProvider,
  SsoProviderFilters,
  SsoProvidersStoreGet,
  SsoProvidersStoreSet,
} from './types';

export function createUiActions(
  set: SsoProvidersStoreSet,
  get: SsoProvidersStoreGet
) {
  return {
    updateFilters: (filters: Partial<SsoProviderFilters>) => {
      set(state => ({
        filters: { ...state.filters, ...filters },
        pagination: { ...state.pagination, page: 1 },
      }));
      void get().loadProviders();
    },

    setPage: (page: number) => {
      set(state => ({
        filters: { ...state.filters, page },
        pagination: { ...state.pagination, page },
      }));
      void get().loadProviders();
    },

    setPageSize: (pageSize: number) => {
      set(state => ({
        filters: { ...state.filters, pageSize, page: 1 },
        pagination: { ...state.pagination, pageSize, page: 1 },
      }));
      void get().loadProviders();
    },

    selectProvider: (provider: SsoProvider) => {
      set({ selectedProvider: provider });
    },

    selectProviders: (providerIds: string[]) => {
      set({ selectedProviderIds: providerIds });
    },

    toggleProviderSelection: (providerId: string) => {
      set(state => ({
        selectedProviderIds: toggleSelectedProviderIds(
          state.selectedProviderIds,
          providerId
        ),
      }));
    },

    clearSelection: () => {
      set({ selectedProviderIds: [], selectedProvider: null });
    },

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

    clearError: () => {
      set({ error: null });
    },

    resetStore: () => {
      set(initialState);
    },
  };
}
