import type { ChatUploadFile } from '@lib/services/dify/types';
import type { MessageAttachment } from '@lib/stores/chat-store';

import { inputFileType } from '../../../packages/shared/src/agent-input';
import type { DifyLocalFile } from './types';

export function collectChatDisplayFiles(
  files?: unknown[],
  inputs?: Record<string, unknown>
): unknown[] | undefined {
  const candidates = [...(files || [])];
  for (const value of Object.values(inputs || {}))
    candidates.push(...(Array.isArray(value) ? value : [value]));
  const seen = new Set<string>();
  const attachments = candidates.filter(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const id = (value as Record<string, unknown>).upload_file_id;
    if (typeof id !== 'string' || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return attachments.length ? attachments : undefined;
}

export function mapChatUploadFilesToMessageAttachments(
  files?: unknown[],
  appId?: string
): MessageAttachment[] | undefined {
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  return files.map(file => {
    const uploadFile = file as ChatUploadFile & { app_id?: string };
    return {
      id: uploadFile.upload_file_id,
      name: uploadFile.name,
      size: uploadFile.size,
      type: uploadFile.mime_type,
      upload_file_id: uploadFile.upload_file_id,
      ...(uploadFile.preview_url
        ? { preview_url: uploadFile.preview_url }
        : {}),
      app_id: uploadFile.app_id || appId || undefined,
    };
  });
}

export function mapChatUploadFilesToDifyFiles(
  files?: unknown[]
): DifyLocalFile[] | undefined {
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  return files.map(file => {
    const uploadFile = file as ChatUploadFile;
    return {
      type: inputFileType(uploadFile.name, uploadFile.mime_type),
      transfer_method: 'local_file',
      upload_file_id: uploadFile.upload_file_id,
    } satisfies DifyLocalFile;
  });
}
