import { decryptApiKey } from '../utils/encryption';

export interface DifyAppConfig {
  apiKey: string;
  apiUrl: string;
  appId: string;
  displayName?: string;
  description?: string;
  appType?: string;
}

// Cache for configuration to avoid repeated requests
// Added cache management functions for manual clearing and validation
const configCache: Record<
  string,
  { config: DifyAppConfig; timestamp: number }
> = {};
const CACHE_TTL = 2 * 60 * 1000; // Cache for 2 minutes to improve config update responsiveness

/**
 * Clear the configuration cache for a specific appId.
 * If appId is not provided, clear all cache.
 * @param appId Application ID (optional)
 */
export const clearDifyConfigCache = (appId?: string): void => {
  if (appId) {
    delete configCache[appId];
    console.log(`[Dify Config Cache] Cleared cache for ${appId}`);
  } else {
    Object.keys(configCache).forEach(key => delete configCache[key]);
    console.log('[Dify Config Cache] Cleared all cache');
  }
};

/**
 * Force refresh the configuration cache for a specific appId.
 * @param appId Application ID
 * @returns Refreshed configuration
 */
export const refreshDifyConfigCache = async (
  appId: string
): Promise<DifyAppConfig | null> => {
  console.log(`[Dify Config Cache] Force refresh config for ${appId}`);
  clearDifyConfigCache(appId);
  return await getDifyAppConfig(appId);
};

/**
 * Get Dify application configuration.
 * Fetch from database, support cache and force refresh.
 * @param appId Dify application ID
 * @param forceRefresh Whether to force refresh and skip cache
 * @returns Dify application config, including apiKey and apiUrl
 */
export const getDifyAppConfig = async (
  appId: string,
  forceRefresh: boolean = false
): Promise<DifyAppConfig | null> => {
  if (typeof window !== 'undefined') {
    try {
      const response = await fetch(
        `/api/internal/dify-config/${encodeURIComponent(appId)}?forceRefresh=${forceRefresh ? '1' : '0'}`,
        {
          method: 'GET',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        success: boolean;
        config?: DifyAppConfig | null;
      };
      return payload.success ? payload.config || null : null;
    } catch (error) {
      console.error('[Get Dify Config] Browser fetch failed:', error);
      return null;
    }
  }

  // If force refresh, clear cache
  if (forceRefresh) {
    clearDifyConfigCache(appId);
  }

  // Check cache
  const cached = configCache[appId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL && !forceRefresh) {
    console.log(`[Get Dify Config] Using cached config: ${appId}`);
    return cached.config;
  }

  try {
    // Fetch config from database
    const config = await getDifyConfigFromDatabase(appId);

    if (config) {
      console.log(
        `[Get Dify Config] Successfully fetched config from database`
      );

      // Update cache
      configCache[appId] = {
        config,
        timestamp: Date.now(),
      };

      return config;
    } else {
      console.error(
        `[Get Dify Config] No config found in database for ${appId}`
      );

      return null;
    }
  } catch (error) {
    console.error(
      `[Get Dify Config] Error fetching config for ${appId}:`,
      error
    );
    return null;
  }
};

/**
 * Fetch application configuration from database (supports multiple providers)
 * @param appId Application ID
 * @returns Application configuration
 */
async function getDifyConfigFromDatabase(
  appId: string
): Promise<DifyAppConfig | null> {
  // Get master key from environment variable
  const masterKey = process.env.API_ENCRYPTION_KEY;

  if (!masterKey) {
    console.error(
      '[Get Dify Config] ERROR: API_ENCRYPTION_KEY environment variable is not set. Cannot decrypt API key.'
    );
    // Return null because decryption is not possible without master key
    return null;
  }

  const { getPgPool } = await import('@lib/server/pg/pool');
  const pool = getPgPool();
  const { rows: directInstanceRows } = await pool.query<{
    id: string;
    instance_id: string;
    display_name: string | null;
    description: string | null;
    config: Record<string, any> | null;
    provider_id: string;
    provider_name: string;
    provider_base_url: string;
  }>(
    `
      SELECT
        si.id::text AS id,
        si.instance_id,
        si.display_name,
        si.description,
        si.config,
        p.id::text AS provider_id,
        p.name AS provider_name,
        p.base_url AS provider_base_url
      FROM service_instances si
      INNER JOIN providers p ON p.id = si.provider_id
      WHERE si.instance_id = $1
        AND p.is_active = TRUE
      LIMIT 1
    `,
    [appId]
  );

  let serviceInstance = directInstanceRows[0];
  let provider = serviceInstance
    ? {
        id: serviceInstance.provider_id,
        name: serviceInstance.provider_name,
        base_url: serviceInstance.provider_base_url,
      }
    : null;

  // If the specified instance is not found, try to use the default provider's default instance as fallback
  if (!serviceInstance || !provider) {
    console.log(
      `[Get App Config] No service instance found for instance_id "${appId}", trying default provider's default instance`
    );

    const { rows: fallbackRows } = await pool.query<{
      id: string;
      instance_id: string;
      display_name: string | null;
      description: string | null;
      config: Record<string, any> | null;
      provider_id: string;
      provider_name: string;
      provider_base_url: string;
    }>(
      `
        SELECT
          si.id::text AS id,
          si.instance_id,
          si.display_name,
          si.description,
          si.config,
          p.id::text AS provider_id,
          p.name AS provider_name,
          p.base_url AS provider_base_url
        FROM providers p
        INNER JOIN service_instances si ON si.provider_id = p.id
        WHERE p.is_default = TRUE
          AND p.is_active = TRUE
          AND si.is_default = TRUE
        LIMIT 1
      `
    );

    const fallback = fallbackRows[0];
    if (!fallback) {
      console.error(
        `[Get App Config] No default service instance found for default provider, appId: ${appId}`
      );
      return null;
    }

    serviceInstance = fallback;
    provider = {
      id: fallback.provider_id,
      name: fallback.provider_name,
      base_url: fallback.provider_base_url,
    };
    console.log(
      `[Get App Config] Using default provider "${provider.name}" default instance: ${fallback.instance_id} (original request: ${appId})`
    );
  } else {
    console.log(
      `[Get App Config] Found app instance: ${appId}, provider: ${provider.name}`
    );
  }

  if (!serviceInstance || !provider) {
    console.error(`No service instance or provider found for app "${appId}"`);
    return null;
  }

  const instanceId = serviceInstance.id;

  if (!instanceId) {
    console.error(`No valid instance ID for Dify app "${appId}"`);
    return null;
  }

  // 4. Get API key
  const { rows: apiKeyRows } = await pool.query<{ key_value: string }>(
    `
      SELECT key_value
      FROM api_keys
      WHERE service_instance_id = $1::uuid
        AND is_default = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [instanceId]
  );

  const apiKey = apiKeyRows[0];
  if (!apiKey) {
    console.error(`No API key found for app "${appId}"`);
    return null;
  }

  // Check if API key is empty
  if (!apiKey.key_value) {
    console.error('API key value is empty');
    return null;
  }

  try {
    let decryptedKey: string;

    // If the key is not in encrypted format, use it directly
    if (!apiKey.key_value.includes(':')) {
      decryptedKey = apiKey.key_value;
    } else {
      try {
        // Use masterKey from environment variable to decrypt
        decryptedKey = decryptApiKey(apiKey.key_value, masterKey);
      } catch (decryptError) {
        // If decryption fails, do not use test key, just log error and return null
        console.error(
          `[Get Dify Config] Failed to decrypt API Key for appID '${appId}':`,
          decryptError
        );
        console.error(
          '[Get Dify Config] The master key used may be inconsistent with the one used for encryption (check API_ENCRYPTION_KEY env), or the encrypted data is corrupted.'
        );
        return null;
      }
    }

    // 5. Build config
    const config = {
      apiKey: decryptedKey,
      apiUrl: provider.base_url,
      appId: serviceInstance.instance_id,
      displayName: serviceInstance.display_name || serviceInstance.instance_id,
      description: serviceInstance.description || undefined,
      appType: serviceInstance.config?.app_metadata?.dify_apptype,
    };

    return config;
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
    return null;
  }
}

// Functions related to environment variable config fetching have been removed.
// Now we only fetch config from database, no longer use environment variables.
