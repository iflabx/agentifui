import { createCipheriv, createHash, randomBytes } from 'node:crypto';

export function buildAssistantPreview(content: string): string {
  const withoutThink = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .trim();
  const previewBase = withoutThink || content;
  if (previewBase.length <= 100) {
    return previewBase;
  }
  return `${previewBase.slice(0, 100)}...`;
}

export function encryptApiKeyValue(value: string, masterKey: string): string {
  const hash = createHash('sha256');
  hash.update(masterKey);
  const key = hash.digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
