/**
 * Database query functions related to service instances.
 *
 * This file contains all database operations related to the service_instances table,
 * updated to use the unified data service and Result type.
 */
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { SubscriptionKeys } from '@lib/services/db/realtime-service';
import { Result, success } from '@lib/types/result';

import { ServiceInstance } from '../types/database';

/**
 * Get all service instances for a specific provider (optimized version)
 * @param providerId Provider ID
 * @returns Result containing a list of service instances
 */
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
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
      subscribe: true,
      subscriptionKey: SubscriptionKeys.serviceInstances(),
      onUpdate: () => {
        // Clear cache when service instances are updated
        cacheService.deletePattern('service_instances:*');
      },
    }
  );
}

/**
 * Get the default service instance for a provider (optimized version)
 * @param providerId Provider ID
 * @returns Result containing the default service instance, or null if not found
 */
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
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
    }
  );
}

/**
 * Get a service instance by its ID (optimized version)
 * @param id Service instance ID
 * @returns Result containing the service instance object, or null if not found
 */
export async function getServiceInstanceById(
  id: string
): Promise<Result<ServiceInstance | null>> {
  return dataService.findOne<ServiceInstance>(
    'service_instances',
    { id },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
    }
  );
}

/**
 * Get a service instance by provider ID and instance ID (optimized version)
 * @param providerId Provider ID
 * @param instanceId Instance ID
 * @returns Result containing the service instance object, or null if not found
 */
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
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
    }
  );
}

/**
 * Create a new service instance (optimized version)
 * @param serviceInstance Service instance object
 * @returns Result containing the created service instance object, or error if creation fails
 */
export async function createServiceInstance(
  serviceInstance: Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'>
): Promise<Result<ServiceInstance>> {
  return dataService.query(async () => {
    // If this is the default instance, set other instances to non-default first
    if (serviceInstance.is_default) {
      const resetResult = await dataService.rawExecute(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1
            AND is_default = TRUE
        `,
        [serviceInstance.provider_id]
      );
      if (!resetResult.success) {
        throw resetResult.error;
      }
    }

    // Create new instance
    const result = await dataService.create<ServiceInstance>(
      'service_instances',
      serviceInstance
    );

    if (!result.success) {
      throw result.error;
    }

    // Clear related cache
    cacheService.deletePattern('service_instances:*');

    return result.data;
  });
}

/**
 * Update a service instance (optimized version)
 * @param id Service instance ID
 * @param updates Fields to update
 * @returns Result containing the updated service instance object, or error if update fails
 */
export async function updateServiceInstance(
  id: string,
  updates: Partial<Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'>>
): Promise<Result<ServiceInstance>> {
  return dataService.query(async () => {
    // If setting as default instance, set other instances to non-default first
    if (updates.is_default) {
      const currentInstanceResult = await getServiceInstanceById(id);
      if (currentInstanceResult.success && currentInstanceResult.data) {
        const resetResult = await dataService.rawExecute(
          `
            UPDATE service_instances
            SET is_default = FALSE
            WHERE provider_id = $1
              AND is_default = TRUE
              AND id <> $2
          `,
          [currentInstanceResult.data.provider_id, id]
        );
        if (!resetResult.success) {
          throw resetResult.error;
        }
      }
    }

    // Update instance
    const result = await dataService.update<ServiceInstance>(
      'service_instances',
      id,
      updates
    );

    if (!result.success) {
      throw result.error;
    }

    // Clear related cache
    cacheService.deletePattern('service_instances:*');

    return result.data;
  });
}

/**
 * Delete a service instance (optimized version)
 * @param id Service instance ID
 * @returns Result indicating whether deletion was successful
 */
export async function deleteServiceInstance(
  id: string
): Promise<Result<boolean>> {
  const result = await dataService.delete('service_instances', id);

  if (result.success) {
    // Clear related cache
    cacheService.deletePattern('service_instances:*');
    return success(true);
  } else {
    return success(false);
  }
}

// Compatibility functions to maintain compatibility with existing code
// These functions will gradually migrate to use the Result type

/**
 * Get all service instances for a specific provider (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getServiceInstancesByProviderLegacy(
  providerId: string
): Promise<ServiceInstance[]> {
  const result = await getServiceInstancesByProvider(providerId);
  return result.success ? result.data : [];
}

/**
 * Get the default service instance (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getDefaultServiceInstanceLegacy(
  providerId: string
): Promise<ServiceInstance | null> {
  const result = await getDefaultServiceInstance(providerId);
  return result.success ? result.data : null;
}

/**
 * Get a service instance by ID (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getServiceInstanceByIdLegacy(
  id: string
): Promise<ServiceInstance | null> {
  const result = await getServiceInstanceById(id);
  return result.success ? result.data : null;
}

/**
 * Get a service instance by provider ID and instance ID (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function getServiceInstanceByInstanceIdLegacy(
  providerId: string,
  instanceId: string
): Promise<ServiceInstance | null> {
  const result = await getServiceInstanceByInstanceId(providerId, instanceId);
  return result.success ? result.data : null;
}

/**
 * Create a new service instance (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function createServiceInstanceLegacy(
  serviceInstance: Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'>
): Promise<ServiceInstance | null> {
  const result = await createServiceInstance(serviceInstance);
  return result.success ? result.data : null;
}

/**
 * Update a service instance (legacy version)
 * @deprecated Please use the new version and handle the Result type
 */
export async function updateServiceInstanceLegacy(
  id: string,
  updates: Partial<Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'>>
): Promise<ServiceInstance | null> {
  const result = await updateServiceInstance(id, updates);
  return result.success ? result.data : null;
}

/**
 * Delete a service instance (legacy version)
 * @param id Service instance ID
 * @returns Whether deletion was successful
 */
export async function deleteServiceInstanceLegacy(
  id: string
): Promise<boolean> {
  const result = await deleteServiceInstance(id);
  return result.success && result.data;
}

// New: Database operations for app parameters
// For database-first app parameter management

/**
 * Get app parameter configuration from the database
 * @param instanceId App instance ID
 * @returns Result containing the app parameter configuration, or null if not configured
 */
export async function getAppParametersFromDb(
  instanceId: string
): Promise<Result<Record<string, unknown> | null>> {
  return dataService.query(async () => {
    const result = await getServiceInstanceByInstanceId('dify', instanceId);

    if (!result.success || !result.data) {
      return null;
    }

    // Extract dify_parameters from config
    const difyParameters = result.data.config?.dify_parameters;
    return difyParameters || null;
  });
}

/**
 * Update app parameters in the database
 * @param instanceId App instance ID
 * @param parameters App parameter data
 * @returns Result of the update operation
 */
export async function updateAppParametersInDb(
  instanceId: string,
  parameters: Record<string, unknown>
): Promise<Result<void>> {
  return dataService.query(async () => {
    // Get the current service instance first
    const result = await getServiceInstanceByInstanceId('dify', instanceId);

    if (!result.success || !result.data) {
      throw new Error(`Service instance with ID ${instanceId} not found`);
    }

    // Update dify_parameters in config
    const currentConfig = result.data.config || {};
    const updatedConfig = {
      ...currentConfig,
      dify_parameters: parameters,
    };

    // Perform update
    const updateResult = await updateServiceInstance(result.data.id, {
      config: updatedConfig,
    });

    if (!updateResult.success) {
      throw updateResult.error;
    }

    return undefined;
  });
}

/**
 * Set the default service instance (ensure only one default instance per provider)
 * @param instanceId The instance ID to set as default
 * @returns Result of the operation
 */
export async function setDefaultServiceInstance(
  instanceId: string
): Promise<Result<ServiceInstance>> {
  return dataService.query(async () => {
    // Get the instance to set as default
    const instanceResult = await getServiceInstanceById(instanceId);
    if (!instanceResult.success || !instanceResult.data) {
      throw new Error('Specified service instance not found');
    }

    const instance = instanceResult.data;

    // In a transaction: set other instances of the same provider to non-default, then set this one as default
    const txResult = await dataService.runInTransaction(async client => {
      await client.query(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1
            AND is_default = TRUE
            AND id <> $2
        `,
        [instance.provider_id, instanceId]
      );

      const updateResult = await client.query<{ id: string }>(
        `
          UPDATE service_instances
          SET is_default = TRUE
          WHERE id = $1
            AND provider_id = $2
          RETURNING id
        `,
        [instanceId, instance.provider_id]
      );

      if (!updateResult.rowCount) {
        throw new Error('Failed to set default service instance');
      }
    });
    if (!txResult.success) {
      throw txResult.error;
    }

    // Clear related cache
    cacheService.deletePattern('service_instances:*');

    // Return the updated instance
    const updatedResult = await getServiceInstanceById(instanceId);
    if (!updatedResult.success) {
      throw updatedResult.error;
    }

    return updatedResult.data!;
  });
}
