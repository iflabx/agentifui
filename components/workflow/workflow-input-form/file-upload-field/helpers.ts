import { formatBytes } from '@lib/utils';

import {
  type AgentAttachmentSlot,
  inputFileExtensionsForSlot,
  inputFileType,
} from '../../../../packages/shared/src/agent-input';

export interface WorkflowUploadOwner {
  app_id: string;
  actor_id: string;
  actor_epoch: number;
}

export function isWorkflowUploadOwner(
  value: unknown,
  owner: WorkflowUploadOwner
): boolean {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    file.app_id === owner.app_id &&
    file.actor_id === owner.actor_id &&
    file.actor_epoch === owner.actor_epoch
  );
}

export interface UploadFile extends Partial<WorkflowUploadOwner> {
  id: string;
  file?: File;
  reference?: Record<string, unknown>;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  uploadedId?: string;
  previewUrl?: string;
}

export type FileUploadFieldConfig = {
  enabled?: boolean;
  max_length?: number;
  number_limits?: number;
  allowed_file_types?: string[];
  max_file_size_mb?: number;
};

type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export function isProcessedFileItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const record = item as Record<string, unknown>;
  return typeof record.upload_file_id === 'string';
}

export function createUploadFiles(files: File[]): UploadFile[] {
  return files.map(file => ({
    id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    status: 'pending',
    progress: 0,
  }));
}

export function restoreUploadFiles(
  values: unknown[],
  owner: WorkflowUploadOwner,
  restoreScope?: WorkflowUploadOwner
): UploadFile[] {
  const allowHistoricalEpoch =
    restoreScope && isWorkflowUploadOwner(restoreScope, owner);
  const seen = new Set<string>();
  return values.flatMap(value => {
    if (!isProcessedFileItem(value)) return [];
    const reference = value as Record<string, unknown>;
    const uploadedId = reference.upload_file_id as string;
    if (
      !uploadedId ||
      seen.has(uploadedId) ||
      reference.app_id !== owner.app_id ||
      reference.actor_id !== owner.actor_id ||
      (!allowHistoricalEpoch && !isWorkflowUploadOwner(reference, owner))
    )
      return [];
    seen.add(uploadedId);
    return [
      {
        ...owner,
        id: `saved-${uploadedId}`,
        uploadedId,
        reference: { ...reference, ...owner },
        name: typeof reference.name === 'string' ? reference.name : uploadedId,
        size: typeof reference.size === 'number' ? reference.size : NaN,
        type:
          typeof reference.mime_type === 'string' ? reference.mime_type : '',
        status: 'success' as const,
        progress: 100,
      },
    ];
  });
}

export function getDifyFileType(
  file: Pick<UploadFile, 'type'> & { name?: string }
): 'image' | 'document' | 'audio' | 'video' | 'custom' {
  if (file.name) return inputFileType(file.name, file.type);
  const mime = file.type.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (
    mime === 'application/pdf' ||
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('csv') ||
    mime.includes('text') ||
    mime.includes('html') ||
    mime.includes('xml') ||
    mime.includes('epub') ||
    mime.includes('powerpoint')
  ) {
    return 'document';
  }

  return 'custom';
}

export function getSuccessfulFilesPayload(
  uploadFiles: UploadFile[],
  isSingleFileMode: boolean,
  owner?: WorkflowUploadOwner
) {
  const successfulFiles = uploadFiles
    .filter(
      file =>
        file.status === 'success' &&
        file.uploadedId &&
        (!owner || isWorkflowUploadOwner(file, owner))
    )
    .map(file =>
      file.reference
        ? { ...file.reference }
        : {
            type: getDifyFileType(file),
            transfer_method: 'local_file' as const,
            upload_file_id: file.uploadedId as string,
            name: file.name,
            size: file.size,
            mime_type: file.type,
            ...(file.app_id &&
            file.actor_id &&
            typeof file.actor_epoch === 'number'
              ? {
                  app_id: file.app_id,
                  actor_id: file.actor_id,
                  actor_epoch: file.actor_epoch,
                }
              : {}),
            ...(file.previewUrl ? { preview_url: file.previewUrl } : {}),
          }
    );

  return {
    successIds: successfulFiles
      .map(file => file.upload_file_id)
      .sort()
      .join(','),
    value: isSingleFileMode ? successfulFiles[0] || null : successfulFiles,
  };
}

export function getMaxFiles(
  slot: AgentAttachmentSlot | undefined,
  isSingleFileMode: boolean
) {
  return slot
    ? Math.min(slot.maxCount, isSingleFileMode ? 1 : slot.maxCount)
    : 0;
}

export function getFileTypeInfo(
  slot: AgentAttachmentSlot | undefined,
  t: TranslateFn
) {
  const extensions = slot ? inputFileExtensionsForSlot(slot) : [];
  return {
    hint: t('supportTypes', {
      types: extensions.map(extension => `.${extension}`).join(', '),
    }),
    accept: extensions.map(extension => `.${extension}`).join(','),
  };
}

export function getFileSizeHint(
  slot: AgentAttachmentSlot | undefined,
  t: TranslateFn
) {
  return (
    slot?.allowedTypes
      .map(type => {
        const limit = slot.maxBytesByType[type];
        return limit === undefined
          ? ''
          : `${t(`fileTypes.${type}`)}: ${formatBytes(limit)}`;
      })
      .filter(Boolean)
      .join(', ') ?? ''
  );
}

export function getFileSummary(uploadFile: UploadFile) {
  return formatBytes(uploadFile.size);
}
