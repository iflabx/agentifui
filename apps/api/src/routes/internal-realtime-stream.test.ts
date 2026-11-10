/** @jest-environment node */
import Fastify from 'fastify';
import { type IncomingMessage, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ApiRuntimeConfig } from '../config';
import { subscribeRealtimeEvents } from '../lib/realtime/broker';
import { registerRealtimeSubscription } from '../lib/realtime/subscription-registry';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { internalRealtimeStreamRoutes } from './internal-realtime-stream';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgUserContext: jest.fn(),
}));

jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

jest.mock('../lib/realtime/broker', () => ({
  readRealtimeEventsSince: jest.fn().mockResolvedValue([]),
  subscribeRealtimeEvents: jest.fn(),
}));

jest.mock('../lib/realtime/outbox-dispatcher', () => ({
  ensureRealtimeOutboxDispatcher: jest.fn(),
}));

jest.mock('../lib/realtime/subscription-registry', () => ({
  registerRealtimeSubscription: jest.fn(),
}));

const config: ApiRuntimeConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  corsAllowedOrigins: [],
  nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
  proxyPrefixes: [],
  realtimeSourceMode: 'db-outbox',
  sessionCookieNames: [],
  internalDataProxyTimeoutMs: 30000,
  difyTempConfigEnabled: false,
  difyTempConfigAllowedHosts: [],
  difyTempConfigAllowPrivate: false,
  inputModeration: { enabled: false, app: null },
};

describe('realtime SSE connection management', () => {
  it.each(['close', 'keep-alive'])(
    'respects Connection: %s without interrupting the ready event',
    async connection => {
      jest.clearAllMocks();
      const unsubscribe = jest.fn();
      const unregister = jest.fn();
      jest.mocked(resolveIdentityFromSession).mockResolvedValue({
        kind: 'ok',
        identity: { userId: 'test-user', role: 'user' },
      });
      jest.mocked(subscribeRealtimeEvents).mockResolvedValue(unsubscribe);
      jest.mocked(registerRealtimeSubscription).mockReturnValue(unregister);
      const app = Fastify({ logger: false });
      let streamRequest: IncomingMessage | undefined;
      app.server.on('request', request => {
        streamRequest = request;
      });
      await app.register(internalRealtimeStreamRoutes, { config });

      try {
        await app.listen({ host: '127.0.0.1', port: 0 });
        const { port } = app.server.address() as AddressInfo;
        const result = await new Promise<{
          status?: number;
          connection?: string;
          body: string;
        }>((resolve, reject) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path: '/api/internal/realtime/stream?key=sidebar-conversations:test-user',
              headers: { connection },
              agent: false,
            },
            response => {
              let body = '';
              response.on('data', chunk => {
                body += chunk.toString();
                if (body.includes('\n\n')) {
                  resolve({
                    status: response.statusCode,
                    connection: response.headers.connection,
                    body,
                  });
                  request.destroy();
                }
              });
              response.on('error', reject);
            }
          );
          request.on('error', reject);
          request.setTimeout(3000, () => {
            request.destroy(new Error('Realtime ready event timed out'));
          });
          request.end();
        });

        expect(result.status).toBe(200);
        expect(result.connection).toBe(connection);
        expect(result.body).toContain('event: ready\n');
      } finally {
        streamRequest?.emit('aborted');
        app.server.closeAllConnections();
        await app.close();
      }
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(unregister).toHaveBeenCalledTimes(1);
    }
  );
});
