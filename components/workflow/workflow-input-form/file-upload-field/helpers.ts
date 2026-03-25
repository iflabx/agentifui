import { formatBytes } from '@lib/utils';

export interface UploadFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  uploadedId?: string;
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
    id: `${file.name}-${file.lastModified}-${file.size}`,
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    status: 'pending',
    progress: 0,
  }));
}

export function getDifyFileType(
  file: Pick<UploadFile, 'type'>
): 'image' | 'document' | 'audio' | 'video' | 'custom' {
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
  isSingleFileMode: boolean
) {
  const successfulFiles = uploadFiles
    .filter(file => file.status === 'success' && file.uploadedId)
    .map(file => ({
      type: getDifyFileType(file),
      transfer_method: 'local_file' as const,
      upload_file_id: file.uploadedId as string,
      name: file.name,
      size: file.size,
      mime_type: file.type,
    }));

  return {
    successIds: successfulFiles
      .map(file => file.upload_file_id)
      .sort()
      .join(','),
    value: isSingleFileMode ? successfulFiles[0] || null : successfulFiles,
  };
}

export function getMaxFiles(
  config: FileUploadFieldConfig,
  isSingleFileMode: boolean
) {
  return isSingleFileMode ? 1 : config.max_length || config.number_limits || 1;
}

export function getFileTypeInfo(config: FileUploadFieldConfig, t: TranslateFn) {
  const types = config.allowed_file_types;
  if (!types || types.length === 0) {
    return {
      hint: t('supportAllTypes'),
      accept: undefined,
    };
  }

  const typeMap: Record<string, { name: string; accept: string }> = {
    image: {
      name: t('fileTypes.image'),
      accept: 'image/*,.jpg,.jpeg,.png,.gif,.bmp,.svg,.webp,.ico,.tiff,.tif',
    },
    document: {
      name: t('fileTypes.document'),
      accept:
        '.txt,.md,.mdx,.markdown,.pdf,.html,.xlsx,.xls,.doc,.docx,.csv,.eml,.msg,.pptx,.ppt,.xml,.epub',
    },
    audio: {
      name: t('fileTypes.audio'),
      accept: 'audio/*,.mp3,.wav,.flac,.aac,.ogg,.wma,.m4a,.opus',
    },
    video: {
      name: t('fileTypes.video'),
      accept: 'video/*,.mp4,.avi,.mkv,.mov,.wmv,.flv,.webm,.m4v,.3gp',
    },
    custom: { name: t('fileTypes.custom'), accept: '*/*' },
  };

  const supportedTypes = types
    .map(type => typeMap[type]?.name || type)
    .filter(Boolean);
  const acceptStrings = types
    .map(type => typeMap[type]?.accept)
    .filter(Boolean);

  return {
    hint:
      supportedTypes.length > 0
        ? t('supportTypes', { types: supportedTypes.join('、') })
        : t('supportAllTypes'),
    accept: acceptStrings.length > 0 ? acceptStrings.join(',') : undefined,
  };
}

export function getFileSizeHint(config: FileUploadFieldConfig, t: TranslateFn) {
  return config.max_file_size_mb
    ? t('maxFileSize', { size: config.max_file_size_mb })
    : '';
}

export function getFileSummary(uploadFile: UploadFile) {
  return formatBytes(uploadFile.size);
}
