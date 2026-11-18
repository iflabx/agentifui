/** @jest-environment node */
import { readDifyUpload, saveDifyUpload } from './dify-upload-archive';
import { getObject, putObject } from './storage/minio-s3';

jest.mock('./storage/minio-s3', () => ({
  assertStorageConfigured: jest.fn(),
  getObject: jest.fn(),
  putObject: jest.fn(),
}));

describe('Dify uploaded originals', () => {
  const scope = {
    userId: 'user-1',
    serviceInstanceId: 'app-1',
    fileId: 'upload-1',
  };
  const originalKey = process.env.API_ENCRYPTION_KEY;
  const objects = new Map<string, Buffer>();
  beforeEach(() => {
    jest.clearAllMocks();
    objects.clear();
    process.env.API_ENCRYPTION_KEY = 'synthetic-test-key';
    jest
      .mocked(putObject)
      .mockImplementation(async (namespace, path, content) => {
        objects.set(`${namespace}/${path}`, content);
      });
    jest
      .mocked(getObject)
      .mockImplementation(
        async (namespace, path) => objects.get(`${namespace}/${path}`) ?? null
      );
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.API_ENCRYPTION_KEY;
    else process.env.API_ENCRYPTION_KEY = originalKey;
    jest.useRealTimers();
  });

  it('reads the exact bytes after signed URL expiry without exposing plaintext in object storage', async () => {
    jest.useFakeTimers();
    const content = Buffer.from([0, 255, 20, 128, 3, 10]);
    await saveDifyUpload(
      scope,
      new Blob([content], { type: 'application/pdf' })
    );
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(await readDifyUpload(scope)).toEqual({
      content,
      contentType: 'application/pdf',
    });
    expect(
      [...objects.values()][0].includes(Buffer.from(content.toString('base64')))
    ).toBe(false);
  });

  it('isolates users and applications even for the same upstream ID', async () => {
    await saveDifyUpload(scope, new Blob(['private']));
    expect(await readDifyUpload({ ...scope, userId: 'other' })).toBeNull();
    expect(
      await readDifyUpload({ ...scope, serviceInstanceId: 'other' })
    ).toBeNull();
  });

  it('rejects ciphertext tampering and swapping', async () => {
    await saveDifyUpload(scope, new Blob(['private']));
    const encrypted = [...objects.values()][0];
    encrypted[encrypted.length - 1] ^= 1;
    await expect(readDifyUpload(scope)).rejects.toThrow();
    encrypted[encrypted.length - 1] ^= 1;
    jest.mocked(getObject).mockResolvedValue(encrypted);
    await expect(
      readDifyUpload({ ...scope, userId: 'other' })
    ).rejects.toThrow();
  });
});
