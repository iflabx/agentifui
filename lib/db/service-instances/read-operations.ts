import type { Result } from '@lib/types/result';

import type { ServiceInstance } from '../../types/database';
import { SubscriptionKeys, cacheService, dataService } from './shared';

export async function getServiceInstancesByProvider(
  providerId: string
): Promise<Result<ServiceInstance[]>> {
  return dataService.findMany<ServiceInstance>(
    'service_instances',
    { provider_id: providerId },
    { column: 'display_name', ascending: true },
    undefined,
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000,
      subscribe: true,
      subscriptionKey: SubscriptionKeys.serviceInstances(),
      onUpdate: () => {
        cacheService.deletePattern('service_instances:*');
      },
    }
  );
}

export async function getDefaultServiceInstance(
  providerId: string
): Promise<Result<ServiceInstance | null>> {
  return dataService.findOne<ServiceInstance>(
    'service_instances',
    {
      provider_id: providerId,
      is_default: true,
    },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000,
    }
  );
}

export async function getServiceInstanceById(
  id: string
): Promise<Result<ServiceInstance | null>> {
  return dataService.findOne<ServiceInstance>(
    'service_instances',
    { id },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000,
    }
  );
}

export async function getServiceInstanceByInstanceId(
  providerId: string,
  instanceId: string
): Promise<Result<ServiceInstance | null>> {
  return dataService.findOne<ServiceInstance>(
    'service_instances',
    {
      provider_id: providerId,
      instance_id: instanceId,
    },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000,
    }
  );
}

export async function getAppParametersFromDb(
  instanceId: string
): Promise<Result<Record<string, unknown> | null>> {
  return dataService.query(async () => {
    const result = await getServiceInstanceByInstanceId('dify', instanceId);

    if (!result.success || !result.data) {
      return null;
    }

    return result.data.config?.dify_parameters || null;
  });
}
