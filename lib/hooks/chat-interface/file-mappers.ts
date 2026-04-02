import type { ChatUploadFile } from '@lib/services/dify/types';
import type { MessageAttachment } from '@lib/stores/chat-store';

import type { DifyLocalFile } from './types';

export function mapChatUploadFilesToMessageAttachments(
  files?: unknown[],
  appId?: string
): MessageAttachment[] | undefined {
  if (!Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  return files.map(file => {
    const uploadFile = file as ChatUploadFile;
    return {
      id: uploadFile.upload_file_id,
      name: uploadFile.name,
      size: uploadFile.size,
      type: uploadFile.mime_type,
      upload_file_id: uploadFile.upload_file_id,
      app_id: appId || undefined,
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
      type: 'document',
      transfer_method: 'local_file',
      upload_file_id: uploadFile.upload_file_id,
    } satisfies DifyLocalFile;
  });
}
