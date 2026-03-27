import { decryptApiKey } from '../utils/encryption';

export interface DifyAppConfig {
  apiKey: string;
  apiUrl: string;
  appId: string;
  displayName?: string;
  description?: string;
  appType?: string;
}

export interface DifyConfigQueryOptions {
  actorUserId?: string | null;
  useSystemActor?: boolean;
}

type ServiceInstanceSummaryRow = {
  id: string;
  instance_id: string;
};

type ServiceInstanceWithProviderRow = {
  id: string;
  instance_id: string;
  display_name: string | null;
  description: string | null;
  config: Record<string, unknown> | null;
  provider_id: string;
  provider_name: string;
  provider_base_url: string;
};

// Cache for configuration to avoid repeated requests
const configCache: Record<
  string,
  { config: DifyAppConfig; timestamp: number }
> = {};
const CACHE_TTL = 2 * 60 * 1000;

function normalizeActorUserId(
  userId: string | null | undefined
): string | null {
  if (typeof userId !== 'string') {
    return null;
  }

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildCacheKey(appId: string, actorUserId: string | null): string {
  if (!actorUserId) {
    return `global::${appId}`;
  }

  return `actor:${actorUserId}::${appId}`;
}

function readDifyAppType(
  config: Record<string, unknown> | null
): string | undefined {
  if (!config) {
    return undefined;
  }

  const appMetadata = config.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object') {
    return undefined;
  }

  const appType = (appMetadata as Record<string, unknown>).dify_apptype;
  if (typeof appType !== 'string') {
    return undefined;
  }

  const normalized = appType.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function queryRowsWithContext<T extends object>(
  sql: string,
  params: unknown[] = [],
  options: DifyConfigQueryOptions = {}
): Promise<T[]> {
  const actorUserId = normalizeActorUserId(options.actorUserId);

  const { getPgPool } = await import('@lib/server/pg/pool');
  if (actorUserId) {
    const { queryRowsWithPgUserContext } = await import(
      '@lib/server/pg/user-context'
    );
    return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
  }

  if (options.useSystemActor !== false) {
    const { queryRowsWithPgSystemContext } = await import(
      '@lib/server/pg/user-context'
    );
    return queryRowsWithPgSystemContext<T>(sql, params);
  }

  const pool = getPgPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

async function resolveScopedServiceInstance(
  appId: string,
  actorUserId: string
): Promise<ServiceInstanceSummaryRow | null> {
  const directRows = await queryRowsWithContext<ServiceInstanceSummaryRow>(
    `
      SELECT
        si.id::text AS id,
        si.instance_id
      FROM service_instances si
      WHERE si.instance_id = $1
      LIMIT 1
    `,
    [appId],
    { actorUserId }
  );

  if (directRows[0]) {
    return directRows[0];
  }

  const fallbackRows = await queryRowsWithContext<ServiceInstanceSummaryRow>(
    `
      SELECT
        si.id::text AS id,
        si.instance_id
      FROM service_instances si
      WHERE si.is_default = TRUE
      ORDER BY si.created_at ASC, si.id ASC
      LIMIT 1
    `,
    [],
    { actorUserId }
  );

  return fallbackRows[0] || null;
}

async function resolveServiceInstanceWithProvider(
  appId: string,
  actorUserId: string | null
): Promise<ServiceInstanceWithProviderRow | null> {
  if (actorUserId) {
    const scoped = await resolveScopedServiceInstance(appId, actorUserId);
    if (!scoped) {
      return null;
    }

    const rows = await queryRowsWithContext<ServiceInstanceWithProviderRow>(
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
        WHERE si.id = $1::uuid
          AND p.is_active = TRUE
        LIMIT 1
      `,
      [scoped.id],
      { useSystemActor: true }
    );

    if (!rows[0]) {
      return null;
    }

    if (scoped.instance_id !== appId) {
      console.log(
        `[Get App Config] Requested instance "${appId}" is not accessible, fallback to ${rows[0].instance_id}`
      );
    }

    return rows[0];
  }

  const directRows = await queryRowsWithContext<ServiceInstanceWithProviderRow>(
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
    [appId],
    { useSystemActor: true }
  );

  if (directRows[0]) {
    return directRows[0];
  }

  console.log(
    `[Get App Config] No service instance found for instance_id "${appId}", trying default provider's default instance`
  );

  const fallbackRows =
    await queryRowsWithContext<ServiceInstanceWithProviderRow>(
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
    `,
      [],
      { useSystemActor: true }
    );

  return fallbackRows[0] || null;
}

/**
 * Clear the configuration cache for a specific appId.
 * If appId is not provided, clear all cache.
 */
export const clearDifyConfigCache = (appId?: string): void => {
  if (appId) {
    Object.keys(configCache).forEach(key => {
      if (key.endsWith(`::${appId}`)) {
        delete configCache[key];
      }
    });
    console.log(`[Dify Config Cache] Cleared cache for ${appId}`);
    return;
  }

  Object.keys(configCache).forEach(key => delete configCache[key]);
  console.log('[Dify Config Cache] Cleared all cache');
};

/**
 * Force refresh the configuration cache for a specific appId.
 */
export const refreshDifyConfigCache = async (
  appId: string,
  options: DifyConfigQueryOptions = {}
): Promise<DifyAppConfig | null> => {
  console.log(`[Dify Config Cache] Force refresh config for ${appId}`);
  clearDifyConfigCache(appId);
  return await getDifyAppConfig(appId, true, options);
};

/**
 * Get Dify application configuration.
 */
export const getDifyAppConfig = async (
  appId: string,
  forceRefresh: boolean = false,
  options: DifyConfigQueryOptions = {}
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

  const actorUserId = normalizeActorUserId(options.actorUserId);
  const cacheKey = buildCacheKey(appId, actorUserId);

  if (forceRefresh) {
    clearDifyConfigCache(appId);
  }

  const cached = configCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL && !forceRefresh) {
    console.log(`[Get Dify Config] Using cached config: ${cacheKey}`);
    return cached.config;
  }

  try {
    const config = await getDifyConfigFromDatabase(appId, {
      actorUserId,
      useSystemActor: actorUserId ? false : options.useSystemActor,
    });

    if (config) {
      configCache[cacheKey] = {
        config,
        timestamp: Date.now(),
      };

      console.log(
        '[Get Dify Config] Successfully fetched config from database'
      );
      return config;
    }

    console.error(`[Get Dify Config] No config found in database for ${appId}`);
    return null;
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
 */
async function getDifyConfigFromDatabase(
  appId: string,
  options: DifyConfigQueryOptions = {}
): Promise<DifyAppConfig | null> {
  const masterKey = process.env.API_ENCRYPTION_KEY;

  if (!masterKey) {
    console.error(
      '[Get Dify Config] ERROR: API_ENCRYPTION_KEY environment variable is not set. Cannot decrypt API key.'
    );
    return null;
  }

  const actorUserId = normalizeActorUserId(options.actorUserId);
  const serviceInstance = await resolveServiceInstanceWithProvider(
    appId,
    actorUserId
  );

  if (!serviceInstance) {
    console.error(`No service instance or provider found for app "${appId}"`);
    return null;
  }

  console.log('[Get Dify Config] Resolved service instance', {
    requestedAppId: appId,
    resolvedInstanceId: serviceInstance.instance_id,
    resolvedDisplayName: serviceInstance.display_name,
    providerName: serviceInstance.provider_name,
    actorUserId: actorUserId ?? null,
    usedFallback: serviceInstance.instance_id !== appId,
  });

  const instanceId = serviceInstance.id;
  if (!instanceId) {
    console.error(`No valid instance ID for Dify app "${appId}"`);
    return null;
  }

  const apiKeyRows = await queryRowsWithContext<{ key_value: string }>(
    `
      SELECT key_value
      FROM api_keys
      WHERE service_instance_id = $1::uuid
        AND is_default = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [instanceId],
    { useSystemActor: true }
  );

  const apiKey = apiKeyRows[0];
  if (!apiKey) {
    console.error(`No API key found for app "${appId}"`);
    return null;
  }

  if (!apiKey.key_value) {
    console.error('API key value is empty');
    return null;
  }

  try {
    let decryptedKey: string;

    if (!apiKey.key_value.includes(':')) {
      decryptedKey = apiKey.key_value;
    } else {
      try {
        decryptedKey = decryptApiKey(apiKey.key_value, masterKey);
      } catch (decryptError) {
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

    const config = {
      apiKey: decryptedKey,
      apiUrl: serviceInstance.provider_base_url,
      appId: serviceInstance.instance_id,
      displayName: serviceInstance.display_name || serviceInstance.instance_id,
      description: serviceInstance.description || undefined,
      appType: readDifyAppType(serviceInstance.config),
    };

    return config;
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
    return null;
  }
}

// Functions related to environment variable config fetching have been removed.
// Now we only fetch config from database, no longer use environment variables.
