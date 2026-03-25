import { type Result, success } from '@lib/types/result';

import type { ServiceInstance } from '../../types/database';
import {
  buildServiceInstanceSetClause,
  getValidServiceInstanceUpdateKeys,
  normalizeServiceInstanceRow,
} from './helpers';
import {
  getServiceInstanceById,
  getServiceInstanceByInstanceId,
} from './read-operations';
import {
  cacheService,
  dataService,
  ensureProviderDefaultInstance,
  lockProviderRow,
  publishServiceInstanceChangeBestEffort,
} from './shared';
import type {
  QueryClient,
  RealtimeRow,
  ServiceInstanceUpdateInput,
} from './types';

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

export async function updateServiceInstance(
  id: string,
  updates: ServiceInstanceUpdateInput
): Promise<Result<ServiceInstance>> {
  const oldInstanceResult = await getServiceInstanceById(id);
  const oldInstance =
    oldInstanceResult.success && oldInstanceResult.data
      ? oldInstanceResult.data
      : null;

  const { updateKeys, validKeys } = getValidServiceInstanceUpdateKeys(updates);
  if (updateKeys.length === 0) {
    return dataService.update<ServiceInstance>(
      'service_instances',
      id,
      updates
    );
  }

  if (validKeys.length !== updateKeys.length) {
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

      const { nextParamIndex, setClauses, values } =
        buildServiceInstanceSetClause(updates, validKeys);

      const updateResult = await client.query<Record<string, unknown>>(
        `
          UPDATE service_instances
          SET ${setClauses.join(', ')}
          WHERE id = $${nextParamIndex}::uuid
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

export async function updateAppParametersInDb(
  instanceId: string,
  parameters: Record<string, unknown>
): Promise<Result<void>> {
  return dataService.query(async () => {
    const result = await getServiceInstanceByInstanceId('dify', instanceId);

    if (!result.success || !result.data) {
      throw new Error(`Service instance with ID ${instanceId} not found`);
    }

    const currentConfig = result.data.config || {};
    const updatedConfig = {
      ...currentConfig,
      dify_parameters: parameters,
    };

    const updateResult = await updateServiceInstance(result.data.id, {
      config: updatedConfig,
    });

    if (!updateResult.success) {
      throw updateResult.error;
    }

    return undefined;
  });
}

export async function setDefaultServiceInstance(
  instanceId: string
): Promise<Result<ServiceInstance>> {
  return dataService.query(async () => {
    const instanceResult = await getServiceInstanceById(instanceId);
    if (!instanceResult.success || !instanceResult.data) {
      throw new Error('Specified service instance not found');
    }

    const instance = instanceResult.data;
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

    cacheService.deletePattern('service_instances:*');

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
