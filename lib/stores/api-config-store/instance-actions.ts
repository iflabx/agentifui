import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { ApiKey, ServiceInstance } from '@lib/types/database';

import {
  appendApiKey,
  buildServiceInstancePayload,
  handleResult,
} from './helpers';
import { encryptApiKey } from './shared';
import type { ApiConfigStoreGet, ApiConfigStoreSet } from './types';

export function createInstanceActions(
  set: ApiConfigStoreSet,
  get: ApiConfigStoreGet
) {
  return {
    createAppInstance: async (
      instance: Partial<ServiceInstance>,
      apiKey?: string
    ) => {
      try {
        const newInstanceResult = await callInternalDataAction<ServiceInstance>(
          'serviceInstances.create',
          {
            serviceInstance: buildServiceInstancePayload(instance),
          }
        );

        const newInstance = handleResult(
          newInstanceResult,
          'Create service instance'
        );

        const { serviceInstances } = get();
        set({ serviceInstances: [...serviceInstances, newInstance] });

        if (apiKey) {
          const encryptedKey = await encryptApiKey(apiKey);
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
          const { apiKeys } = get();
          set({ apiKeys: appendApiKey(apiKeys, newApiKey) });
        }

        return newInstance;
      } catch (error) {
        console.error('Error creating app instance:', error);
        throw error;
      }
    },

    updateAppInstance: async (
      id: string,
      instance: Partial<ServiceInstance>,
      apiKey?: string
    ) => {
      try {
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

        const configToSave =
          instance.config !== undefined
            ? instance.config
            : existingInstance.config;

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

        const { serviceInstances } = get();
        set({
          serviceInstances: serviceInstances.map(si =>
            si.id === id ? updatedInstance : si
          ),
        });

        if (apiKey) {
          const encryptedKey = await encryptApiKey(apiKey);
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
            const { apiKeys } = get();
            set({
              apiKeys: apiKeys.map(key =>
                key.id === existingKey.id ? updatedKey : key
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
            const { apiKeys } = get();
            set({ apiKeys: appendApiKey(apiKeys, newKey) });
          }
        }

        return updatedInstance;
      } catch (error) {
        console.error('Error updating app instance:', error);
        throw error;
      }
    },

    deleteAppInstance: async (id: string) => {
      try {
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

        const instanceId = existingInstance.instance_id;

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

          const { apiKeys } = get();
          set({ apiKeys: apiKeys.filter(key => key.id !== existingKey.id) });
        }

        const deletedResult = await callInternalDataAction<boolean>(
          'serviceInstances.delete',
          { id }
        );
        handleResult(deletedResult, 'Delete service instance');

        const { serviceInstances } = get();
        set({
          serviceInstances: serviceInstances.filter(
            instance => instance.id !== id
          ),
        });

        try {
          const { useFavoriteAppsStore } = await import(
            '../favorite-apps-store'
          );
          const { removeFavoriteApp } = useFavoriteAppsStore.getState();
          removeFavoriteApp(instanceId);
          console.log(`[Delete app] Removed from favorite apps: ${instanceId}`);
        } catch (favoriteError) {
          console.warn(
            `[Delete app] Failed to remove from favorite apps: ${instanceId}`,
            favoriteError
          );
        }
      } catch (error) {
        console.error('Error deleting app instance:', error);
        throw error;
      }
    },

    setDefaultInstance: async (instanceId: string) => {
      try {
        const result = await callInternalDataAction<ServiceInstance>(
          'serviceInstances.setDefault',
          { instanceId }
        );
        const updatedInstance = handleResult(
          result,
          'Set default app instance'
        );

        const { serviceInstances } = get();
        set({
          serviceInstances: serviceInstances.map(instance => ({
            ...instance,
            is_default:
              instance.id === instanceId
                ? true
                : instance.provider_id === updatedInstance.provider_id
                  ? false
                  : instance.is_default,
          })),
        });
      } catch (error) {
        console.error('Error setting default app instance:', error);
        throw error;
      }
    },
  };
}
