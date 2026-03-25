import { callInternalDataAction } from '@lib/db/internal-data-api';

import {
  buildPaginationState,
  getErrorMessage,
  updateLoadingState,
} from './helpers';
import type {
  ProvidersListPayload,
  SsoProvider,
  SsoProviderStats,
  SsoProvidersStoreGet,
  SsoProvidersStoreSet,
} from './types';

export function createLoadActions(
  set: SsoProvidersStoreSet,
  get: SsoProvidersStoreGet
) {
  return {
    loadProviders: async () => {
      const state = get();
      set(currentState => ({
        loading: updateLoadingState(currentState.loading, 'providers', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<ProvidersListPayload>(
          'sso.getSsoProviders',
          { filters: state.filters }
        );

        if (result.success) {
          set(currentState => ({
            providers: result.data.providers,
            pagination: buildPaginationState(result.data),
            loading: updateLoadingState(
              currentState.loading,
              'providers',
              false
            ),
          }));
          return;
        }

        set(currentState => ({
          error: result.error?.message || 'Failed to load SSO providers',
          loading: updateLoadingState(currentState.loading, 'providers', false),
        }));
      } catch (error) {
        set(currentState => ({
          error: getErrorMessage(error, 'Failed to load SSO providers'),
          loading: updateLoadingState(currentState.loading, 'providers', false),
        }));
      }
    },

    loadStats: async () => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'stats', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<SsoProviderStats>(
          'sso.getSsoProviderStats'
        );

        if (result.success) {
          set(state => ({
            stats: result.data,
            loading: updateLoadingState(state.loading, 'stats', false),
          }));
          return;
        }

        set(state => ({
          error: result.error?.message || 'Failed to load statistics',
          loading: updateLoadingState(state.loading, 'stats', false),
        }));
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to load statistics'),
          loading: updateLoadingState(state.loading, 'stats', false),
        }));
      }
    },

    loadProviderDetail: async (providerId: string) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'providerDetail', true),
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
            loading: updateLoadingState(state.loading, 'providerDetail', false),
          }));
          return;
        }

        set(state => ({
          error: result.error?.message || 'Failed to load provider details',
          loading: updateLoadingState(state.loading, 'providerDetail', false),
        }));
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to load provider details'),
          loading: updateLoadingState(state.loading, 'providerDetail', false),
        }));
      }
    },

    loadFilterOptions: async () => Promise.resolve(),
  };
}
