import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';

import {
  appendApiKey,
  buildDefaultDifyInstance,
  buildDefaultDifyProvider,
  handleResult,
} from './helpers';
import {
  encryptApiKey,
  loadApiKeysByInstances,
  loadInstancesByProviders,
} from './shared';
import type { ApiConfigStoreGet, ApiConfigStoreSet } from './types';

export function createConfigActions(
  set: ApiConfigStoreSet,
  get: ApiConfigStoreGet
) {
  return {
    loadConfigData: async () => {
      try {
        set({ isLoading: true, error: null });

        console.time('[API Config] Total loading time');
        console.time('[API Config] Get providers');
        const providersResult = await callInternalDataAction<Provider[]>(
          'providers.getActiveProviders'
        );
        const providers = handleResult(providersResult, 'Get active providers');
        console.timeEnd('[API Config] Get providers');

        const serviceInstances = await loadInstancesByProviders(providers);
        const apiKeys = await loadApiKeysByInstances(serviceInstances);

        console.timeEnd('[API Config] Total loading time');
        console.log(
          `[API Config] Loaded - providers: ${providers.length}, service instances: ${serviceInstances.length}, api keys: ${apiKeys.length}`
        );

        set({
          providers,
          serviceInstances,
          apiKeys,
          isLoading: false,
          error: null,
        });

        const difyProvider = providers.find(
          provider => provider.name === 'Dify'
        );
        if (difyProvider) {
          set({ newApiUrl: difyProvider.base_url });
        }
      } catch (error) {
        console.error('Error loading config data:', error);
        set({
          error:
            error instanceof Error
              ? error
              : new Error('Error loading config data'),
          isLoading: false,
        });
      }
    },

    updateDifyConfig: async () => {
      const { newApiKey, newApiUrl, providers, serviceInstances, apiKeys } =
        get();

      if (!newApiKey && !newApiUrl) {
        set({
          error: new Error('Please provide at least one of API key or URL'),
        });
        return;
      }

      set({ isUpdating: true, error: null });

      try {
        let difyProvider = providers.find(provider => provider.name === 'Dify');

        if (!difyProvider && newApiUrl) {
          const newProviderResult = await callInternalDataAction<Provider>(
            'providers.createProvider',
            {
              provider: buildDefaultDifyProvider(newApiUrl),
            }
          );

          const newProvider = handleResult(
            newProviderResult,
            'Create Dify provider'
          );
          difyProvider = newProvider;
          set({ providers: [...providers, newProvider] });
        } else if (
          difyProvider &&
          newApiUrl &&
          difyProvider.base_url !== newApiUrl
        ) {
          const updatedProviderResult = await callInternalDataAction<Provider>(
            'providers.updateProvider',
            {
              id: difyProvider.id,
              updates: { base_url: newApiUrl },
            }
          );

          handleResult(updatedProviderResult, 'Update Dify provider');
          set({
            providers: providers.map(provider =>
              provider.id === difyProvider?.id
                ? { ...provider, base_url: newApiUrl }
                : provider
            ),
          });
        }

        if (newApiKey && difyProvider) {
          let defaultInstance = serviceInstances.find(
            instance =>
              instance.provider_id === difyProvider?.id && instance.is_default
          );

          if (!defaultInstance) {
            const newInstanceResult =
              await callInternalDataAction<ServiceInstance>(
                'serviceInstances.create',
                {
                  serviceInstance: buildDefaultDifyInstance(difyProvider.id),
                }
              );

            const newInstance = handleResult(
              newInstanceResult,
              'Create default service instance'
            );
            defaultInstance = newInstance;
            set({ serviceInstances: [...serviceInstances, newInstance] });
          }

          const encryptedKey = await encryptApiKey(newApiKey);
          const defaultKey = apiKeys.find(
            key =>
              key.service_instance_id === defaultInstance?.id && key.is_default
          );

          if (defaultKey) {
            const updatedKeyResult = await callInternalDataAction<ApiKey>(
              'apiKeys.update',
              {
                id: defaultKey.id,
                updates: { key_value: encryptedKey },
                isEncrypted: true,
              }
            );

            handleResult(updatedKeyResult, 'Update default API key');
            set({
              apiKeys: apiKeys.map(key =>
                key.id === defaultKey.id
                  ? { ...key, key_value: encryptedKey }
                  : key
              ),
            });
          } else if (defaultInstance) {
            const newKeyResult = await callInternalDataAction<ApiKey>(
              'apiKeys.create',
              {
                apiKey: {
                  service_instance_id: defaultInstance.id,
                  provider_id: difyProvider.id,
                  key_value: encryptedKey,
                  is_default: true,
                  usage_count: 0,
                  user_id: null,
                  last_used_at: null,
                },
                isEncrypted: true,
              }
            );

            const newKey = handleResult(newKeyResult, 'Create default API key');
            set({ apiKeys: appendApiKey(apiKeys, newKey) });
          }
        }

        set({ newApiKey: '', isUpdating: false });
      } catch (error) {
        console.error('Error updating Dify config:', error);
        set({
          error:
            error instanceof Error
              ? error
              : new Error('Error updating Dify config'),
          isUpdating: false,
        });
      }
    },
  };
}
