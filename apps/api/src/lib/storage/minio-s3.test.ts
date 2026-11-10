/** @jest-environment node */
import crypto from 'node:crypto';

import * as webStorage from '../../../../../lib/server/storage/minio-s3';
import * as apiStorage from './minio-s3';

function expectedSignature(url: URL, method: string): string {
  const dateTime = url.searchParams.get('X-Amz-Date')!;
  const dateStamp = dateTime.slice(0, 8);
  const scope = `${dateStamp}/us-east-1/s3/aws4_request`;
  const query = new URLSearchParams(url.searchParams);
  query.delete('X-Amz-Signature');
  query.sort();
  const canonicalQuery = [...query.entries()]
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const requestHash = crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, requestHash].join(
    '\n'
  );
  const dateKey = crypto
    .createHmac('sha256', 'AWS4test-secret')
    .update(dateStamp)
    .digest();
  const regionKey = crypto
    .createHmac('sha256', dateKey)
    .update('us-east-1')
    .digest();
  const serviceKey = crypto
    .createHmac('sha256', regionKey)
    .update('s3')
    .digest();
  const signingKey = crypto
    .createHmac('sha256', serviceKey)
    .update('aws4_request')
    .digest();
  return crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');
}

describe.each([
  ['API', apiStorage],
  ['Web', webStorage],
] as const)('%s storage endpoints', (_name, storage) => {
  const keys = [
    'S3_ENDPOINT',
    'S3_PRESIGN_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_REGION',
    'S3_PUBLIC_BASE_URL',
  ];
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.S3_ENDPOINT = 'http://storage.internal:9000';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'test-access';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
    process.env.S3_REGION = 'us-east-1';
    delete process.env.S3_PRESIGN_ENDPOINT;
    delete process.env.S3_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    jest.restoreAllMocks();
  });

  it('keeps the internal endpoint as the backwards-compatible signing default', () => {
    const url = new URL(
      storage.createPresignedUploadUrl('avatars', 'user-test/avatar.png')
    );
    expect(url.origin).toBe('http://storage.internal:9000');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      expectedSignature(url, 'PUT')
    );
  });

  it.each(['PUT', 'GET'])(
    'signs %s with the browser endpoint host and port',
    method => {
      process.env.S3_PRESIGN_ENDPOINT = 'https://objects.example.com:8443';
      const signed =
        method === 'PUT'
          ? storage.createPresignedUploadUrl(
              'avatars',
              'user-test/avatar one.png'
            )
          : storage.createPresignedDownloadUrl(
              'avatars',
              'user-test/avatar one.png',
              { responseContentType: 'image/png' }
            );
      const url = new URL(signed);
      expect(url.origin).toBe('https://objects.example.com:8443');
      expect(url.pathname).toBe(
        '/test-bucket/avatars/user-test/avatar%20one.png'
      );
      expect(url.searchParams.get('X-Amz-Signature')).toBe(
        expectedSignature(url, method)
      );
      const rewritten = new URL(signed);
      rewritten.host = 'storage.internal:9000';
      expect(url.searchParams.get('X-Amz-Signature')).not.toBe(
        expectedSignature(rewritten, method)
      );
    }
  );

  it('continues using the internal endpoint for server-side object checks', async () => {
    process.env.S3_PRESIGN_ENDPOINT = 'https://objects.example.com:8443';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    );
    await storage.headObject('avatars', 'user-test/avatar.png');
    expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe(
      'http://storage.internal:9000'
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('HEAD');
  });

  it('keeps public object URLs independent of the presign endpoint', () => {
    process.env.S3_PRESIGN_ENDPOINT = 'https://uploads.example.com';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com/test-bucket';
    expect(
      storage.buildPublicObjectUrl('avatars', 'user-test/avatar.png')
    ).toBe('https://cdn.example.com/test-bucket/avatars/user-test/avatar.png');
  });
});
