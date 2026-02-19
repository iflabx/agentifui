export type StorageNamespace = 'avatars' | 'content-images';

export type StorageUploadPolicy = {
  namespace: StorageNamespace;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
};

export const STORAGE_UPLOAD_POLICIES = {
  avatars: {
    namespace: 'avatars',
    maxBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  },
  'content-images': {
    namespace: 'content-images',
    maxBytes: 10 * 1024 * 1024,
    allowedMimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ],
  },
} as const satisfies Record<StorageNamespace, StorageUploadPolicy>;
