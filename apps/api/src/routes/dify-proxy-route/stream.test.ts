/** @jest-environment node */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Writable } from 'node:stream';

import { sendUpstreamStream } from './stream';

it.each(['sse', 'media'] as const)(
  'preserves server task headers when taking over a %s response',
  async streamKind => {
    const server = Fastify({ logger: false });
    const content =
      streamKind === 'sse' ? 'data: {"event":"message_end"}\n\n' : 'file';
    server.get('/stream', async (request, reply) => {
      reply.header('x-agentifui-root-task-id', 'trusted-task');
      reply.header('x-request-id', request.id);
      await sendUpstreamStream(
        request,
        reply,
        new Response(content, {
          headers: {
            'content-type':
              streamKind === 'sse'
                ? 'text/event-stream'
                : 'application/octet-stream',
            'x-agentifui-root-task-id': 'untrusted-upstream-task',
          },
        }),
        {
          appId: 'synthetic-app',
          routePath: '/stream',
          slugPath: 'chat-messages',
          streamKind,
          requestStartedAt: Date.now(),
          responseHeaderElapsedMs: 0,
          targetHost: 'upstream.example.invalid',
          targetOrigin: 'https://upstream.example.invalid',
          allow: key => key === 'content-type',
        }
      );
    });
    try {
      const response = await server.inject('/stream');
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-agentifui-root-task-id']).toBe('trusted-task');
      expect(response.headers['x-request-id']).toBeTruthy();
      expect(response.body).toBe(content);
    } finally {
      await server.close();
    }
  }
);

it('closes a failed upstream stream without logging exception details', async () => {
  const privateFixture = 'sensitive-stream-error-fixture';
  const raw = Object.assign(
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    {
      headersSent: true,
      setHeader: jest.fn(),
      hasHeader: jest.fn().mockReturnValue(false),
      flushHeaders: jest.fn(),
    }
  );
  const request = {
    id: 'stream-privacy-request',
    log: { info: jest.fn(), warn: jest.fn() },
  } as unknown as FastifyRequest;
  const reply = {
    raw,
    hijack: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({}),
  } as unknown as FastifyReply;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(
          new Error(privateFixture, { cause: new Error(privateFixture) })
        );
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );

  await sendUpstreamStream(request, reply, response, {
    appId: 'app-1',
    routePath: '/api/dify/app-1/chat-messages',
    slugPath: 'chat-messages',
    streamKind: 'sse',
    requestStartedAt: Date.now(),
    responseHeaderElapsedMs: 1,
    targetHost: 'upstream.example.com',
    targetOrigin: 'https://upstream.example.com',
    allow: () => false,
  });

  const failed = jest
    .mocked(request.log.warn)
    .mock.calls.find(
      call => call[1] === '[FastifyDifyProxy] upstream stream failed'
    )?.[0];
  expect(failed).toMatchObject({
    requestId: 'stream-privacy-request',
    upstreamStatus: 200,
  });
  expect(failed).not.toHaveProperty('err');
  expect(
    JSON.stringify(jest.mocked(request.log.warn).mock.calls)
  ).not.toContain(privateFixture);
  expect(raw.destroyed).toBe(true);
  expect(raw.listeners('close').map(listener => listener.name)).not.toContain(
    'handleResponseClose'
  );
});
