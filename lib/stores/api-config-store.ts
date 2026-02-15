import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';
import type { Result } from '@lib/types/result';
import { create } from 'zustand';

export type { Provider, ServiceInstance, ApiKey } from '@lib/types/database';

interface ApiConfigState {
  providers: Provider[];
  serviceInstances: ServiceInstance[];
  apiKeys: ApiKey[];
  isLoading: boolean;
  error: Error | null;

  newApiKey: string;
  newApiUrl: string;
  isUpdating: boolean;

  createAppInstance: (
    instance: Partial<ServiceInstance>,
    apiKey?: string
  ) => Promise<ServiceInstance>;
  updateAppInstance: (
    id: string,
    instance: Partial<ServiceInstance>,
    apiKey?: string
  ) => Promise<ServiceInstance>;
  deleteAppInstance: (id: string) => Promise<void>;
  setDefaultInstance: (instanceId: string) => Promise<void>;

  loadConfigData: () => Promise<void>;
  updateDifyConfig: () => Promise<void>;
  setNewApiKey: (key: string) => void;
  setNewApiUrl: (url: string) => void;
}

function handleResult<T>(result: Result<T>, operation: string): T {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  return result.data;
}

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  providers: [],
  serviceInstances: [],
  apiKeys: [],
  isLoading: false,
  error: null,

  newApiKey: '',
  newApiUrl: '',
  isUpdating: false,

  createAppInstance: async (instance, apiKey) => {
    try {
      const newInstanceResult = await callInternalDataAction<ServiceInstance>(
        'serviceInstances.create',
        {
          serviceInstance: {
            provider_id: instance.provider_id || '1',
            display_name: instance.display_name || '',
            description: instance.description || '',
            instance_id: instance.instance_id || '',
            api_path: instance.api_path || '',
            is_default: instance.is_default || false,
            visibility: instance.visibility || 'public',
            config: instance.config || {},
          },
        }
      );

      const newInstance = handleResult(
        newInstanceResult,
        'Create service instance'
      );

      const { serviceInstances } = get();
      set({ serviceInstances: [...serviceInstances, newInstance] });

      // if apiKey is provided, encrypt and store
      if (apiKey) {
        // encrypt apiKey
        const response = await fetch('/api/admin/encrypt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ apiKey }),
        });

        if (!response.ok) {
          throw new Error('Encryption failed');
        }

        const { encryptedKey } = await response.json();

        // create api key - pass isEncrypted=true to indicate that the key has been encrypted by the API endpoint
        const newApiKeyResult = await callInternalDataAction<ApiKey>(
          'apiKeys.create',
          {
            apiKey: {
              service_instance_id: newInstance.id,
              provider_id: newInstance.provider_id,
              key_value: encryptedKey,
              is_default: true,
              usage_count: 0,
              user_id: null,
              last_used_at: null,
            },
            isEncrypted: true,
          }
        );

        const newApiKey = handleResult(newApiKeyResult, 'Create API key');

        // update local state - add new key to list
        const { apiKeys } = get();
        set({ apiKeys: [...apiKeys, newApiKey] });
      }

      return newInstance;
    } catch (error) {
      console.error('Error creating app instance:', error);
      throw error;
    }
  },

  updateAppInstance: async (id, instance, apiKey) => {
    try {
      // get existing instance information
      const existingInstanceResult =
        await callInternalDataAction<ServiceInstance | null>(
          'serviceInstances.getById',
          { id }
        );
      const existingInstance = handleResult(
        existingInstanceResult,
        'Get app instance'
      );

      if (!existingInstance) {
        throw new Error('App instance not found for update');
      }

      // correctly handle config field update
      const configToSave =
        instance.config !== undefined
          ? instance.config
          : existingInstance.config;

      // update service instance
      const updatedInstanceResult =
        await callInternalDataAction<ServiceInstance>(
          'serviceInstances.update',
          {
            id,
            updates: {
              display_name:
                instance.display_name !== undefined
                  ? instance.display_name
                  : existingInstance.display_name,
              description:
                instance.description !== undefined
                  ? instance.description
                  : existingInstance.description,
              api_path: instance.api_path || existingInstance.api_path,
              is_default:
                instance.is_default !== undefined
                  ? instance.is_default
                  : existingInstance.is_default,
              config: configToSave,
            },
          }
        );

      const updatedInstance = handleResult(
        updatedInstanceResult,
        'Update service instance'
      );

      // update local state - update corresponding item in instance list
      const { serviceInstances } = get();
      set({
        serviceInstances: serviceInstances.map(si =>
          si.id === id ? updatedInstance : si
        ),
      });

      // if apiKey is provided, encrypt and store/update
      if (apiKey) {
        // encrypt apiKey
        const response = await fetch('/api/admin/encrypt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ apiKey }),
        });

        if (!response.ok) {
          throw new Error('Encryption failed');
        }

        const { encryptedKey } = await response.json();

        // find existing api key
        const existingKeyResult = await callInternalDataAction<ApiKey | null>(
          'apiKeys.getByServiceInstance',
          { serviceInstanceId: id }
        );
        const existingKey = handleResult(existingKeyResult, 'Get API key');

        if (existingKey) {
          const updatedKeyResult = await callInternalDataAction<ApiKey>(
            'apiKeys.update',
            {
              id: existingKey.id,
              updates: { key_value: encryptedKey },
              isEncrypted: true,
            }
          );

          const updatedKey = handleResult(updatedKeyResult, 'Update API key');

          // update local state - update corresponding item in key list
          const { apiKeys } = get();
          set({
            apiKeys: apiKeys.map(k =>
              k.id === existingKey.id ? updatedKey : k
            ),
          });
        } else {
          const newKeyResult = await callInternalDataAction<ApiKey>(
            'apiKeys.create',
            {
              apiKey: {
                service_instance_id: id,
                provider_id: existingInstance.provider_id,
                key_value: encryptedKey,
                is_default: true,
                usage_count: 0,
                user_id: null,
                last_used_at: null,
              },
              isEncrypted: true,
            }
          );

          const newKey = handleResult(newKeyResult, 'Create API key');

          // update local state - add new key to list
          const { apiKeys } = get();
          set({ apiKeys: [...apiKeys, newKey] });
        }
      }

      return updatedInstance;
    } catch (error) {
      console.error('Error updating app instance:', error);
      throw error;
    }
  },

  deleteAppInstance: async id => {
    try {
      // get existing instance information
      const existingInstanceResult =
        await callInternalDataAction<ServiceInstance | null>(
          'serviceInstances.getById',
          { id }
        );
      const existingInstance = handleResult(
        existingInstanceResult,
        'Get app instance'
      );

      if (!existingInstance) {
        throw new Error('App instance not found for deletion');
      }

      // remove from favorite apps store when deleting app instance
      const instanceId = existingInstance.instance_id;

      // find and delete related api keys
      const existingKeyResult = await callInternalDataAction<ApiKey | null>(
        'apiKeys.getByServiceInstance',
        { serviceInstanceId: id }
      );
      const existingKey = handleResult(existingKeyResult, 'Get API key');

      if (existingKey) {
        const deletedResult = await callInternalDataAction<boolean>(
          'apiKeys.delete',
          { id: existingKey.id }
        );
        handleResult(deletedResult, 'Delete API key');

        // update local state - remove from key list
        const { apiKeys } = get();
        set({ apiKeys: apiKeys.filter(k => k.id !== existingKey.id) });
      }

      // delete service instance
      const deletedResult = await callInternalDataAction<boolean>(
        'serviceInstances.delete',
        { id }
      );
      handleResult(deletedResult, 'Delete service instance');

      // update local state - remove from instance list
      const { serviceInstances } = get();
      set({ serviceInstances: serviceInstances.filter(si => si.id !== id) });

      // remove from favorite apps store when deleting app instance
      try {
        const { useFavoriteAppsStore } = await import('./favorite-apps-store');
        const { removeFavoriteApp } = useFavoriteAppsStore.getState();
        removeFavoriteApp(instanceId);
        console.log(`[Delete app] Removed from favorite apps: ${instanceId}`);
      } catch (favoriteError) {
        console.warn(
          `[Delete app] Failed to remove from favorite apps: ${instanceId}`,
          favoriteError
        );
        // don't throw error, because this shouldn't block the main delete operation
      }
    } catch (error) {
      console.error('Error deleting app instance:', error);
      throw error;
    }
  },

  // set default app instance
  setDefaultInstance: async instanceId => {
    try {
      // call database function to set default instance
      const result = await callInternalDataAction<ServiceInstance>(
        'serviceInstances.setDefault',
        { instanceId }
      );
      const updatedInstance = handleResult(result, 'Set default app instance');

      // update local state - update is_default status of all related instances
      const { serviceInstances } = get();
      set({
        serviceInstances: serviceInstances.map(si => ({
          ...si,
          is_default:
            si.id === instanceId
              ? true
              : si.provider_id === updatedInstance.provider_id
                ? false
                : si.is_default,
        })),
      });
    } catch (error) {
      console.error('Error setting default app instance:', error);
      throw error;
    }
  },

  setNewApiKey: key => set({ newApiKey: key }),
  setNewApiUrl: url => set({ newApiUrl: url }),

  loadConfigData: async () => {
    try {
      set({ isLoading: true, error: null });

      console.time('[API Config] Total loading time');

      // use database function to get all providers
      console.time('[API Config] Get providers');
      const providersResult = await callInternalDataAction<Provider[]>(
        'providers.getActiveProviders'
      );
      const providers = handleResult(providersResult, 'Get active providers');
      console.timeEnd('[API Config] Get providers');

      // get service instances in parallel
      console.time('[API Config] Get service instances in parallel');
      const instancePromises = providers.map(provider =>
        callInternalDataAction<ServiceInstance[]>(
          'serviceInstances.getByProvider',
          { providerId: provider.id }
        )
          .then(result => ({
            provider,
            result,
            instances: result.success ? result.data : [],
          }))
          .catch(error => {
            console.warn(
              `Failed to get service instances for provider ${provider.name}:`,
              error
            );
            return {
              provider,
              result: { success: false, error },
              instances: [],
            };
          })
      );

      const instanceResults = await Promise.all(instancePromises);
      console.timeEnd('[API Config] Get service instances in parallel');

      // merge all service instances and handle errors
      const serviceInstances: ServiceInstance[] = [];
      for (const { provider, result, instances } of instanceResults) {
        if (result.success) {
          serviceInstances.push(...instances);
        } else {
          console.error(
            `Failed to get service instances for provider ${provider.name}:`,
            result.error
          );
        }
      }

      // sort by display name
      const sortedServiceInstances = serviceInstances.sort((a, b) =>
        (a.display_name || a.instance_id).localeCompare(
          b.display_name || b.instance_id
        )
      );

      console.time('[API Config] Get api keys in parallel');
      const keyPromises = sortedServiceInstances.map(instance =>
        callInternalDataAction<ApiKey | null>('apiKeys.getByServiceInstance', {
          serviceInstanceId: instance.id,
        })
          .then(result => ({
            instance,
            result,
            apiKey: result.success ? result.data : null,
          }))
          .catch(error => {
            console.warn(
              `Failed to get API key for service instance ${instance.display_name || instance.instance_id}:`,
              error
            );
            return {
              instance,
              result: { success: false, error },
              apiKey: null,
            };
          })
      );

      const keyResults = await Promise.all(keyPromises);
      console.timeEnd('[API Config] Get api keys in parallel');

      // filter valid api keys and handle errors
      const apiKeys: ApiKey[] = [];
      for (const { instance, result, apiKey } of keyResults) {
        if (result.success && apiKey) {
          apiKeys.push(apiKey);
        } else if (!result.success) {
          console.error(
            `Failed to get API key for service instance ${instance.display_name || instance.instance_id}:`,
            result.error
          );
        }
        // if result.success is true but apiKey is null, it means the instance has no api key configured, which is normal
      }

      console.timeEnd('[API Config] Total loading time');
      console.log(
        `[API Config] Loaded - providers: ${providers.length}, service instances: ${sortedServiceInstances.length}, api keys: ${apiKeys.length}`
      );

      // update state
      set({
        providers,
        serviceInstances: sortedServiceInstances,
        apiKeys,
        isLoading: false,
        error: null,
      });

      // set default Dify URL
      const difyProvider = providers.find(p => p.name === 'Dify');
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
      // find Dify provider
      let difyProvider = providers.find(p => p.name === 'Dify');

      // if not exists, create one
      if (!difyProvider && newApiUrl) {
        const newProviderResult = await callInternalDataAction<Provider>(
          'providers.createProvider',
          {
            provider: {
              name: 'Dify',
              type: 'llm',
              base_url: newApiUrl,
              auth_type: 'api_key',
              is_active: true,
              is_default: false,
            },
          }
        );

        const newProvider = handleResult(
          newProviderResult,
          'Create Dify provider'
        );
        difyProvider = newProvider;

        // update provider list
        set({ providers: [...providers, newProvider] });
      } else if (
        difyProvider &&
        newApiUrl &&
        difyProvider.base_url !== newApiUrl
      ) {
        // update URL
        const updatedProviderResult = await callInternalDataAction<Provider>(
          'providers.updateProvider',
          {
            id: difyProvider.id,
            updates: { base_url: newApiUrl },
          }
        );

        handleResult(updatedProviderResult, 'Update Dify provider');

        // update local state
        set({
          providers: providers.map(p =>
            p.id === difyProvider?.id ? { ...p, base_url: newApiUrl } : p
          ),
        });
      }

      // if there is a new API key
      if (newApiKey && difyProvider) {
        // find default service instance
        let defaultInstance = serviceInstances.find(
          si => si.provider_id === difyProvider?.id && si.is_default
        );

        // if not exists, create one
        if (!defaultInstance) {
          const newInstanceResult =
            await callInternalDataAction<ServiceInstance>(
              'serviceInstances.create',
              {
                serviceInstance: {
                  provider_id: difyProvider.id,
                  display_name: 'Default Dify Application',
                  description: 'Default Dify application instance',
                  instance_id: 'default',
                  api_path: '',
                  is_default: true,
                  visibility: 'public',
                  config: {},
                },
              }
            );

          const newInstance = handleResult(
            newInstanceResult,
            'Create default service instance'
          );
          defaultInstance = newInstance;

          // update service instance list
          set({ serviceInstances: [...serviceInstances, newInstance] });
        }

        // encrypt API key
        const response = await fetch('/api/admin/encrypt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ apiKey: newApiKey }),
        });

        if (!response.ok) {
          throw new Error('Encryption failed');
        }

        const { encryptedKey } = await response.json();

        // find default API key
        const defaultKey = apiKeys.find(
          k => k.service_instance_id === defaultInstance?.id && k.is_default
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

          // update local state
          set({
            apiKeys: apiKeys.map(k =>
              k.id === defaultKey.id ? { ...k, key_value: encryptedKey } : k
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

          // update API key list
          set({ apiKeys: [...apiKeys, newKey] });
        }
      }

      // clear input
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
}));
