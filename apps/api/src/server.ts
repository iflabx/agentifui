import cors from '@fastify/cors';
import Fastify from 'fastify';

import { type ApiRuntimeConfig, loadApiRuntimeConfig } from './config';
import {
  REQUEST_ID_HEADER,
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  normalizeLegacyErrorEnvelope,
} from './lib/app-error';
import { installCapacityControl } from './lib/capacity-control';
import { recordApiErrorEvent } from './lib/error-events';
import { resolveRuntimeContentDir } from './lib/runtime-content';
import { adminAuthFallbackPolicyRoutes } from './routes/admin-auth-fallback-policy';
import { adminAuthFallbackPolicyUserRoutes } from './routes/admin-auth-fallback-policy-user';
import { adminEncryptRoutes } from './routes/admin-encrypt';
import { adminStatusRoutes } from './routes/admin-status';
import { adminTranslationsRoutes } from './routes/admin-translations';
import { adminUsersRoutes } from './routes/admin-users';
import { adminUsersForGroupRoutes } from './routes/admin-users-for-group';
import { contentPagesRoutes } from './routes/content-pages';
import { difyProxyRoutes } from './routes/dify-proxy';
import { healthRoutes } from './routes/health';
import { internalAppsRoutes } from './routes/internal-apps';
import { internalDataRoutes } from './routes/internal-data';
import { internalDifyConfigRoutes } from './routes/internal-dify-config';
import { internalErrorEventsClientRoutes } from './routes/internal-error-events-client';
import { internalProfileRoutes } from './routes/internal-profile';
import { internalRealtimeStatsRoutes } from './routes/internal-realtime-stats';
import { internalRealtimeStreamRoutes } from './routes/internal-realtime-stream';
import { internalStorageAvatarRoutes } from './routes/internal-storage-avatar';
import { internalStorageAvatarPresignRoutes } from './routes/internal-storage-avatar-presign';
import { internalStorageContentImagesRoutes } from './routes/internal-storage-content-images';
import { internalStorageContentImagesPresignRoutes } from './routes/internal-storage-content-images-presign';
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
      serializers: {
        req: request => ({
          method: request.method,
          url: request.url?.split('?')[0],
        }),
        err: error => ({
          type: 'Error',
          message: 'Request failed',
          stack: '',
          statusCode: resolveHttpStatusCode(error),
        }),
      },
    },
    trustProxy: true,
  });
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
    const statusCode = resolveHttpStatusCode(error);
    const route = request.routeOptions.url || request.url.split('?')[0];
    request.log.error(
      { statusCode, route, method: request.method },
      '[FastifyAPI] request failed'
    );
    if (reply.sent) {
      return;
    }
    const detail = buildApiErrorDetail({
      status: statusCode,
      source: 'fastify-api',
      requestId: request.id,
      userMessage: 'Fastify API internal error',
    });
    const payload = buildApiErrorEnvelope(detail, 'Fastify API internal error');
    void recordApiErrorEvent({
      detail,
      statusCode,
      method: request.method,
      route,
    }).catch(() => {
      request.log.warn(
        { requestId: request.id },
        '[FastifyAPI] failed to record global error event'
      );
    });
    reply.header(REQUEST_ID_HEADER, request.id);
    reply.status(statusCode).send(payload);
  });

  installCapacityControl(app);

  // Keep legacy multipart requests reachable so storage routes can return
  // explicit compatibility errors (410/501) instead of Fastify's default 415.
  app.addContentTypeParser(
    /^multipart\/form-data(?:;.*)?$/i,
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    }
  );

  await app.register(cors, {
    origin:
      config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : false,
    credentials: true,
  });
  await app.register(adminAuthFallbackPolicyRoutes, { config });
  await app.register(adminAuthFallbackPolicyUserRoutes, { config });
  await app.register(adminEncryptRoutes, { config });
  await app.register(adminStatusRoutes, { config });
  await app.register(adminTranslationsRoutes, { config });
  await app.register(adminUsersRoutes, { config });
  await app.register(adminUsersForGroupRoutes, { config });
  await app.register(contentPagesRoutes, { config });
  await app.register(difyProxyRoutes, { config });
  await app.register(healthRoutes, { config });
  await app.register(internalAppsRoutes, { config });
  await app.register(internalDataRoutes, { config });
  await app.register(internalDifyConfigRoutes, { config });
  await app.register(internalErrorEventsClientRoutes, { config });
  await app.register(internalProfileRoutes, { config });
  await app.register(internalRealtimeStreamRoutes, { config });
  await app.register(internalRealtimeStatsRoutes, { config });
  await app.register(internalStorageAvatarPresignRoutes, { config });
  await app.register(internalStorageAvatarRoutes, { config });
  await app.register(internalStorageContentImagesPresignRoutes, { config });
  await app.register(internalStorageContentImagesRoutes, { config });
  await app.register(translationsRoutes);

  return app;
}

async function startServer() {
  const config = loadApiRuntimeConfig();
  resolveRuntimeContentDir('messages');
  resolveRuntimeContentDir('content/pages');
  const app = await createApiServer(config);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 55000);
      deadline.unref();
      void app.close().then(
        () => process.exit(0),
        error => {
          app.log.error({ err: error }, '[FastifyAPI] shutdown failed');
          process.exit(1);
        }
      );
    });
  }
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
