import type { MessageAttachment } from '@lib/stores/chat-store';

const MAX_SCAN_DEPTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toAttachment(
  value: Record<string, unknown>,
  appId?: string
): MessageAttachment | null {
  if (typeof value.upload_file_id !== 'string' || !value.upload_file_id) {
    return null;
  }

  const type =
    typeof value.mime_type === 'string' && value.mime_type
      ? value.mime_type
      : typeof value.type === 'string' && value.type
        ? value.type
        : 'application/octet-stream';

  return {
    id: value.upload_file_id,
    name:
      typeof value.name === 'string' && value.name
        ? value.name
        : value.upload_file_id,
    size: typeof value.size === 'number' ? value.size : 0,
    type,
    upload_file_id: value.upload_file_id,
    ...(typeof value.preview_file_id === 'string'
      ? { preview_file_id: value.preview_file_id }
      : {}),
    ...(typeof value.app_id === 'string'
      ? { app_id: value.app_id }
      : appId
        ? { app_id: appId }
        : {}),
  };
}

export function extractWorkflowInputAttachments(
  inputs: unknown,
  appId?: string
): MessageAttachment[] {
  const attachments: MessageAttachment[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || value == null) return;

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }

    if (!isRecord(value)) return;

    const attachment = toAttachment(value, appId);
    if (attachment && !seen.has(attachment.upload_file_id)) {
      seen.add(attachment.upload_file_id);
      attachments.push(attachment);
      return;
    }

    Object.values(value).forEach(item => visit(item, depth + 1));
  };

  visit(inputs, 0);
  return attachments;
}
