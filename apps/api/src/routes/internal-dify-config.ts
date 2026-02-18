import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createDecipheriv, createHash } from 'node:crypto';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface InternalDifyConfigRoutesOptions {
  config: ApiRuntimeConfig;
}

interface ServiceInstanceWithProviderRow {
  id: string;
  instance_id: string;
  display_name: string | null;
  description: string | null;
  config: Record<string, unknown> | null;
  provider_base_url: string;
}

interface DifyAppConfigPayload {
  apiKey: string;
  apiUrl: string;
  appId: string;
  displayName?: string;
  description?: string;
  appType?: string;
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

async function requireAdmin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true }
  | { ok: false; statusCode: number; payload: Record<string, unknown> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized access',
      }),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify permissions',
      }),
    };
  }
  if (resolved.identity.role !== 'admin') {
    return {
      ok: false,
      statusCode: 403,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Insufficient permissions',
      }),
    };
  }
  return { ok: true };
}

async function resolveServiceInstanceWithProvider(
  appId: string
): Promise<ServiceInstanceWithProviderRow | null> {
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

async function resolveDifyConfig(
  appId: string
): Promise<DifyAppConfigPayload | null> {
  const masterKey = process.env.API_ENCRYPTION_KEY;
  if (!masterKey) {
    return null;
  }

  const serviceInstance = await resolveServiceInstanceWithProvider(appId);
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

export const internalDifyConfigRoutes: FastifyPluginAsync<
  InternalDifyConfigRoutesOptions
> = async (app, options) => {
  app.get<{
    Params: { appId: string };
    Querystring: { forceRefresh?: string };
  }>('/api/internal/dify-config/:appId', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const appId = (request.params.appId || '').trim();
      if (!appId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'DIFY_CONFIG_APP_ID_MISSING',
            userMessage: 'Missing appId',
            extra: {
              config: null,
            },
          })
        );
      }

      const config = await resolveDifyConfig(appId);
      return reply.send({
        success: true,
        config,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][internal-dify-config] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'INTERNAL_DIFY_CONFIG_FAILED',
          userMessage: 'Internal server error',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown dify config retrieval error',
          extra: {
            config: null,
          },
        })
      );
    }
  });
};
