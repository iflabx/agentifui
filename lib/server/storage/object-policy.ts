import crypto from 'node:crypto';

export type StorageNamespace = 'avatars' | 'content-images';

export type StoragePolicy = {
  namespace: StorageNamespace;
  maxBytes: number;
  allowedMimeTypes: string[];
};

const STORAGE_POLICIES: Record<StorageNamespace, StoragePolicy> = {
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
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function normalizeMimeType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') {
    return '';
  }

  return contentType.split(';')[0]?.trim().toLowerCase() || '';
}

function normalizeFileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== 'string') {
    return '';
  }

  const extension = fileName.split('.').pop()?.trim().toLowerCase() || '';
  return extension.replace(/[^a-z0-9]/g, '');
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error('userId is required');
  }
  return normalized;
}

function resolveExtension(fileName: string, contentType: string): string {
  const fromMime = MIME_EXTENSION_MAP[normalizeMimeType(contentType)];
  if (fromMime) {
    return fromMime;
  }

  const fromName = normalizeFileExtension(fileName);
  return fromName || 'bin';
}

export function getStoragePolicy(namespace: StorageNamespace): StoragePolicy {
  return STORAGE_POLICIES[namespace];
}

export function validateUploadInput(
  namespace: StorageNamespace,
  input: {
    contentType: string;
    sizeBytes: number;
  }
): { ok: true } | { ok: false; error: string } {
  const policy = getStoragePolicy(namespace);
  const normalizedType = normalizeMimeType(input.contentType);
  const sizeBytes = Number(input.sizeBytes);

  if (!policy.allowedMimeTypes.includes(normalizedType)) {
    return {
      ok: false,
      error: `Unsupported content type: ${normalizedType || 'unknown'}`,
    };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return {
      ok: false,
      error: 'Invalid file size',
    };
  }

  if (sizeBytes > policy.maxBytes) {
    return {
      ok: false,
      error: `File too large, max ${policy.maxBytes} bytes`,
    };
  }

  return { ok: true };
}

export function buildUserObjectPath(
  namespace: StorageNamespace,
  userId: string,
  fileName: string,
  contentType: string
): string {
  const normalizedUserId = normalizeUserId(userId);
  const extension = resolveExtension(fileName, contentType);

  const objectName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  return `user-${normalizedUserId}/${objectName}`;
}

export function isOwnedObjectPath(filePath: string, userId: string): boolean {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return false;
  }

  const normalizedPath = filePath.trim();
  if (!normalizedPath || normalizedPath.includes('..')) {
    return false;
  }

  return normalizedPath.startsWith(`user-${normalizedUserId}/`);
}

export function assertOwnedObjectPath(
  filePath: string,
  userId: string
): { ok: true } | { ok: false; error: string } {
  if (!isOwnedObjectPath(filePath, userId)) {
    return {
      ok: false,
      error: 'Invalid file path ownership',
    };
  }

  return { ok: true };
}
