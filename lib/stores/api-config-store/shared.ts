import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';

import { sortServiceInstances } from './helpers';

export async function encryptApiKey(apiKey: string) {
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
  return encryptedKey as string;
}

export async function loadInstancesByProviders(providers: Provider[]) {
  console.time('[API Config] Get service instances in parallel');
  const instancePromises = providers.map(provider =>
    callInternalDataAction<ServiceInstance[]>(
      'serviceInstances.getByProvider',
      {
        providerId: provider.id,
      }
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
          result: { success: false as const, error },
          instances: [] as ServiceInstance[],
        };
      })
  );

  const instanceResults = await Promise.all(instancePromises);
  console.timeEnd('[API Config] Get service instances in parallel');

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

  return sortServiceInstances(serviceInstances);
}

export async function loadApiKeysByInstances(
  serviceInstances: ServiceInstance[]
) {
  console.time('[API Config] Get api keys in parallel');
  const keyPromises = serviceInstances.map(instance =>
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
          result: { success: false as const, error },
          apiKey: null as ApiKey | null,
        };
      })
  );

  const keyResults = await Promise.all(keyPromises);
  console.timeEnd('[API Config] Get api keys in parallel');

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
  }

  return apiKeys;
}
