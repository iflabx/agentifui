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

const IS_BROWSER = typeof window !== 'undefined';
const SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SERVICE_INSTANCE_UPDATE_COLUMNS = new Set([
  'provider_id',
  'display_name',
  'description',
  'instance_id',
  'api_path',
  'is_default',
  'visibility',
  'config',
]);

type RealtimeRow = Record<string, unknown>;
type QueryClient = {
  query: <T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{
    rows: T[];
    rowCount?: number | null;
  }>;
};

async function lockProviderRow(
  client: QueryClient,
  providerId: string
): Promise<void> {
  await client.query(
    `
      SELECT id::text AS id
      FROM providers
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [providerId]
  );
}

async function ensureProviderDefaultInstance(
  client: QueryClient,
  providerId: string,
  options: {
    preferredId?: string | null;
    excludeId?: string | null;
  } = {}
): Promise<string | null> {
  const existingDefaultResult = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM service_instances
      WHERE provider_id = $1::uuid
        AND is_default = TRUE
      LIMIT 1
    `,
    [providerId]
  );
  const existingDefaultId = existingDefaultResult.rows[0]?.id || null;
  if (existingDefaultId) {
    return existingDefaultId;
  }

  const preferredId = options.preferredId?.trim() || '';
  const excludeId = options.excludeId?.trim() || '';

  let targetId: string | null = null;
  if (preferredId && preferredId !== excludeId) {
    const preferredResult = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM service_instances
        WHERE provider_id = $1::uuid
          AND id = $2::uuid
        LIMIT 1
      `,
      [providerId, preferredId]
    );
    targetId = preferredResult.rows[0]?.id || null;
  }

  if (!targetId) {
    const fallbackResult = excludeId
      ? await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM service_instances
            WHERE provider_id = $1::uuid
              AND id <> $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId, excludeId]
        )
      : await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM service_instances
            WHERE provider_id = $1::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId]
        );
    targetId = fallbackResult.rows[0]?.id || null;
  }

  if (!targetId && excludeId) {
    const forceFallbackResult = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM service_instances
        WHERE provider_id = $1::uuid
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [providerId]
    );
    targetId = forceFallbackResult.rows[0]?.id || null;
  }

  if (!targetId) {
    return null;
  }

  await client.query(
    `
      UPDATE service_instances
      SET is_default = TRUE,
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [targetId]
  );

  return targetId;
}

async function publishServiceInstanceChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}) {
  if (IS_BROWSER) {
    return;
  }

  try {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const publisherModule = runtimeRequire('../server/realtime/publisher') as {
      publishTableChangeEvent?: (payload: {
        table: string;
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        newRow: RealtimeRow | null;
        oldRow: RealtimeRow | null;
      }) => Promise<void>;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher({
      table: 'service_instances',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[ServiceInstancesDB] Realtime publish failed:', error);
  }
}

function normalizeServiceInstanceRow(
  row: Record<string, unknown>
): ServiceInstance {
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;

  return {
    id: String(row.id),
    provider_id: String(row.provider_id),
    display_name:
      row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    instance_id: String(row.instance_id),
    api_path: String(row.api_path ?? ''),
    is_default: Boolean(row.is_default),
    visibility: String(row.visibility) as ServiceInstance['visibility'],
    config: (row.config as ServiceInstance['config']) || {},
    created_at:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    updated_at:
      updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
  };
}

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
  const transactionResult = await dataService.runInTransaction<ServiceInstance>(
    async client => {
      await lockProviderRow(
        client as unknown as QueryClient,
        serviceInstance.provider_id
      );

      if (serviceInstance.is_default) {
        await client.query(
          `
            UPDATE service_instances
            SET is_default = FALSE
            WHERE provider_id = $1::uuid
              AND is_default = TRUE
          `,
          [serviceInstance.provider_id]
        );
      }

      const insertResult = await client.query<Record<string, unknown>>(
        `
          INSERT INTO service_instances (
            provider_id,
            instance_id,
            api_path,
            display_name,
            description,
            is_default,
            visibility,
            config
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb)
          RETURNING *
        `,
        [
          serviceInstance.provider_id,
          serviceInstance.instance_id,
          serviceInstance.api_path ?? '',
          serviceInstance.display_name ?? null,
          serviceInstance.description ?? null,
          Boolean(serviceInstance.is_default),
          serviceInstance.visibility,
          JSON.stringify(serviceInstance.config || {}),
        ]
      );

      const created = insertResult.rows[0];
      if (!created) {
        throw new Error('Failed to create service instance');
      }

      await ensureProviderDefaultInstance(
        client as unknown as QueryClient,
        serviceInstance.provider_id,
        {
          preferredId: String(created.id),
        }
      );

      const refreshedResult = await client.query<Record<string, unknown>>(
        `
          SELECT *
          FROM service_instances
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [String(created.id)]
      );
      const refreshed = refreshedResult.rows[0];
      if (!refreshed) {
        throw new Error('Failed to load created service instance');
      }

      return normalizeServiceInstanceRow(refreshed);
    }
  );

  if (!transactionResult.success) {
    return transactionResult;
  }

  cacheService.deletePattern('service_instances:*');
  await publishServiceInstanceChangeBestEffort({
    eventType: 'INSERT',
    oldRow: null,
    newRow: transactionResult.data as unknown as RealtimeRow,
  });
  return success(transactionResult.data);
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
  const oldInstanceResult = await getServiceInstanceById(id);
  const oldInstance =
    oldInstanceResult.success && oldInstanceResult.data
      ? oldInstanceResult.data
      : null;

  const updateKeys = Object.keys(updates).filter(
    key => (updates as Record<string, unknown>)[key] !== undefined
  );
  if (updateKeys.length === 0) {
    return dataService.update<ServiceInstance>(
      'service_instances',
      id,
      updates
    );
  }

  const keys = updateKeys.filter(
    key => SQL_IDENTIFIER.test(key) && SERVICE_INSTANCE_UPDATE_COLUMNS.has(key)
  );
  if (keys.length !== updateKeys.length) {
    return dataService.update<ServiceInstance>(
      'service_instances',
      id,
      updates
    );
  }

  const transactionResult = await dataService.runInTransaction<ServiceInstance>(
    async client => {
      const currentInstanceResult = await client.query<{
        provider_id: string;
      }>(
        `
          SELECT provider_id::text
          FROM service_instances
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [id]
      );
      const currentInstance = currentInstanceResult.rows[0];
      if (!currentInstance?.provider_id) {
        throw new Error(`Service instance not found: ${id}`);
      }

      await lockProviderRow(
        client as unknown as QueryClient,
        currentInstance.provider_id
      );

      if (updates.is_default) {
        await client.query(
          `
            UPDATE service_instances
            SET is_default = FALSE
            WHERE provider_id = $1::uuid
              AND is_default = TRUE
              AND id <> $2::uuid
          `,
          [currentInstance.provider_id, id]
        );
      }

      const setClauses: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      for (const key of keys) {
        const isJsonColumn = key === 'config';
        setClauses.push(`${key} = $${index}${isJsonColumn ? '::jsonb' : ''}`);
        const rawValue = (updates as Record<string, unknown>)[key];
        if (key === 'config') {
          values.push(JSON.stringify(rawValue || {}));
        } else {
          values.push(rawValue);
        }
        index += 1;
      }

      const updateResult = await client.query<Record<string, unknown>>(
        `
          UPDATE service_instances
          SET ${setClauses.join(', ')}
          WHERE id = $${index}::uuid
          RETURNING *
        `,
        [...values, id]
      );

      const updated = updateResult.rows[0];
      if (!updated) {
        throw new Error(`Service instance not found: ${id}`);
      }

      await ensureProviderDefaultInstance(
        client as unknown as QueryClient,
        currentInstance.provider_id,
        {
          preferredId: updates.is_default === true ? String(updated.id) : null,
          excludeId: updates.is_default === false ? String(updated.id) : null,
        }
      );

      const refreshedResult = await client.query<Record<string, unknown>>(
        `
          SELECT *
          FROM service_instances
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [String(updated.id)]
      );
      const refreshed = refreshedResult.rows[0];
      if (!refreshed) {
        throw new Error(`Service instance not found after update: ${id}`);
      }

      return normalizeServiceInstanceRow(refreshed);
    }
  );

  if (!transactionResult.success) {
    return transactionResult;
  }

  cacheService.deletePattern('service_instances:*');
  await publishServiceInstanceChangeBestEffort({
    eventType: 'UPDATE',
    oldRow: oldInstance as unknown as RealtimeRow | null,
    newRow: transactionResult.data as unknown as RealtimeRow,
  });
  return success(transactionResult.data);
}

/**
 * Delete a service instance (optimized version)
 * @param id Service instance ID
 * @returns Result indicating whether deletion was successful
 */
export async function deleteServiceInstance(
  id: string
): Promise<Result<boolean>> {
  const oldInstanceResult = await getServiceInstanceById(id);
  const oldInstance =
    oldInstanceResult.success && oldInstanceResult.data
      ? oldInstanceResult.data
      : null;

  const transactionResult = await dataService.runInTransaction<boolean>(
    async client => {
      const targetResult = await client.query<{
        id: string;
        provider_id: string;
        is_default: boolean;
      }>(
        `
          SELECT
            id::text AS id,
            provider_id::text AS provider_id,
            is_default
          FROM service_instances
          WHERE id = $1::uuid
          LIMIT 1
          FOR UPDATE
        `,
        [id]
      );
      const target = targetResult.rows[0];
      if (!target?.id || !target.provider_id) {
        return false;
      }

      await lockProviderRow(
        client as unknown as QueryClient,
        target.provider_id
      );

      const deleteResult = await client.query<{ id: string }>(
        `
          DELETE FROM service_instances
          WHERE id = $1::uuid
          RETURNING id::text AS id
        `,
        [id]
      );
      if (!deleteResult.rows[0]?.id) {
        return false;
      }

      await ensureProviderDefaultInstance(
        client as unknown as QueryClient,
        target.provider_id
      );

      return true;
    }
  );

  if (!transactionResult.success) {
    return transactionResult;
  }

  if (!transactionResult.data) {
    return success(false);
  }

  cacheService.deletePattern('service_instances:*');
  await publishServiceInstanceChangeBestEffort({
    eventType: 'DELETE',
    oldRow: oldInstance as unknown as RealtimeRow | null,
    newRow: null,
  });

  return success(true);
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

    await publishServiceInstanceChangeBestEffort({
      eventType: 'UPDATE',
      oldRow: instance as unknown as RealtimeRow,
      newRow: updatedResult.data as unknown as RealtimeRow | null,
    });

    return updatedResult.data!;
  });
}
