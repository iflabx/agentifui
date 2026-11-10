/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { resolveIdentityFromSession } from '../../lib/session-identity';
import { resolveProxyRequestContext } from './request-context';

jest.mock('../../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

describe('Dify decoded path validation', () => {
  it.each([
    ['chat-messages', 200],
    ['chat-messages%3Fignored=1', 400],
    ['chat-messages%23ignored', 400],
    ['chat-messages%253Fignored', 400],
    ['files/..%2Fchat-messages', 400],
  ])(
    'validates %s before authorization or upstream dispatch',
    async (path, status) => {
      jest.mocked(resolveIdentityFromSession).mockResolvedValue({
        kind: 'ok',
        identity: { userId: 'actor', role: 'user' },
      });
      const app = Fastify({ logger: false });
      app.post('/api/dify/:appId/*', async (request, reply) => {
        const result = await resolveProxyRequestContext(
          request,
          {} as ApiRuntimeConfig
        );
        return result.ok
          ? { ok: true }
          : reply.status(result.status).send(result.payload);
      });
      try {
        const result = await app.inject({
          method: 'POST',
          url: `/api/dify/app/${path}`,
        });
        expect(result.statusCode).toBe(status);
        if (status === 400)
          expect(resolveIdentityFromSession).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );
});
