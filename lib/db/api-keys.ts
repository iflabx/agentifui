/**
 * Database query functions for API key management.
 *
 * This file contains all database operations related to the api_keys table.
 * Updated to use unified data service and Result type.
 */
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { Result, failure, success } from '@lib/types/result';

import { ApiKey } from '../types/database';
import { decryptApiKey, encryptApiKey } from '../utils/encryption';

const IS_BROWSER = typeof window !== 'undefined';

type RealtimeRow = Record<string, unknown>;

async function publishApiKeyChangeBestEffort(input: {
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
      table: 'api_keys',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[ApiKeysDB] Realtime publish failed:', error);
  }
}

/**
 * Get the API key for a specific service instance (optimized version).
 * @param serviceInstanceId Service instance ID
 * @returns Result containing the API key object, or null if not found
 */
export async function getApiKeyByServiceInstance(
  serviceInstanceId: string
): Promise<Result<ApiKey | null>> {
  return dataService.findOne<ApiKey>(
    'api_keys',
    {
      service_instance_id: serviceInstanceId,
      is_default: true,
    },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
    }
  );
}

/**
 * Create a new API key (optimized version).
 * @param apiKey API key object
 * @param isEncrypted Whether the key value is already encrypted, default is false
 * @returns Result containing the created API key object, or error if creation fails
 */
export async function createApiKey(
  apiKey: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>,
  isEncrypted: boolean = false
): Promise<Result<ApiKey>> {
  try {
    let keyValue = apiKey.key_value;

    // Encrypt the key if it is not already encrypted
    if (!isEncrypted) {
      const masterKey = process.env.API_ENCRYPTION_KEY;
      if (!masterKey) {
        return failure(
          new Error(
            'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key'
          )
        );
      }
      keyValue = encryptApiKey(apiKey.key_value, masterKey);
    }

    const result = await dataService.create<ApiKey>('api_keys', {
      ...apiKey,
      key_value: keyValue,
    });

    // Clear related cache
    if (result.success) {
      cacheService.deletePattern('api_keys:*');
    }

    return result;
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Update an API key (optimized version).
 * @param id API key ID
 * @param updates Fields to update
 * @param isEncrypted Whether the key value is already encrypted, default is false
 * @returns Result containing the updated API key object, or error if update fails
 */
export async function updateApiKey(
  id: string,
  updates: Partial<Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>>,
  isEncrypted: boolean = false
): Promise<Result<ApiKey>> {
  try {
    const processedUpdates = { ...updates };

    // If key_value is present and not encrypted, encrypt it
    if (updates.key_value && !isEncrypted) {
      const masterKey = process.env.API_ENCRYPTION_KEY;
      if (!masterKey) {
        return failure(
          new Error(
            'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key'
          )
        );
      }
      processedUpdates.key_value = encryptApiKey(updates.key_value, masterKey);
    }

    const result = await dataService.update<ApiKey>(
      'api_keys',
      id,
      processedUpdates
    );

    // Clear related cache
    if (result.success) {
      cacheService.deletePattern('api_keys:*');
    }

    return result;
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Delete an API key (optimized version).
 * @param id API key ID
 * @returns Result indicating whether deletion was successful
 */
export async function deleteApiKey(id: string): Promise<Result<boolean>> {
  const result = await dataService.delete('api_keys', id);

  if (result.success) {
    // Clear related cache
    cacheService.deletePattern('api_keys:*');
    return success(true);
  } else {
    return success(false);
  }
}

/**
 * Get the decrypted API key value (optimized version).
 * @param apiKeyId API key ID
 * @returns Result containing the decrypted API key value, or error if failed
 */
export async function getDecryptedApiKey(
  apiKeyId: string
): Promise<Result<string | null>> {
  try {
    const result = await dataService.findOne<{ key_value: string }>(
      'api_keys',
      { id: apiKeyId },
      {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      }
    );

    if (!result.success) {
      return failure(result.error);
    }

    if (!result.data) {
      return success(null);
    }

    const masterKey = process.env.API_ENCRYPTION_KEY;
    if (!masterKey) {
      return failure(
        new Error(
          'API_ENCRYPTION_KEY environment variable is not set, cannot decrypt API key'
        )
      );
    }

    const decryptedKey = decryptApiKey(result.data.key_value, masterKey);
    return success(decryptedKey);
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error(`Failed to decrypt API key: ${String(error)}`)
    );
  }
}

/**
 * Increment API key usage count (optimized version).
 * @param id API key ID
 * @returns Result indicating whether the update was successful
 */
export async function incrementApiKeyUsage(
  id: string
): Promise<Result<boolean>> {
  return dataService.query(async () => {
    const oldRowResult = await dataService.rawQuery<{
      id: string;
      usage_count: number | null;
      last_used_at: string | null;
      service_instance_id: string;
    }>(
      `
        SELECT
          id::text AS id,
          usage_count,
          last_used_at::text AS last_used_at,
          service_instance_id::text AS service_instance_id
        FROM api_keys
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    if (!oldRowResult.success) {
      throw oldRowResult.error;
    }

    const updateResult = await dataService.rawQuery<{
      id: string;
      usage_count: number | null;
      last_used_at: string | null;
      service_instance_id: string;
    }>(
      `
        UPDATE api_keys
        SET usage_count = COALESCE(usage_count, 0) + 1,
            last_used_at = NOW(),
            updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING
          id::text AS id,
          usage_count,
          last_used_at::text AS last_used_at,
          service_instance_id::text AS service_instance_id
      `,
      [id]
    );

    if (!updateResult.success) {
      throw updateResult.error;
    }

    // Clear related cache
    cacheService.deletePattern('api_keys:*');

    if (updateResult.data[0]) {
      await publishApiKeyChangeBestEffort({
        eventType: 'UPDATE',
        oldRow: oldRowResult.data[0] || null,
        newRow: updateResult.data[0],
      });
    }

    return true;
  });
}

// Compatibility functions to maintain compatibility with existing code.
// These functions will gradually migrate to using the Result type.
/**
 * Get the API key for a specific service instance (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function getApiKeyByServiceInstanceLegacy(
  serviceInstanceId: string
): Promise<ApiKey | null> {
  const result = await getApiKeyByServiceInstance(serviceInstanceId);
  return result.success ? result.data : null;
}

/**
 * Create a new API key (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function createApiKeyLegacy(
  apiKey: Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>,
  isEncrypted: boolean = false
): Promise<ApiKey | null> {
  const result = await createApiKey(apiKey, isEncrypted);
  return result.success ? result.data : null;
}

/**
 * Update an API key (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function updateApiKeyLegacy(
  id: string,
  updates: Partial<Omit<ApiKey, 'id' | 'created_at' | 'updated_at'>>,
  isEncrypted: boolean = false
): Promise<ApiKey | null> {
  const result = await updateApiKey(id, updates, isEncrypted);
  return result.success ? result.data : null;
}

/**
 * Delete an API key (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function deleteApiKeyLegacy(id: string): Promise<boolean> {
  const result = await deleteApiKey(id);
  return result.success ? result.data : false;
}

/**
 * Get the decrypted API key value (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function getDecryptedApiKeyLegacy(
  apiKeyId: string
): Promise<string | null> {
  const result = await getDecryptedApiKey(apiKeyId);
  return result.success ? result.data : null;
}

/**
 * Increment API key usage count (legacy version).
 * @deprecated Please use the new version and handle the Result type
 */
export async function incrementApiKeyUsageLegacy(id: string): Promise<boolean> {
  const result = await incrementApiKeyUsage(id);
  return result.success ? result.data : false;
}
