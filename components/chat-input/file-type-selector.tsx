'use client';

import type { useFileTypes } from '@lib/hooks/use-file-types';

import { useTranslations } from 'next-intl';

import { AttachmentAction } from './attachment-action';

export type FileSelectCallback = (
  files: FileList | null,
  accept: string
) => void;

interface FileTypeSelectorProps {
  config: ReturnType<typeof useFileTypes>;
  attachmentCount: number;
  onFileSelect: FileSelectCallback;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

export const FileTypeSelector = ({
  config,
  attachmentCount,
  onFileSelect,
  disabled = false,
  ariaLabel,
  className,
}: FileTypeSelectorProps) => {
  const translate = useTranslations('pages.chat.fileTypeSelector');
  const { slot, uploadConfig, fileTypes, isLoading, error } = config;
  const blocked =
    disabled || isLoading || Boolean(error) || !uploadConfig.enabled;
  const accept = fileTypes.map(type => type.acceptString).join(',');
  return (
    <div
      className={className}
      title={
        isLoading
          ? translate('loading')
          : error
            ? translate('loadError')
            : undefined
      }
    >
      <AttachmentAction
        choices={
          slot && uploadConfig.enabled
            ? [{ id: slot.key, slot, count: attachmentCount }]
            : []
        }
        status={isLoading ? 'loading' : error ? 'unavailable' : undefined}
        disabled={blocked}
        ariaLabel={ariaLabel}
        onChoose={() => {
          if (blocked || attachmentCount >= uploadConfig.maxFiles) return;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = accept;
          input.multiple = uploadConfig.maxFiles - attachmentCount > 1;
          input.addEventListener(
            'change',
            () => {
              onFileSelect(input.files, accept);
              input.value = '';
            },
            { once: true }
          );
          input.click();
        }}
      />
    </div>
  );
};
