import cors from '@fastify/cors';
import Fastify from 'fastify';

import { type ApiRuntimeConfig, loadApiRuntimeConfig } from './config';
import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  normalizeLegacyErrorEnvelope,
} from './lib/app-error';
import { recordApiErrorEvent } from './lib/error-events';
import { adminAuthFallbackPolicyRoutes } from './routes/admin-auth-fallback-policy';
import { adminAuthFallbackPolicyUserRoutes } from './routes/admin-auth-fallback-policy-user';
import { adminEncryptRoutes } from './routes/admin-encrypt';
import { adminStatusRoutes } from './routes/admin-status';
import { adminTranslationsRoutes } from './routes/admin-translations';
import { adminUsersRoutes } from './routes/admin-users';
import { adminUsersForGroupRoutes } from './routes/admin-users-for-group';
import { healthRoutes } from './routes/health';
import { internalAppsRoutes } from './routes/internal-apps';
import { internalAuthLocalPasswordRoutes } from './routes/internal-auth-local-password';
import { internalDataRoutes } from './routes/internal-data';
import { internalDifyConfigRoutes } from './routes/internal-dify-config';
import { internalProfileRoutes } from './routes/internal-profile';
import { internalRealtimeStatsRoutes } from './routes/internal-realtime-stats';
import { internalRealtimeStreamRoutes } from './routes/internal-realtime-stream';
import { proxyFallbackRoutes } from './routes/proxy-fallback';
import { translationsRoutes } from './routes/translations';

const REALTIME_SENSITIVE_PREFIXES = [
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/realtime',
];

function hasPrefixCoverage(prefixes: string[], targetPrefix: string): boolean {
  return prefixes.some(
    prefix =>
      prefix === targetPrefix ||
      prefix.startsWith(`${targetPrefix}/`) ||
      targetPrefix.startsWith(`${prefix}/`)
  );
}

function assertRealtimeModeSupport(config: ApiRuntimeConfig): void {
  if (config.realtimeSourceMode === 'db-outbox') {
    return;
  }

  const matchedPrefixes = REALTIME_SENSITIVE_PREFIXES.filter(prefix =>
    hasPrefixCoverage(config.proxyPrefixes, prefix)
  );
  if (matchedPrefixes.length === 0) {
    return;
  }

  throw new Error(
    `REALTIME_SOURCE_MODE=${config.realtimeSourceMode} is not supported for proxied prefixes: ${matchedPrefixes.join(
      ', '
    )}. Use REALTIME_SOURCE_MODE=db-outbox or remove these prefixes from FASTIFY_PROXY_PREFIXES.`
  );
}

function resolveHttpStatusCode(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }
  const errorLike = error as { statusCode?: unknown };
  if (typeof errorLike.statusCode === 'number' && errorLike.statusCode >= 400) {
    return errorLike.statusCode;
  }
  return 500;
}

export async function createApiServer(config: ApiRuntimeConfig) {
  assertRealtimeModeSupport(config);

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(adminAuthFallbackPolicyRoutes, { config });
  await app.register(adminAuthFallbackPolicyUserRoutes, { config });
  await app.register(adminEncryptRoutes, { config });
  await app.register(adminStatusRoutes, { config });
  await app.register(adminTranslationsRoutes, { config });
  await app.register(adminUsersRoutes, { config });
  await app.register(adminUsersForGroupRoutes, { config });
  await app.register(healthRoutes, { config });
  await app.register(internalAppsRoutes, { config });
  await app.register(internalAuthLocalPasswordRoutes, { config });
  await app.register(internalDataRoutes, { config });
  await app.register(internalDifyConfigRoutes, { config });
  await app.register(internalProfileRoutes, { config });
  await app.register(internalRealtimeStreamRoutes, { config });
  await app.register(internalRealtimeStatsRoutes, { config });
  await app.register(translationsRoutes);
  await app.register(proxyFallbackRoutes, { config });

  app.addHook('preSerialization', (request, reply, payload, done) => {
    try {
      const normalized = normalizeLegacyErrorEnvelope({
        payload,
        statusCode: reply.statusCode,
        requestId: request.id,
        source: 'fastify-api',
      });
      done(null, normalized);
    } catch (error) {
      done(error as Error);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      { err: error, url: request.url, method: request.method },
      '[FastifyAPI] request failed'
    );
    if (reply.sent) {
      return;
    }
    const statusCode = resolveHttpStatusCode(error);
    const detail = buildApiErrorDetail({
      status: statusCode,
      source: 'fastify-api',
      requestId: request.id,
      userMessage: 'Fastify API internal error',
      developerMessage: error instanceof Error ? error.message : String(error),
    });
    const payload = buildApiErrorEnvelope(detail, 'Fastify API internal error');
    void recordApiErrorEvent({
      detail,
      statusCode,
      method: request.method,
      route: request.url,
    }).catch(logError => {
      request.log.warn(
        { err: logError },
        '[FastifyAPI] failed to record global error event'
      );
    });
    reply.header(REQUEST_ID_HEADER, request.id);
    reply.status(statusCode).send(payload);
  });

  return app;
}

async function startServer() {
  const config = loadApiRuntimeConfig();
  const app = await createApiServer(config);
  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });
    app.log.info(
      {
        host: config.host,
        port: config.port,
        proxyPrefixes: config.proxyPrefixes,
        proxyFallbackEnabled: config.proxyFallbackEnabled,
        realtimeSourceMode: config.realtimeSourceMode,
      },
      '[FastifyAPI] server started'
    );
  } catch (error) {
    app.log.error({ err: error }, '[FastifyAPI] failed to start');
    process.exit(1);
  }
}

if (require.main === module) {
  void startServer();
}
