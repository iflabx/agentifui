'use client';

import { Spinner } from '@components/ui/spinner';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import type { AttachmentFile } from '@lib/stores/attachment-store';
import { cn, formatBytes } from '@lib/utils';
import { CheckCircle2Icon, FileTextIcon, RotateCcw, XIcon } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';

/**
 * Props for a single attachment preview item.
 * Uses the stone color palette to match the overall app style.
 */
interface AttachmentPreviewItemProps {
  attachment: AttachmentFile;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Single attachment preview item component (minimalist style).
 * Uses the stone color palette to match the overall app style.
 */
export const AttachmentPreviewItem: React.FC<AttachmentPreviewItemProps> = ({
  attachment,
  onRetry,
  onRemove,
}) => {
  const t = useTranslations('common.ui');

  // Remove file handler
  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(attachment.id);
  };

  // Retry upload handler
  const handleRetryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry(attachment.id);
  };

  // Render status icon based on attachment status
  const StatusIcon = () => {
    switch (attachment.status) {
      case 'uploading':
        return <Spinner size="sm" />;
      case 'success':
        return (
          <CheckCircle2Icon
            className={cn('h-4 w-4', 'text-stone-500 dark:text-stone-400')}
          />
        );
      case 'error':
        return (
          <TooltipWrapper
            content={t('retry')}
            placement="top"
            id={`retry-att-${attachment.id}`}
            size="sm"
            showArrow={false}
          >
            <button
              type="button"
              onClick={handleRetryClick}
              className={cn(
                'flex h-full w-full items-center justify-center rounded-full',
                'text-stone-500 hover:bg-stone-100/50',
                'dark:text-stone-400 dark:hover:bg-stone-800/50',
                'focus:outline-none',
                'transition-colors duration-150'
              )}
              aria-label={t('retry')}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </TooltipWrapper>
        );
      case 'pending':
      default:
        return (
          <FileTextIcon
            className={cn('h-4 w-4', 'text-stone-500 dark:text-stone-400')}
          />
        );
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 rounded-md py-1 pr-1 pl-2',
        'flex-shrink basis-[calc((100%-1.5rem)/3)] sm:basis-[calc((100%-1rem)/2)]',
        'max-w-[180px] sm:max-w-[200px]',
        'border border-stone-200 bg-stone-100',
        'dark:border-stone-700/80 dark:bg-stone-800/90',
        attachment.status === 'error' &&
          'border-red-400/30 dark:border-red-500/30'
      )}
      title={
        attachment.error
          ? `${t('error')}: ${attachment.error}`
          : attachment.name
      }
    >
      <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
        <StatusIcon />
      </div>

      <div className="min-w-0 flex-grow">
        <p
          className={cn(
            'truncate font-serif text-sm font-medium',
            'text-stone-900 dark:text-stone-100'
          )}
        >
          {attachment.name}
        </p>
        <p
          className={cn(
            'font-serif text-xs',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {formatBytes(attachment.size)}
        </p>
      </div>

      <TooltipWrapper
        content={t('remove')}
        placement="top"
        id={`remove-att-${attachment.id}`}
        size="sm"
        showArrow={false}
      >
        <button
          type="button"
          onClick={handleRemove}
          className={cn(
            'ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors',
            'bg-stone-300/50 text-stone-600 hover:bg-stone-400/70 hover:text-black',
            'dark:bg-stone-700/80 dark:text-stone-300 dark:hover:bg-stone-600/80 dark:hover:text-white'
          )}
          aria-label={t('remove')}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </TooltipWrapper>
    </div>
  );
};
