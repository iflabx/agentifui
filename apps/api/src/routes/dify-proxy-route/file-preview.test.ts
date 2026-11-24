/** @jest-environment node */
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  canReadDifyUpload,
  hasDifyUploadReference,
  registerDifyUpload,
} from '../../lib/dify-upload-access';
import { readDifyUpload, saveDifyUpload } from '../../lib/dify-upload-archive';
import { queryRowsWithPgUserContext } from '../../lib/pg-context';
import {
  archiveDifyUploadResponse,
  findDifyFileUrl,
  handleOwnedDifyFilePreview,
} from './file-preview';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

jest.mock('../../lib/dify-upload-archive', () => ({
  readDifyUpload: jest.fn(),
  saveDifyUpload: jest.fn(),
}));
jest.mock('../../lib/dify-upload-access', () => ({
  canReadDifyUpload: jest.fn().mockResolvedValue(true),
  hasDifyUploadReference: jest.fn().mockResolvedValue(false),
  registerDifyUpload: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgUserContext: jest.fn(),
}));

describe('owned Dify file previews', () => {
  const context: DifyProxyRequestContext = {
    appId: 'external-app',
    slug: ['files', 'upload-1', 'preview'],
    routePath: '/api/dify/external-app/files/upload-1/preview',
    actor: { userId: 'user-1', role: 'user' },
  };
  const target: DifyProxyTargetConfig = {
    serviceInstanceId: 'canonical-app',
    appInstanceId: 'external-app',
    difyApiUrl: 'https://dify.example.com/v1',
    difyApiKey: 'synthetic',
    tempConfigUsed: false,
    appType: 'workflow',
    rawBody: null,
  };
  const request = {
    method: 'GET',
    id: 'request-1',
    url: context.routePath,
  } as FastifyRequest;
  function createReply() {
    return {
      header: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  }
  async function responseBytes(reply: FastifyReply) {
    const body = jest.mocked(reply.send).mock
      .calls[0][0] as AsyncIterable<Uint8Array>;
    const bytes: Uint8Array[] = [];
    for await (const chunk of body) bytes.push(chunk);
    return Buffer.concat(bytes);
  }
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(canReadDifyUpload).mockResolvedValue(true);
    jest.mocked(hasDifyUploadReference).mockResolvedValue(false);
    jest.mocked(registerDifyUpload).mockResolvedValue(undefined);
    jest.mocked(readDifyUpload).mockResolvedValue(null);
    jest.mocked(saveDifyUpload).mockResolvedValue(undefined);
    jest.mocked(queryRowsWithPgUserContext).mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps Chatflow uploads independent of storage availability', async () => {
    jest.mocked(saveDifyUpload).mockRejectedValue(new Error('unavailable'));
    const upstream = new Response(
      '{"id":"upload-1","preview_url":"https://dify.example.com/signed"}'
    );
    const form = new FormData();
    form.set('file', new File(['hello'], 'hello.txt'));
    const result = await archiveDifyUploadResponse(upstream, form, context, {
      ...target,
      appType: 'chatflow',
    });
    expect(await result.json()).toEqual({
      id: 'upload-1',
      preview_url: '/api/dify/external-app/files/upload-1/preview',
    });
    expect(registerDifyUpload).toHaveBeenCalled();
    expect(saveDifyUpload).not.toHaveBeenCalled();
  });

  it('returns a controlled unavailable preview for an owned staged upload, never the admin fallback', async () => {
    const reply = createReply();
    expect(
      await handleOwnedDifyFilePreview(request, reply, context, {
        ...target,
        appType: 'chatflow',
      })
    ).toBe(true);
    expect(reply.status).toHaveBeenCalledWith(410);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        app_error: expect.objectContaining({
          code: 'DIFY_FILE_PREVIEW_EXPIRED',
        }),
      })
    );
  });

  it('streams Chatflow history from the configured Dify route without redirecting or accessing S3', async () => {
    jest.mocked(readDifyUpload).mockRejectedValue(new Error('unavailable'));
    jest
      .mocked(queryRowsWithPgUserContext)
      .mockResolvedValueOnce([{ external_id: 'conversation-1' }]);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                inputs: {
                  file: {
                    related_id: 'upload-1',
                    url: 'https://files.example.com/files/upload-1/file-preview?timestamp=123&nonce=abc&sign=fresh&ignored=1',
                  },
                },
                message_files: [],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'Content-Type': 'image/png',
            'Set-Cookie': 'upstream=ignored',
          },
        })
      );
    const reply = createReply();
    expect(
      await handleOwnedDifyFilePreview(request, reply, context, {
        ...target,
        appType: 'chatflow',
      })
    ).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(
        'https://dify.example.com/files/upload-1/file-preview?timestamp=123&nonce=abc&sign=fresh'
      ),
      { redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }
    );
    expect(reply.header).not.toHaveBeenCalledWith(
      'Location',
      expect.anything()
    );
    expect(reply.header).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.anything()
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(reply.header).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store'
    );
    expect(await responseBytes(reply)).toEqual(Buffer.from([1, 2, 3]));
    expect(readDifyUpload).not.toHaveBeenCalled();
    expect(saveDifyUpload).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable Workflow storage from an expired legacy file', async () => {
    jest.mocked(readDifyUpload).mockRejectedValue(new Error('unavailable'));
    await expect(
      handleOwnedDifyFilePreview(request, createReply(), context, target)
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'DIFY_UPLOAD_STORAGE_UNAVAILABLE',
    });
    expect(queryRowsWithPgUserContext).not.toHaveBeenCalled();
  });

  it.each([
    { upstream: () => new Response(null, { status: 404 }), expected: 410 },
    {
      upstream: () =>
        new Response('body', { headers: { 'Content-Length': '9999999999' } }),
      expected: 502,
    },
  ])(
    'does not serve an unavailable or oversized upstream file ($expected)',
    async ({ upstream, expected }) => {
      jest
        .mocked(queryRowsWithPgUserContext)
        .mockResolvedValueOnce([{ external_id: 'conversation-1' }]);
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [
                {
                  message_files: [
                    {
                      upload_file_id: 'upload-1',
                      url: 'https://dify.example.com/files/upload-1/file-preview?sign=fresh',
                    },
                  ],
                },
              ],
            })
          )
        )
        .mockResolvedValueOnce(upstream());
      const reply = createReply();
      const preview = handleOwnedDifyFilePreview(request, reply, context, {
        ...target,
        appType: 'chatbot',
      });
      if (expected === 410) {
        await expect(preview).resolves.toBe(true);
        expect(reply.status).toHaveBeenCalledWith(410);
      } else {
        await expect(preview).rejects.toMatchObject({
          statusCode: expected,
          code: 'DIFY_FILE_READ_FAILED',
        });
        expect(reply.send).not.toHaveBeenCalled();
      }
      expect(reply.header).not.toHaveBeenCalledWith(
        'Location',
        expect.anything()
      );
    }
  );

  it.each(['workflow'])(
    'archives %s uploads and returns a durable authenticated URL',
    async appType => {
      const form = new FormData();
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      form.set('file', file);
      const response = await archiveDifyUploadResponse(
        new Response(
          JSON.stringify({
            id: 'upload-1',
            preview_url:
              'https://dify.example.com/files/upload-1/file-preview?sign=short-lived',
          }),
          {
            status: 201,
            headers: {
              'content-type': 'application/json',
              'content-length': '100',
            },
          }
        ),
        form,
        context,
        { ...target, appType }
      );
      expect(saveDifyUpload).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          serviceInstanceId: 'canonical-app',
          fileId: 'upload-1',
        },
        file
      );
      expect(response.status).toBe(201);
      expect(response.headers.has('content-length')).toBe(false);
      expect((await response.json()).preview_url).toBe(
        '/api/dify/external-app/files/upload-1/preview'
      );
    }
  );

  it('does not report upload success when preserving the original fails', async () => {
    jest
      .mocked(saveDifyUpload)
      .mockRejectedValue(new Error('private storage error'));
    const form = new FormData();
    form.set('file', new Blob(['hello']));
    await expect(
      archiveDifyUploadResponse(
        new Response('{"id":"upload-1"}'),
        form,
        context,
        target
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'DIFY_UPLOAD_STORAGE_UNAVAILABLE',
    });
  });

  it.each(['workflow'])(
    'serves a %s original to its ordinary owner without upstream access',
    async appType => {
      const content = Buffer.from('retained original');
      jest
        .mocked(readDifyUpload)
        .mockResolvedValue({ content, contentType: 'text/plain' });
      const reply = createReply();
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      expect(
        await handleOwnedDifyFilePreview(request, reply, context, {
          ...target,
          appType,
        })
      ).toBe(true);
      expect(readDifyUpload).toHaveBeenCalledWith({
        userId: 'user-1',
        serviceInstanceId: 'canonical-app',
        fileId: 'upload-1',
      });
      expect(reply.send).toHaveBeenCalledWith(content);
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store'
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(queryRowsWithPgUserContext).not.toHaveBeenCalled();
    }
  );

  it('forces active documents to download with a sandbox', async () => {
    jest.mocked(readDifyUpload).mockResolvedValue({
      content: Buffer.from('<svg/>'),
      contentType: 'image/svg+xml',
    });
    const reply = createReply();
    await handleOwnedDifyFilePreview(request, reply, context, target);
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Type',
      'application/octet-stream'
    );
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'none'; sandbox"
    );
  });

  it('rejects deleted or unproven references before reading archived bytes or upstream', async () => {
    jest.mocked(canReadDifyUpload).mockResolvedValue(false);
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(
      handleOwnedDifyFilePreview(request, createReply(), context, target)
    ).rejects.toMatchObject({ statusCode: 404, code: 'DIFY_FILE_NOT_FOUND' });
    expect(readDifyUpload).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes legacy inputs-only files by upload ID, paging past unrelated messages', async () => {
    jest
      .mocked(queryRowsWithPgUserContext)
      .mockResolvedValueOnce([{ external_id: 'conversation-1' }]);
    const freshUrl =
      'https://dify.example.com/files/upload-1/file-preview?sign=fresh';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            has_more: true,
            data: [{ id: 'later-message', inputs: {}, message_files: [] }],
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            has_more: false,
            data: [
              {
                id: 'target-message',
                message_files: [],
                inputs: {
                  files: [
                    {
                      related_id: 'upload-2',
                      url: 'https://dify.example.com/files/upload-2/file-preview?sign=other',
                    },
                    { id: null, related_id: 'upload-1', url: freshUrl },
                  ],
                },
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(new Response('legacy original'));
    const reply = createReply();
    expect(
      await handleOwnedDifyFilePreview(request, reply, context, target)
    ).toBe(true);
    expect(await responseBytes(reply)).toEqual(Buffer.from('legacy original'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const query = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(query.get('user')).toBe('user-1');
    expect(query.get('conversation_id')).toBe('conversation-1');
    expect(query.get('first_id')).toBe('later-message');
    expect(queryRowsWithPgUserContext).toHaveBeenCalledWith(
      'user-1',
      'user',
      expect.stringContaining('c.user_id = $1::uuid'),
      [
        'user-1',
        ['external-app', 'canonical-app', 'external-app'],
        '{"attachments":[{"upload_file_id":"upload-1"}]}',
        null,
        null,
      ]
    );
  });

  it('does not fetch another user or app attachment, including for admins', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.mocked(canReadDifyUpload).mockResolvedValue(false);
    await expect(
      handleOwnedDifyFilePreview(
        request,
        createReply(),
        {
          ...context,
          actor: { userId: 'other', role: 'admin' },
        },
        target
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'DIFY_FILE_NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryRowsWithPgUserContext).not.toHaveBeenCalled();
  });

  it('registers a legacy Workflow file only after scoped archive decryption succeeds', async () => {
    jest.mocked(canReadDifyUpload).mockResolvedValueOnce(false);
    jest.mocked(hasDifyUploadReference).mockResolvedValue(true);
    const content = Buffer.from('synthetic legacy file');
    jest
      .mocked(readDifyUpload)
      .mockResolvedValue({ content, contentType: 'text/plain' });
    const reply = createReply();
    await handleOwnedDifyFilePreview(request, reply, context, target);
    expect(registerDifyUpload).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        serviceInstanceId: 'canonical-app',
        fileId: 'upload-1',
      },
      true
    );
    expect(
      jest.mocked(readDifyUpload).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(registerDifyUpload).mock.invocationCallOrder[0]);
    expect(reply.send).toHaveBeenCalledWith(content);
  });

  it.each(['workflow', 'chatflow'])(
    'does not promote forged historical %s metadata into upload ownership',
    async appType => {
      jest.mocked(canReadDifyUpload).mockResolvedValue(false);
      jest.mocked(hasDifyUploadReference).mockResolvedValue(true);
      jest
        .mocked(queryRowsWithPgUserContext)
        .mockResolvedValue([{ external_id: 'forged-conversation' }]);
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"data":[]}'));
      const reply = createReply();
      await expect(
        handleOwnedDifyFilePreview(request, reply, context, {
          ...target,
          appType,
        })
      ).rejects.toMatchObject({ statusCode: 404, code: 'DIFY_FILE_NOT_FOUND' });
      expect(registerDifyUpload).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    }
  );

  it('requires native current-user history evidence before registering a legacy Chatflow file', async () => {
    jest.mocked(canReadDifyUpload).mockResolvedValueOnce(false);
    jest.mocked(hasDifyUploadReference).mockResolvedValue(true);
    jest
      .mocked(queryRowsWithPgUserContext)
      .mockResolvedValue([{ external_id: 'conversation-1' }]);
    const url =
      'https://dify.example.com/files/upload-1/file-preview?sign=fresh';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ inputs: { file: { related_id: 'upload-1', url } } }],
          })
        )
      )
      .mockResolvedValueOnce(new Response('owned original'));
    const reply = createReply();
    await handleOwnedDifyFilePreview(request, reply, context, {
      ...target,
      appType: 'chatflow',
    });
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('user')
    ).toBe('user-1');
    expect(registerDifyUpload).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      true
    );
    expect(readDifyUpload).not.toHaveBeenCalled();
    expect(await responseBytes(reply)).toEqual(Buffer.from('owned original'));
  });

  it.each(['workflow', 'chatflow'])(
    'rechecks a deleted legacy %s reference before serving',
    async appType => {
      jest.mocked(canReadDifyUpload).mockResolvedValue(false);
      jest.mocked(hasDifyUploadReference).mockResolvedValue(true);
      jest.mocked(readDifyUpload).mockResolvedValue({
        content: Buffer.from('synthetic'),
        contentType: 'text/plain',
      });
      jest
        .mocked(queryRowsWithPgUserContext)
        .mockResolvedValue([{ external_id: 'conversation-1' }]);
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [
                {
                  inputs: {
                    file: {
                      related_id: 'upload-1',
                      url: 'https://dify.example.com/files/upload-1/file-preview?sign=fresh',
                    },
                  },
                },
              ],
            })
          )
        )
        .mockResolvedValueOnce(new Response('owned original'));
      const reply = createReply();
      await expect(
        handleOwnedDifyFilePreview(request, reply, context, {
          ...target,
          appType,
        })
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(reply.send).not.toHaveBeenCalled();
      expect(reply.header).not.toHaveBeenCalled();
    }
  );

  it('reports the legacy Workflow limitation instead of trying to renew a stale run detail', async () => {
    jest
      .mocked(queryRowsWithPgUserContext)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'execution-1' }]);
    const reply = createReply();
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    expect(
      await handleOwnedDifyFilePreview(request, reply, context, {
        ...target,
        appType: 'workflow',
      })
    ).toBe(true);
    expect(reply.status).toHaveBeenCalledWith(410);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        app_error: expect.objectContaining({
          code: 'DIFY_FILE_PREVIEW_EXPIRED',
        }),
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves non-preview methods and temporary provider requests to existing policy', async () => {
    expect(
      await handleOwnedDifyFilePreview(
        { ...request, method: 'POST' } as FastifyRequest,
        createReply(),
        context,
        target
      )
    ).toBe(false);
    expect(
      await handleOwnedDifyFilePreview(request, createReply(), context, {
        ...target,
        tempConfigUsed: true,
      })
    ).toBe(false);
    expect(readDifyUpload).not.toHaveBeenCalled();
  });

  it('does not confuse MessageFile ids, array positions, or mismatched URLs with upload IDs', () => {
    expect(
      findDifyFileUrl(
        [
          {
            id: 'upload-1',
            url: 'https://dify.example.com/files/other/file-preview',
          },
          {
            related_id: 'upload-1',
            url: 'https://dify.example.com/files/other/file-preview',
          },
          { related_id: 'upload-1', url: 'javascript:alert(1)' },
        ],
        'upload-1'
      )
    ).toBeNull();
  });

  it('matches ordinary user message-file URLs without treating the association ID as an upload ID', () => {
    const url =
      'https://dify.example.com/files/upload-1/file-preview?sign=fresh';
    expect(
      findDifyFileUrl(
        {
          message_files: [
            {
              id: 'message-file-1',
              belongs_to: 'user',
              url,
            },
          ],
        },
        'upload-1'
      )
    ).toBe(url);
    expect(
      findDifyFileUrl(
        {
          message_files: [
            {
              id: 'message-file-1',
              belongs_to: 'user',
              url,
            },
          ],
        },
        'message-file-1'
      )
    ).toBeNull();
  });
});
