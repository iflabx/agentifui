import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import {
  assertStorageConfigured,
  getObject,
  putObject,
} from './storage/minio-s3';

export interface DifyUploadScope {
  userId: string;
  serviceInstanceId: string;
  fileId: string;
}

const NAMESPACE = 'dify-uploads';

function archivePath(scope: DifyUploadScope): string {
  return `${createHash('sha256')
    .update(
      JSON.stringify([scope.userId, scope.serviceInstanceId, scope.fileId])
    )
    .digest('hex')}.bin`;
}

function archiveKey(): Buffer {
  const secret = process.env.API_ENCRYPTION_KEY;
  if (!secret)
    throw new Error('API_ENCRYPTION_KEY is required for file storage');
  return createHash('sha256').update(`dify-upload-archive\0${secret}`).digest();
}

export async function saveDifyUpload(
  scope: DifyUploadScope,
  file: Blob
): Promise<void> {
  const path = archivePath(scope);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', archiveKey(), nonce);
  cipher.setAAD(Buffer.from(path));
  const plaintext = Buffer.from(
    JSON.stringify({
      contentType: file.type || 'application/octet-stream',
      content: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  await putObject(
    NAMESPACE,
    path,
    Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]),
    'application/octet-stream'
  );
}

export function assertDifyUploadStorage(): void {
  assertStorageConfigured();
  archiveKey();
}

export async function readDifyUpload(scope: DifyUploadScope): Promise<{
  content: Buffer;
  contentType: string;
} | null> {
  const path = archivePath(scope);
  const encrypted = await getObject(NAMESPACE, path);
  if (!encrypted) return null;
  if (encrypted.length < 30 || encrypted[0] !== 1) {
    throw new Error('Invalid stored file');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    archiveKey(),
    encrypted.subarray(1, 13)
  );
  decipher.setAAD(Buffer.from(path));
  decipher.setAuthTag(encrypted.subarray(13, 29));
  const payload = JSON.parse(
    Buffer.concat([
      decipher.update(encrypted.subarray(29)),
      decipher.final(),
    ]).toString('utf8')
  ) as { content: string; contentType: string };
  return {
    content: Buffer.from(payload.content, 'base64'),
    contentType: payload.contentType,
  };
}
