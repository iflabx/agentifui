import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import {
  isRealtimeOutboxBusy,
  setRealtimeOutboxPaused,
} from './realtime/outbox-dispatcher';

const CONTROL_PATH = '/__agentifui/capacity';
const REALTIME_PATH = '/api/internal/realtime/stream';

export function installCapacityControl(
  app: FastifyInstance,
  token = process.env.APP_CAPACITY_TOKEN
): void {
  if (!token) return;
  if (token.length < 32)
    throw new Error('APP_CAPACITY_TOKEN must contain at least 32 characters');

  const requests = new Set<ServerResponse>();
  const subscriptions = new Set<ServerResponse>();
  let draining = false;
  const authorized = (request: FastifyRequest) => {
    const address = request.socket.remoteAddress;
    const candidate = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return (
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '') &&
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  };

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname === CONTROL_PATH || pathname === '/healthz') return;
    if (draining) {
      reply.header('Retry-After', '1');
      return reply.status(503).send({ error: 'Instance is draining' });
    }
    const collection = pathname === REALTIME_PATH ? subscriptions : requests;
    collection.add(reply.raw);
    const release = () => {
      collection.delete(reply.raw);
      reply.raw.removeListener('finish', release);
      reply.raw.removeListener('close', release);
    };
    reply.raw.once('finish', release);
    reply.raw.once('close', release);
  });

  app.get(CONTROL_PATH, async (request, reply) => {
    if (!authorized(request)) return reply.status(404).send();
    return {
      draining,
      activeRequests: requests.size,
      subscriptions: subscriptions.size,
      backgroundTasks: isRealtimeOutboxBusy() ? 1 : 0,
    };
  });
  app.post<{ Body: { draining: boolean } }>(
    CONTROL_PATH,
    async (request, reply) => {
      if (!authorized(request)) return reply.status(404).send();
      if (typeof request.body?.draining !== 'boolean')
        return reply.status(400).send({ error: 'draining must be boolean' });
      draining = request.body.draining;
      setRealtimeOutboxPaused(draining);
      if (draining) {
        for (const response of subscriptions) response.end();
      }
      return {
        draining,
        activeRequests: requests.size,
        subscriptions: subscriptions.size,
        backgroundTasks: isRealtimeOutboxBusy() ? 1 : 0,
      };
    }
  );
}
