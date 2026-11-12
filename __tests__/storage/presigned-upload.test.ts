/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import * as apiStorage from '../../apps/api/src/lib/storage/minio-s3';
import * as webStorage from '../../lib/server/storage/minio-s3';

async function requestObject(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: init.method || 'GET',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () =>
          resolve(
            new Response(
              response.statusCode === 204 ? null : Buffer.concat(chunks),
              {
                status: response.statusCode,
                headers: response.headers as Record<string, string>,
              }
            )
          )
        );
      }
    );
    request.on('error', reject);
    request.setTimeout(5000, () =>
      request.destroy(new Error('Isolated storage request timed out'))
    );
    request.end(init.body ? Buffer.from(init.body as Uint8Array) : undefined);
  });
}

describe.each([
  ['API', apiStorage],
  ['Web', webStorage],
] as const)('%s upload grants against isolated S3', (_name, storage) => {
  const paths: string[] = [];
  let fetchSpy: jest.SpyInstance;
  beforeAll(() => {
    if (
      !process.env.S3_ENDPOINT ||
      !process.env.S3_ACCESS_KEY_ID ||
      !process.env.S3_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        'Configure an isolated S3 test instance explicitly; no development defaults are used'
      );
    }
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((url, init) => requestObject(String(url), init));
  });
  afterEach(async () => {
    for (const path of paths.splice(0))
      await storage.deleteObject('avatars', path);
  });
  afterAll(() => fetchSpy?.mockRestore());

  function grant(path: string, sizeBytes: number) {
    return storage.createPresignedUploadUrl('avatars', path, {
      sizeBytes,
      contentType: 'image/png',
      expiresInSeconds: 60,
    });
  }
  async function put(url: string, body: string, contentType = 'image/png') {
    return requestObject(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: Buffer.from(body),
    });
  }

  it('accepts the declared size/type and rejects changed type or larger bytes before commit', async () => {
    const path = `user-test-${randomUUID()}/avatar.png`;
    paths.push(path);
    const url = grant(path, 4);
    expect((await put(url, 'test')).ok).toBe(true);
    expect((await put(url, 'test', 'text/html')).status).toBe(403);
    expect((await put(url, 'oversized')).status).toBe(403);
    const stored = await requestObject(
      storage.createPresignedDownloadUrl('avatars', path)
    );
    expect(stored.headers.get('content-type')).toBe('image/png');
    expect(await stored.text()).toBe('test');
  });

  it('rejects smaller bodies and missing type without creating an uncommitted object', async () => {
    const path = `user-test-${randomUUID()}/uncommitted.png`;
    paths.push(path);
    const url = grant(path, 4);
    expect((await put(url, 'x')).status).toBe(403);
    expect([400, 403]).toContain(
      (await requestObject(url, { method: 'PUT', body: Buffer.from('test') }))
        .status
    );
    expect(
      (await requestObject(storage.createPresignedDownloadUrl('avatars', path)))
        .status
    ).toBe(404);
  });

  it('restricts a reused URL to the same size and MIME while preserving private signed reads', async () => {
    const path = `user-test-${randomUUID()}/repeat.png`;
    paths.push(path);
    const url = grant(path, 4);
    expect((await put(url, 'test')).ok).toBe(true);
    expect((await put(url, 'next')).ok).toBe(true);
    expect((await put(url, 'longer')).status).toBe(403);
    const signed = storage.createPresignedDownloadUrl('avatars', path);
    expect(await (await requestObject(signed)).text()).toBe('next');
    const unsigned = new URL(signed);
    unsigned.search = '';
    expect((await requestObject(unsigned.toString())).status).toBe(403);
  });
});
