import { createDecipheriv, createHash } from 'node:crypto';

import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from './pg-context';

interface ServiceInstanceSummaryRow {
  id: string;
  instance_id: string;
}

interface ServiceInstanceWithProviderRow {
  id: string;
  instance_id: string;
  display_name: string | null;
  description: string | null;
  config: Record<string, unknown> | null;
  provider_base_url: string;
}

export interface DifyAppConfig {
  apiKey: string;
  apiUrl: string;
  appId: string;
  displayName?: string;
  description?: string;
  appType?: string;
}

interface ResolveDifyConfigOptions {
  actorUserId?: string | null;
  actorRole?: string | null;
}

function normalizeActorUserId(
  userId: string | null | undefined
): string | null {
  if (typeof userId !== 'string') {
    return null;
  }

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeActorRole(role: string | null | undefined): string {
  if (typeof role !== 'string') {
    return 'user';
  }

  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'user';
}

function decryptApiKey(encryptedData: string, masterKey: string): string {
  const hash = createHash('sha256');
  hash.update(masterKey);
  const key = hash.digest();

  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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

async function resolveScopedServiceInstance(
  appId: string,
  actorUserId: string,
  actorRole: string
): Promise<ServiceInstanceSummaryRow | null> {
  const directRows =
    await queryRowsWithPgUserContext<ServiceInstanceSummaryRow>(
      actorUserId,
      actorRole,
      `
      SELECT
        si.id::text AS id,
        si.instance_id
      FROM service_instances si
      WHERE si.instance_id = $1
      LIMIT 1
    `,
      [appId]
    );

  if (directRows[0]) {
    return directRows[0];
  }

  const fallbackRows =
    await queryRowsWithPgUserContext<ServiceInstanceSummaryRow>(
      actorUserId,
      actorRole,
      `
        SELECT
          si.id::text AS id,
          si.instance_id
        FROM service_instances si
        WHERE si.is_default = TRUE
        ORDER BY si.created_at ASC, si.id ASC
        LIMIT 1
      `
    );

  return fallbackRows[0] || null;
}

async function resolveServiceInstanceWithProvider(
  appId: string,
  actorUserId: string | null,
  actorRole: string
): Promise<ServiceInstanceWithProviderRow | null> {
  if (actorUserId) {
    const scoped = await resolveScopedServiceInstance(
      appId,
      actorUserId,
      actorRole
    );
    if (!scoped) {
      return null;
    }

    const rows =
      await queryRowsWithPgSystemContext<ServiceInstanceWithProviderRow>(
        `
          SELECT
            si.id::text AS id,
            si.instance_id,
            si.display_name,
            si.description,
            si.config,
            p.base_url AS provider_base_url
          FROM service_instances si
          INNER JOIN providers p ON p.id = si.provider_id
          WHERE si.id = $1::uuid
            AND p.is_active = TRUE
          LIMIT 1
        `,
        [scoped.id]
      );

    return rows[0] || null;
  }

  const directRows =
    await queryRowsWithPgSystemContext<ServiceInstanceWithProviderRow>(
      `
        SELECT
          si.id::text AS id,
          si.instance_id,
          si.display_name,
          si.description,
          si.config,
          p.base_url AS provider_base_url
        FROM service_instances si
        INNER JOIN providers p ON p.id = si.provider_id
        WHERE si.instance_id = $1
          AND p.is_active = TRUE
        LIMIT 1
      `,
      [appId]
    );

  if (directRows[0]) {
    return directRows[0];
  }

  const fallbackRows =
    await queryRowsWithPgSystemContext<ServiceInstanceWithProviderRow>(
      `
        SELECT
          si.id::text AS id,
          si.instance_id,
          si.display_name,
          si.description,
          si.config,
          p.base_url AS provider_base_url
        FROM providers p
        INNER JOIN service_instances si ON si.provider_id = p.id
        WHERE p.is_default = TRUE
          AND p.is_active = TRUE
          AND si.is_default = TRUE
        LIMIT 1
      `
    );

  return fallbackRows[0] || null;
}

export async function resolveDifyConfig(
  appId: string,
  options: ResolveDifyConfigOptions = {}
): Promise<DifyAppConfig | null> {
  const trimmedAppId = appId.trim();
  if (!trimmedAppId) {
    return null;
  }

  const masterKey = process.env.API_ENCRYPTION_KEY;
  if (!masterKey) {
    return null;
  }

  const actorUserId = normalizeActorUserId(options.actorUserId);
  const actorRole = normalizeActorRole(options.actorRole);

  const serviceInstance = await resolveServiceInstanceWithProvider(
    trimmedAppId,
    actorUserId,
    actorRole
  );
  if (!serviceInstance) {
    return null;
  }

  const apiKeyRows = await queryRowsWithPgSystemContext<{ key_value: string }>(
    `
      SELECT key_value
      FROM api_keys
      WHERE service_instance_id = $1::uuid
        AND is_default = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [serviceInstance.id]
  );

  const encryptedOrPlain = apiKeyRows[0]?.key_value;
  if (!encryptedOrPlain) {
    return null;
  }

  let apiKey = encryptedOrPlain;
  if (encryptedOrPlain.includes(':')) {
    try {
      apiKey = decryptApiKey(encryptedOrPlain, masterKey);
    } catch {
      return null;
    }
  }

  return {
    apiKey,
    apiUrl: serviceInstance.provider_base_url,
    appId: serviceInstance.instance_id,
    displayName: serviceInstance.display_name || serviceInstance.instance_id,
    description: serviceInstance.description || undefined,
    appType: readDifyAppType(serviceInstance.config),
  };
}
