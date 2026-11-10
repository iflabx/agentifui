/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgUserContext } from '../lib/pg-context';
import { requireStorageActor } from '../lib/storage/auth';
import {
  buildPublicObjectUrl,
  deleteObject,
  extractPathFromPublicUrl,
  headObject,
} from '../lib/storage/minio-s3';
import { internalStorageAvatarRoutes } from './internal-storage-avatar';

jest.mock('../lib/pg-context', () => ({
  queryRowsWithPgUserContext: jest.fn(),
}));
jest.mock('../lib/storage/auth', () => ({ requireStorageActor: jest.fn() }));
jest.mock('../lib/storage/minio-s3', () => ({
  buildPublicObjectUrl: jest.fn(),
  deleteObject: jest.fn(),
  extractPathFromPublicUrl: jest.fn(),
  headObject: jest.fn(),
  isStoragePublicReadEnabled: () => false,
}));

describe('avatar old-object ownership', () => {
  beforeEach(() => {
    jest.mocked(requireStorageActor).mockResolvedValue({
      ok: true,
      actor: { userId: 'actor', role: 'user' },
    });
    jest.mocked(headObject).mockResolvedValue({
      exists: true,
      contentType: 'image/png',
      contentLength: 10,
      status: 200,
      eTag: null,
      lastModified: null,
    });
    jest
      .mocked(buildPublicObjectUrl)
      .mockReturnValue(
        'https://storage.example.com/avatars/user-actor/new.png'
      );
    jest.mocked(deleteObject).mockResolvedValue(undefined);
  });

  it.each([
    [
      'https://storage.example.com/avatars/user-victim/old.png',
      'user-victim/old.png',
      false,
    ],
    [
      'https://untrusted.example.com/avatars/user-actor/old.png',
      'user-actor/old.png',
      false,
    ],
    [
      'https://storage.example.com/avatars/user-actor/old.png',
      'user-actor/old.png',
      true,
    ],
  ])(
    'handles previous avatar %s without crossing ownership',
    async (oldUrl, oldPath, canDelete) => {
      jest
        .mocked(queryRowsWithPgUserContext)
        .mockResolvedValueOnce([{ avatar_url: oldUrl }])
        .mockResolvedValueOnce([{ id: 'actor' }]);
      jest.mocked(extractPathFromPublicUrl).mockReturnValue(oldPath);
      const app = Fastify({ logger: false });
      await app.register(internalStorageAvatarRoutes, {
        config: {} as ApiRuntimeConfig,
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/internal/storage/avatar',
          payload: { path: 'user-actor/new.png', userId: 'actor' },
        });
        expect(response.statusCode).toBe(200);
        if (canDelete) {
          expect(deleteObject).toHaveBeenCalledWith('avatars', oldPath);
        } else {
          expect(deleteObject).not.toHaveBeenCalled();
        }
      } finally {
        await app.close();
      }
    }
  );

  it('rejects committing another user object before any storage mutation', async () => {
    const app = Fastify({ logger: false });
    await app.register(internalStorageAvatarRoutes, {
      config: {} as ApiRuntimeConfig,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/storage/avatar',
        payload: { path: 'user-victim/avatar.png', userId: 'actor' },
      });
      expect(response.statusCode).toBe(400);
      expect(headObject).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
