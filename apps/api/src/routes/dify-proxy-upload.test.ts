/** @jest-environment node */
import Fastify, { type HTTPMethods } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { resolveDifyConfig } from '../lib/dify-config';
import { fetchWithDifyProxyResilience } from '../lib/dify-proxy-resilience';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { difyProxyRoutes } from './dify-proxy';
import { handleDifyProxy } from './dify-proxy-route/handler';

jest.mock('./dify-proxy-route/handler', () => ({
  handleDifyProxy: jest.fn(),
}));

jest.mock('./dify-proxy-route/ops-route', () => ({
  handleDifyResilienceOps: jest.fn(),
}));

jest.mock('../lib/dify-config', () => ({
  resolveDifyConfig: jest.fn(),
}));

jest.mock('../lib/dify-proxy-resilience', () => ({
  DifyProxyRequestError: jest.requireActual('../lib/dify-proxy-resilience')
    .DifyProxyRequestError,
  fetchWithDifyProxyResilience: jest.fn(),
  getDifyProxyCircuitSnapshot: jest.fn().mockReturnValue({}),
}));

jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(),
}));

jest.mock('../lib/error-events', () => ({
  recordApiErrorEvent: jest.fn().mockResolvedValue(undefined),
}));

const UPLOAD_PATHS = ['files/upload', 'audio-to-text'];
const MULTIPART_CONTENT_TYPE = 'multipart/form-data; boundary=test-boundary';

function createMultipartBody(totalBytes: number): Buffer {
  const prefix = Buffer.from(
    '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
  );
  const suffix = Buffer.from('\r\n--test-boundary--\r\n');
  return Buffer.concat([
    prefix,
    Buffer.alloc(totalBytes - prefix.length - suffix.length, 97),
    suffix,
  ]);
}

function createApp() {
  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    /^multipart\/form-data(?:;.*)?$/i,
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body)
  );
  app.register(difyProxyRoutes, {
    config: {
      inputModeration: { enabled: false, app: null },
    } as ApiRuntimeConfig,
  });
  return app;
}

describe('Dify route-specific upload limits', () => {
  const originalUploadMaxBytes = process.env.DIFY_UPLOAD_MAX_BYTES;
  const originalFetch = global.fetch;
  const mockedHandleDifyProxy = jest.mocked(handleDifyProxy);

  beforeEach(() => {
    delete process.env.DIFY_UPLOAD_MAX_BYTES;
    jest.clearAllMocks();
    mockedHandleDifyProxy.mockImplementation(async (request, reply) => {
      reply.header('x-test-body-limit', String(request.routeOptions.bodyLimit));
      reply.status(202).send({
        receivedBytes: Buffer.isBuffer(request.body) ? request.body.length : 0,
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUploadMaxBytes === undefined) {
      delete process.env.DIFY_UPLOAD_MAX_BYTES;
    } else {
      process.env.DIFY_UPLOAD_MAX_BYTES = originalUploadMaxBytes;
    }
  });

  it.each(UPLOAD_PATHS)(
    'accepts multipart bodies above 1 MiB at POST %s by default',
    async path => {
      const app = createApp();
      const totalBytes = 1024 * 1024 + 1;
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/api/dify/app-1/${path}`,
          headers: { 'content-type': MULTIPART_CONTENT_TYPE },
          payload: createMultipartBody(totalBytes),
        });
        expect(response.statusCode).toBe(202);
        expect(response.json()).toEqual({ receivedBytes: totalBytes });
        expect(response.headers['x-test-body-limit']).toBe(
          String(16 * 1024 * 1024)
        );
        expect(app.initialConfig.bodyLimit).toBe(1024 * 1024);
        expect(mockedHandleDifyProxy).toHaveBeenCalledTimes(1);
        expect(mockedHandleDifyProxy.mock.calls[0][0].params).toEqual({
          appId: 'app-1',
          '*': path,
        });
      } finally {
        await app.close();
      }
    }
  );

  it.each(UPLOAD_PATHS)(
    'passes POST %s through the real request context and upstream binding',
    async path => {
      const actor = {
        userId: '00000000-0000-4000-8000-000000000123',
        role: 'user',
      };
      jest.mocked(resolveIdentityFromSession).mockResolvedValue({
        kind: 'ok',
        identity: actor,
      });
      jest.mocked(resolveDifyConfig).mockResolvedValue({
        serviceInstanceId: '00000000-0000-4000-8000-000000000456',
        appId: 'app-1',
        apiKey: 'synthetic-test-key',
        apiUrl: 'https://upstream.invalid/v1',
        appType: 'workflow',
      });
      jest
        .mocked(fetchWithDifyProxyResilience)
        .mockImplementation(async input => ({
          ok: true,
          response: await input.execute(new AbortController().signal),
          elapsedMs: 0,
          circuitStatus: 'closed',
        }));
      const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
      const status = path === 'files/upload' ? 201 : 200;
      mockedFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 'file-1', text: 'transcription' }), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      );
      global.fetch = mockedFetch;
      mockedHandleDifyProxy.mockImplementation(
        jest.requireActual<typeof import('./dify-proxy-route/handler')>(
          './dify-proxy-route/handler'
        ).handleDifyProxy
      );

      const content = new Uint8Array(1024 * 1024 + 1).fill(255);
      const form = new FormData();
      form.append('user', 'victim');
      form.append('user', 'other');
      form.append('language', 'en');
      form.append(
        'file',
        new Blob([content], { type: 'application/octet-stream' }),
        'test.bin'
      );
      const upload = new Request('https://upstream.invalid', {
        method: 'POST',
        body: form,
      });
      const app = createApp();
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/api/dify/app-1/${path}?user=victim&user=other&language=en`,
          headers: { 'content-type': upload.headers.get('content-type')! },
          payload: Buffer.from(await upload.arrayBuffer()),
        });
        expect(response.statusCode).toBe(status);
        expect(mockedHandleDifyProxy.mock.calls[0][0].params).toEqual({
          appId: 'app-1',
          '*': path,
        });
        expect(resolveIdentityFromSession).toHaveBeenCalledTimes(1);
        expect(resolveDifyConfig).toHaveBeenCalledWith('app-1', {
          actorUserId: actor.userId,
          actorRole: actor.role,
        });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(mockedFetch).toHaveBeenCalledWith(
          `https://upstream.invalid/v1/${path}?user=${actor.userId}&language=en`,
          expect.objectContaining({ method: 'POST', redirect: 'manual' })
        );
        const requestInit = mockedFetch.mock.calls[0][1]!;
        expect(requestInit.body).toBeInstanceOf(FormData);
        const forwarded = requestInit.body as FormData;
        expect(forwarded.getAll('user')).toEqual([actor.userId]);
        expect(forwarded.get('language')).toBe('en');
        const file = forwarded.get('file') as File;
        expect(file.name).toBe('test.bin');
        expect(file.type).toBe('application/octet-stream');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(content);
        expect((requestInit.headers as Headers).has('content-type')).toBe(
          false
        );
      } finally {
        await app.close();
      }
    }
  );

  it.each(UPLOAD_PATHS)(
    'enforces the configured total multipart boundary at POST %s',
    async path => {
      process.env.DIFY_UPLOAD_MAX_BYTES = '2048';
      const app = createApp();
      try {
        const accepted = await app.inject({
          method: 'POST',
          url: `/api/dify/app-1/${path}`,
          headers: { 'content-type': MULTIPART_CONTENT_TYPE },
          payload: createMultipartBody(2048),
        });
        expect(accepted.statusCode).toBe(202);
        expect(accepted.json()).toEqual({ receivedBytes: 2048 });
        expect(accepted.headers['x-test-body-limit']).toBe('2048');
        const rejected = await app.inject({
          method: 'POST',
          url: `/api/dify/app-1/${path}`,
          headers: { 'content-type': MULTIPART_CONTENT_TYPE },
          payload: createMultipartBody(2049),
        });
        expect(rejected.statusCode).toBe(413);
        expect(mockedHandleDifyProxy).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    }
  );

  it.each([
    '/api/dify/app-1',
    '/api/dify/app-1/chat-messages',
    '/api/dify/app-1/files/upload-extra',
    '/api/dify/app-1/audio-to-text/extra',
  ])('keeps the default POST body limit for %s', async url => {
    const app = createApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': MULTIPART_CONTENT_TYPE },
        payload: createMultipartBody(1024 * 1024 + 1),
      });
      expect(response.statusCode).toBe(413);
      expect(mockedHandleDifyProxy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(
    UPLOAD_PATHS.flatMap(path =>
      (['PUT', 'PATCH', 'DELETE'] as HTTPMethods[]).map(method => ({
        path,
        method,
      }))
    )
  )('does not raise the limit for $method $path', async ({ path, method }) => {
    const app = createApp();
    try {
      const response = await app.inject({
        method,
        url: `/api/dify/app-1/${path}`,
        headers: { 'content-type': MULTIPART_CONTENT_TYPE },
        payload: createMultipartBody(1024 * 1024 + 1),
      });
      expect(response.statusCode).toBe(413);
      expect(mockedHandleDifyProxy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(
    UPLOAD_PATHS.flatMap(path =>
      (['GET', 'HEAD', 'OPTIONS'] as HTTPMethods[]).map(method => ({
        path,
        method,
      }))
    )
  )(
    'retains the default route limit for $method $path',
    async ({ path, method }) => {
      const app = createApp();
      try {
        const response = await app.inject({
          method,
          url: `/api/dify/app-1/${path}`,
        });
        expect(response.statusCode).toBe(202);
        expect(response.headers['x-test-body-limit']).toBe(String(1024 * 1024));
      } finally {
        await app.close();
      }
    }
  );

  it('accepts the minimum configured limit', async () => {
    process.env.DIFY_UPLOAD_MAX_BYTES = '1024';
    const app = createApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/dify/app-1/files/upload',
        headers: { 'content-type': MULTIPART_CONTENT_TYPE },
        payload: createMultipartBody(1024),
      });
      expect(response.statusCode).toBe(202);
      expect(response.headers['x-test-body-limit']).toBe('1024');
    } finally {
      await app.close();
    }
  });

  it.each([
    '',
    ' ',
    '0',
    '-1',
    '1023',
    '1.5',
    'Infinity',
    'NaN',
    '2048bytes',
    '1e6',
    '0x1000',
    '9007199254740992',
  ])('fails startup for invalid DIFY_UPLOAD_MAX_BYTES=%j', async value => {
    process.env.DIFY_UPLOAD_MAX_BYTES = value;
    const app = createApp();
    try {
      await expect(app.ready()).rejects.toThrow('DIFY_UPLOAD_MAX_BYTES');
      expect(mockedHandleDifyProxy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
