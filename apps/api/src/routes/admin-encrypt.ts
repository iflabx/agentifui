import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import type { ApiRuntimeConfig } from '../config';
import { resolveIdentityFromSession } from '../lib/upstream-session';

interface AdminEncryptRoutesOptions {
  config: ApiRuntimeConfig;
}

function encryptApiKey(apiKey: string, masterKey: string): string {
  const hash = createHash('sha256');
  hash.update(masterKey);
  const key = hash.digest();

  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

async function requireAdmin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true }
  | { ok: false; statusCode: number; payload: Record<string, string> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: { error: 'Unauthorized access' },
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: { error: 'Failed to verify permissions' },
    };
  }
  if (resolved.identity.role !== 'admin') {
    return {
      ok: false,
      statusCode: 403,
      payload: { error: 'Insufficient permissions' },
    };
  }
  return { ok: true };
}

export const adminEncryptRoutes: FastifyPluginAsync<
  AdminEncryptRoutesOptions
> = async (app, options) => {
  app.post<{
    Body: { apiKey?: string };
  }>('/api/admin/encrypt', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const { apiKey } = request.body || {};
      if (!apiKey) {
        return reply.status(400).send({ error: 'Missing API key' });
      }

      const masterKey = process.env.API_ENCRYPTION_KEY;
      if (!masterKey) {
        request.log.error(
          '[FastifyAPI][admin-encrypt] API_ENCRYPTION_KEY environment variable not set'
        );
        return reply.status(500).send({
          error: 'Server configuration error: encryption key not set',
        });
      }

      const encryptedKey = encryptApiKey(apiKey, masterKey);
      return reply.send({ encryptedKey });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-encrypt] POST failed'
      );
      return reply.status(500).send({ error: 'Error encrypting API key' });
    }
  });
};
