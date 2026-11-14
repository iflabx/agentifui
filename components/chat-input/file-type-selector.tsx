'use client';

import { Popover, PopoverItem } from '@components/ui/popover';
import { hideActiveTooltip } from '@components/ui/tooltip';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import type { useFileTypes } from '@lib/hooks/use-file-types';
import { useMobile } from '@lib/hooks/use-mobile';
import { cn } from '@lib/utils';
import { Loader2, Paperclip } from 'lucide-react';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ChatButton } from './button';

// Define file selection callback type
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
  onFileSelect,
  disabled = false,
  ariaLabel,
  className,
  config,
  attachmentCount,
}: FileTypeSelectorProps) => {
  const { fileTypes, uploadConfig, isLoading, error } = config;
  const isMobile = useMobile();
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations('pages.chat');

  // Logic to check if files can be uploaded
  // Considers admin interface configuration and current uploaded file count
  const canUpload = uploadConfig.enabled && uploadConfig.maxFiles > 0;
  const hasReachedLimit = attachmentCount >= uploadConfig.maxFiles;
  const isDisabled = disabled || !canUpload || hasReachedLimit;

  // Generate tooltip content
  const getTooltipContent = () => {
    if (!uploadConfig.enabled) {
      return t('fileTypeSelector.notSupported');
    }
    if (uploadConfig.maxFiles === 0) {
      return t('fileTypeSelector.noLimit');
    }
    if (!uploadConfig.hasFileTypes) {
      return t('fileTypeSelector.noTypesConfigured');
    }
    if (hasReachedLimit) {
      return t('fileTypeSelector.maxFilesReached', {
        maxFiles: uploadConfig.maxFiles,
      });
    }
    return t('fileTypeSelector.addAttachment', {
      currentFiles: attachmentCount,
      maxFiles: uploadConfig.maxFiles,
    });
  };

  // Create file input reference callback
  const fileInputCallback = useCallback(
    (fileInput: HTMLInputElement | null, accept: string) => {
      if (fileInput) {
        // Set accepted file type
        fileInput.accept = accept;
        // Trigger file selection dialog
        fileInput.click();
        // Listen for file selection completion event
        const handleChange = () => {
          onFileSelect(fileInput.files, accept);
          // Reset input box, allow selecting same file
          fileInput.value = '';
          // Remove event listener
          fileInput.removeEventListener('change', handleChange);
        };
        fileInput.addEventListener('change', handleChange);
      }
    },
    [onFileSelect]
  );

  // Handle file type selection
  const handleFileTypeSelect = (accept: string) => {
    // Check again if upload is possible
    if (isDisabled) {
      return;
    }

    // Create temporary file input box
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true; // Allow multiple selection

    // Use callback to handle file selection
    fileInputCallback(fileInput, accept);

    // Close pop-up box
    setIsOpen(false);
  };

  // Create trigger button, and wrap with Tooltip
  const triggerButton = (
    <TooltipWrapper
      content={getTooltipContent()}
      id="file-type-selector-tooltip"
      placement="top"
      size="sm"
      showArrow={false}
    >
      <ChatButton
        icon={
          !canUpload ? (
            <Paperclip className="h-4 w-4" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )
        }
        ariaLabel={ariaLabel || t('fileTypeSelector.ariaLabel')}
        disabled={isDisabled}
        className={cn(
          className,
          !canUpload && 'opacity-50',
          hasReachedLimit && 'opacity-75'
        )}
      />
    </TooltipWrapper>
  );

  // If upload is not allowed, return disabled button
  if (!canUpload) {
    return triggerButton;
  }

  return (
    <Popover
      trigger={triggerButton}
      placement="top"
      isOpen={isOpen}
      onOpenChange={open => {
        if (isDisabled) {
          return;
        }
        setIsOpen(open);
        if (open) {
          hideActiveTooltip();
        }
      }}
      minWidth={170} // Decrease width from 180 to 160
      offsetX={isMobile ? undefined : 105} // Adjust offset accordingly
      offsetY={isMobile ? undefined : 42}
    >
      <div className="px-1 py-1">
        {isLoading ? (
          <div
            className={cn(
              'flex items-center justify-center py-4 font-serif',
              'text-gray-500 dark:text-gray-400'
            )}
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>{t('fileTypeSelector.loading')}</span>
          </div>
        ) : error ? (
          <div
            className={cn(
              'px-3 py-2 font-serif text-sm',
              'text-red-500 dark:text-red-300'
            )}
          >
            {t('fileTypeSelector.loadError')}
          </div>
        ) : fileTypes.length === 0 ? (
          <div
            className={cn(
              'px-3 py-2 text-center font-serif text-sm',
              'text-gray-500 dark:text-gray-400'
            )}
          >
            {t('fileTypeSelector.noTypesConfigured')}
          </div>
        ) : (
          <>
            {/* Display upload configuration information */}
            <div
              className={cn(
                'mb-1 border-b px-3 py-1 font-serif text-xs',
                'border-gray-200 text-gray-500 dark:border-gray-600 dark:text-gray-400'
              )}
            >
              {uploadConfig.maxFiles > 0 ? (
                <>
                  {t('fileTypeSelector.maxUpload', {
                    maxFiles: uploadConfig.maxFiles,
                  })}
                </>
              ) : (
                <>{t('fileTypeSelector.noUploadLimit')}</>
              )}
              {hasReachedLimit && (
                <div
                  className={cn(
                    'mt-1 text-xs',
                    'text-orange-600 dark:text-orange-400'
                  )}
                >
                  {t('fileTypeSelector.reachedLimit', {
                    currentFiles: attachmentCount,
                    maxFiles: uploadConfig.maxFiles,
                  })}
                </div>
              )}
            </div>

            {fileTypes.map(type => (
              <PopoverItem
                key={type.title}
                icon={type.icon}
                onClick={() => handleFileTypeSelect(type.acceptString)}
                disabled={hasReachedLimit}
                className={cn(
                  hasReachedLimit && 'cursor-not-allowed opacity-50'
                )}
              >
                <div className="flex flex-col">
                  <span>{type.title}</span>
                  <span
                    className={cn(
                      'font-serif text-xs',
                      'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {type.maxSize}
                  </span>
                </div>
              </PopoverItem>
            ))}
          </>
        )}
      </div>
    </Popover>
  );
};
