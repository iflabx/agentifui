/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { requireStorageActor } from '../lib/storage/auth';
import { createPresignedUploadUrl } from '../lib/storage/minio-s3';
import { enforceStoragePresignRateLimit } from '../lib/storage/rate-limit';
import { internalStorageAvatarPresignRoutes } from './internal-storage-avatar-presign';
import { internalStorageContentImagesPresignRoutes } from './internal-storage-content-images-presign';

jest.mock('../lib/storage/auth', () => ({ requireStorageActor: jest.fn() }));
jest.mock('../lib/storage/rate-limit', () => ({
  enforceStoragePresignRateLimit: jest.fn(),
}));
jest.mock('../lib/storage/minio-s3', () => ({
  createPresignedUploadUrl: jest.fn(),
}));

describe.each([
  [
    'avatars',
    '/api/internal/storage/avatar/presign',
    internalStorageAvatarPresignRoutes,
    5 * 1024 * 1024,
  ],
  [
    'content-images',
    '/api/internal/storage/content-images/presign',
    internalStorageContentImagesPresignRoutes,
    10 * 1024 * 1024,
  ],
] as const)('%s upload authorization', (namespace, url, plugin, maxBytes) => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(requireStorageActor).mockResolvedValue({
      ok: true,
      actor: { userId: 'test-user', role: 'admin' },
    });
    jest.mocked(enforceStoragePresignRateLimit).mockResolvedValue(null);
    jest
      .mocked(createPresignedUploadUrl)
      .mockReturnValue('https://storage.example.com/signed');
  });
  async function presign(fileSize: number) {
    const app = Fastify({ logger: false });
    await app.register(plugin, { config: {} as ApiRuntimeConfig });
    try {
      return await app.inject({
        method: 'POST',
        url,
        payload: {
          userId: 'test-user',
          fileName: 'avatar.png',
          contentType: 'image/png',
          fileSize,
        },
      });
    } finally {
      await app.close();
    }
  }
  it('passes validated constraints into the storage signature', async () => {
    expect((await presign(12)).statusCode).toBe(200);
    expect(createPresignedUploadUrl).toHaveBeenCalledWith(
      namespace,
      expect.stringContaining('user-test-user/'),
      {
        sizeBytes: 12,
        contentType: 'image/png',
        expiresInSeconds: 300,
      }
    );
  });
  it.each([0, -1, 1.5])(
    'rejects invalid size %s without a grant',
    async size => {
      expect((await presign(size)).statusCode).toBe(400);
      expect(createPresignedUploadUrl).not.toHaveBeenCalled();
    }
  );
  it('rejects oversized objects before generating a signature', async () => {
    expect((await presign(maxBytes + 1)).statusCode).toBe(400);
    expect(createPresignedUploadUrl).not.toHaveBeenCalled();
  });
});
