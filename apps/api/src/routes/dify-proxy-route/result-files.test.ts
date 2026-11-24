/** @jest-environment node */
import Fastify from 'fastify';

import { queryRowsWithPgUserContext } from '../../lib/pg-context';
import { handleDifyResultFile, projectDifyResultFiles } from './result-files';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgUserContext: jest.fn(),
}));

const messageId = '00000000-0000-4000-8000-000000000001';
const toolId = '00000000-0000-4000-8000-000000000002';
const toolKey = `${toolId}.png`;
const nativeMessage = {
  message_external_id: 'upstream-message',
  conversation_external_id: 'upstream-conversation',
};
const tool = {
  belongs_to: 'assistant',
  transfer_method: 'tool_file',
  upload_file_id: toolId,
  type: 'image',
  filename: 'chart.png',
  size: 4,
  url: `http://internal.example/files/tools/${toolKey}?timestamp=1&nonce=demo&sign=fresh&extra=unused`,
};
const context: DifyProxyRequestContext = {
  appId: 'external-app',
  slug: ['result-files', messageId, toolKey],
  routePath: '/api/dify/external-app/result-files',
  actor: { userId: 'owner', role: 'user' },
};
const target: DifyProxyTargetConfig = {
  serviceInstanceId: 'canonical-app',
  appInstanceId: 'external-app',
  difyApiUrl: 'https://backend.example/dify/v1',
  difyApiKey: 'synthetic',
  tempConfigUsed: false,
  appType: 'chatflow',
  rawBody: null,
};

function history(files: unknown[], overrides = {}) {
  return Response.json({
    data: [
      {
        id: nativeMessage.message_external_id,
        conversation_id: nativeMessage.conversation_external_id,
        message_files: files,
        ...overrides,
      },
    ],
  });
}

describe('Dify assistant tool result files', () => {
  const readMessage = jest.mocked(queryRowsWithPgUserContext);

  beforeEach(() => readMessage.mockReset().mockResolvedValue([nativeMessage]));
  afterEach(() => jest.restoreAllMocks());

  it('projects confirmed tool files without exposing their signed descriptor URL', async () => {
    const unrelated = { ...tool, transfer_method: 'remote_url' };
    const unsigned = { ...tool, url: `/files/tools/${toolKey}` };
    const mismatch = { ...tool, upload_file_id: 'wrong-file' };
    const input = await history([tool, unrelated, unsigned, mismatch]).json();

    expect(projectDifyResultFiles(input, target)).toEqual({
      data: [
        {
          id: nativeMessage.message_external_id,
          conversation_id: nativeMessage.conversation_external_id,
          message_files: [unrelated, unsigned, mismatch],
          result_files: [
            { key: toolKey, image: true, name: 'chart.png', size: 4 },
          ],
        },
      ],
    });
    expect(
      projectDifyResultFiles(input, { ...target, appType: 'workflow' })
    ).toBe(input);
  });

  it('streams original bytes from the configured origin after paginating owner-scoped history', async () => {
    const bytes = Uint8Array.from([0, 50, 120, 255]);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ has_more: true, data: [{ id: 'cursor' }] })
      )
      .mockResolvedValueOnce(history([tool]))
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { 'Content-Type': 'image/png' } })
      );
    const app = Fastify();
    app.get('/result-file', async (request, reply) => {
      await handleDifyResultFile(request, reply, context, target);
    });
    try {
      const response = await app.inject('/result-file');
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(Buffer.from(bytes));
      expect(response.headers).toMatchObject({
        'cache-control': 'private, no-store',
        'content-type': 'image/png',
        'x-content-type-options': 'nosniff',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://backend.example/dify/v1/messages?conversation_id=upstream-conversation&user=owner&limit=100&first_id=cursor',
        expect.objectContaining({
          redirect: 'error',
          headers: { Authorization: 'Bearer synthetic' },
        })
      );
      expect(String(fetchMock.mock.calls[2][0])).toBe(
        `https://backend.example/dify/files/tools/${toolKey}?timestamp=1&nonce=demo&sign=fresh`
      );
      expect(fetchMock.mock.calls[2][1]).toMatchObject({
        redirect: 'error',
        cache: 'no-store',
      });
      expect(fetchMock.mock.calls[2][1]?.headers).toBeUndefined();
      expect(readMessage).toHaveBeenCalledTimes(2);
      expect(readMessage).toHaveBeenCalledWith(
        'owner',
        'user',
        expect.stringContaining("m.role='assistant'"),
        [messageId, 'owner', ['external-app', 'canonical-app', 'external-app']]
      );
    } finally {
      await app.close();
    }
  });

  it('does not contact upstream if there is no visible owned local reply', async () => {
    readMessage.mockResolvedValue([]);
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(
      handleDifyResultFile(
        { method: 'GET' } as never,
        {} as never,
        context,
        target
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['another native reply', [tool], { id: 'other' }],
    ['another native conversation', [tool], { conversation_id: 'other' }],
    ['ordinary external link', [], { answer: `[file](${tool.url})` }],
    ['user attachment', [{ ...tool, belongs_to: 'user' }], {}],
  ])('does not authorize a tool file from %s', async (_, files, overrides) => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(history(files, overrides));
    await expect(
      handleDifyResultFile(
        { method: 'GET' } as never,
        {} as never,
        context,
        target
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([302, 404])(
    'does not relay an upstream %s response',
    async status => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(history([tool]))
        .mockResolvedValueOnce(
          new Response(null, {
            status,
            headers: { Location: 'https://elsewhere.example/file' },
          })
        );
      await expect(
        handleDifyResultFile(
          { method: 'GET' } as never,
          {} as never,
          context,
          target
        )
      ).rejects.toMatchObject({ statusCode: status === 404 ? 410 : 502 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('drops the stream when access changes while reading upstream', async () => {
    readMessage
      .mockResolvedValueOnce([nativeMessage])
      .mockResolvedValueOnce([]);
    const file = new Response('private bytes');
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(history([tool]))
      .mockResolvedValueOnce(file);
    await expect(
      handleDifyResultFile(
        { method: 'GET' } as never,
        {} as never,
        context,
        target
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(file.bodyUsed).toBe(true);
  });
});
