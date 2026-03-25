import { callInternalDataAction } from '@lib/db/internal-data-api';

import { getErrorMessage, updateLoadingState } from './helpers';
import type {
  CreateSsoProviderData,
  SsoProvider,
  SsoProvidersStoreGet,
  SsoProvidersStoreSet,
  UpdateSsoProviderData,
} from './types';

export function createMutationActions(
  set: SsoProvidersStoreSet,
  get: SsoProvidersStoreGet
) {
  return {
    addProvider: async (data: CreateSsoProviderData) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'creating', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<SsoProvider>(
          'sso.createSsoProvider',
          { data }
        );

        if (result.success) {
          set(state => ({
            loading: updateLoadingState(state.loading, 'creating', false),
            showCreateForm: false,
          }));
          await get().loadProviders();
          await get().loadStats();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to create SSO provider',
          loading: updateLoadingState(state.loading, 'creating', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to create SSO provider'),
          loading: updateLoadingState(state.loading, 'creating', false),
        }));
        return false;
      }
    },

    editProvider: async (id: string, data: UpdateSsoProviderData) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'updating', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<SsoProvider>(
          'sso.updateSsoProvider',
          { id, data }
        );

        if (result.success) {
          set(state => ({
            loading: updateLoadingState(state.loading, 'updating', false),
            showEditForm: false,
            selectedProvider: result.data,
          }));
          await get().loadProviders();
          await get().loadStats();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to update SSO provider',
          loading: updateLoadingState(state.loading, 'updating', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to update SSO provider'),
          loading: updateLoadingState(state.loading, 'updating', false),
        }));
        return false;
      }
    },

    removeProvider: async (id: string) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'deleting', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>(
          'sso.deleteSsoProvider',
          {
            id,
          }
        );

        if (result.success) {
          set(state => ({
            loading: updateLoadingState(state.loading, 'deleting', false),
            showDeleteConfirm: false,
            selectedProvider: null,
          }));
          await get().loadProviders();
          await get().loadStats();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to delete SSO provider',
          loading: updateLoadingState(state.loading, 'deleting', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to delete SSO provider'),
          loading: updateLoadingState(state.loading, 'deleting', false),
        }));
        return false;
      }
    },

    toggleProviderStatus: async (id: string, enabled: boolean) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'toggling', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<SsoProvider>(
          'sso.toggleSsoProvider',
          { id, enabled }
        );

        if (result.success) {
          set(state => ({
            loading: updateLoadingState(state.loading, 'toggling', false),
          }));
          await get().loadProviders();
          await get().loadStats();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to toggle provider status',
          loading: updateLoadingState(state.loading, 'toggling', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to toggle provider status'),
          loading: updateLoadingState(state.loading, 'toggling', false),
        }));
        return false;
      }
    },

    reorderProviders: async (
      updates: Array<{ id: string; display_order: number }>
    ) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'reordering', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>(
          'sso.updateSsoProviderOrder',
          { updates }
        );

        if (result.success) {
          set(state => ({
            loading: updateLoadingState(state.loading, 'reordering', false),
          }));
          await get().loadProviders();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to reorder providers',
          loading: updateLoadingState(state.loading, 'reordering', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to reorder providers'),
          loading: updateLoadingState(state.loading, 'reordering', false),
        }));
        return false;
      }
    },
  };
}
