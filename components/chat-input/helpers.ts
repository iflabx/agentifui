import type { ChatUploadFile } from '@lib/services/dify/types';
import type { AttachmentFile } from '@lib/stores/attachment-store';

export type ChatInputTranslations = (key: string) => string;

export function getDifyFileType(
  file: AttachmentFile
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

export function buildSubmitFiles(
  attachments: AttachmentFile[]
): ChatUploadFile[] | undefined {
  const uploadedFiles = attachments.filter(
    file => file.status === 'success' && typeof file.uploadedId === 'string'
  );
  const files = uploadedFiles.map(file => ({
    type: getDifyFileType(file),
    transfer_method: 'local_file' as const,
    upload_file_id: file.uploadedId as string,
    name: file.name,
    size: file.size,
    mime_type: file.type,
  }));

  return files.length > 0 ? files : undefined;
}

export function shouldBlockEnterSubmit(input: {
  attachments: AttachmentFile[];
  canSubmitWithModel: boolean;
  isLocalSubmitting: boolean;
  isProcessing: boolean;
  isValidatingAppConfig: boolean;
  isWaiting: boolean;
  isComposing: boolean;
  message: string;
}) {
  if (input.isComposing) {
    return true;
  }

  return (
    input.isLocalSubmitting ||
    input.isWaiting ||
    input.isValidatingAppConfig ||
    input.isProcessing ||
    input.attachments.some(file => file.status === 'uploading') ||
    input.attachments.some(file => file.status === 'error') ||
    !input.message.trim() ||
    !input.canSubmitWithModel
  );
}

export function getChatInputAriaLabel(input: {
  hasAvailableModels: boolean;
  hasError: boolean;
  isLocalSubmitting: boolean;
  isProcessing: boolean;
  isUploading: boolean;
  isValidatingConfig: boolean;
  isWaiting: boolean;
  requireModelValidation: boolean;
  t: ChatInputTranslations;
  canSubmitWithModel: boolean;
}) {
  if (input.isLocalSubmitting) return input.t('input.sending');
  if (input.isValidatingConfig) return input.t('input.validatingConfig');
  if (input.isProcessing) return input.t('input.stopGeneration');
  if (input.isUploading) return input.t('input.uploading');
  if (input.hasError) return input.t('input.uploadFailed');
  if (!input.canSubmitWithModel) {
    if (!input.requireModelValidation) {
      return input.t('input.cannotSubmit');
    }

    return input.hasAvailableModels
      ? input.t('input.pleaseSelectModel')
      : input.t('input.noModelAvailable');
  }

  if (input.isWaiting) {
    return input.t('input.sending');
  }

  return input.t('input.sendMessage');
}
