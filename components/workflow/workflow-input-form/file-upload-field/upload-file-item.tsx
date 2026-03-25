import { Spinner } from '@components/ui/spinner';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import { cn } from '@lib/utils';
import { CheckCircle2Icon, File, RotateCcw, X } from 'lucide-react';

import { type UploadFile, getFileSummary } from './helpers';

interface UploadFileItemProps {
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  t: (key: string) => string;
  uploadFile: UploadFile;
}

export function UploadFileItem({
  onRemove,
  onRetry,
  t,
  uploadFile,
}: UploadFileItemProps) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-4 rounded-xl border p-4',
        'backdrop-blur-sm transition-all duration-300 ease-in-out hover:shadow-lg',
        'animate-in slide-in-from-top-2 fade-in duration-300',
        'bg-gradient-to-r from-white/90 to-stone-50/90 dark:from-stone-800/90 dark:to-stone-700/90',
        uploadFile.status === 'success' &&
          'border-stone-400 dark:border-stone-500/50',
        uploadFile.status === 'error' &&
          'border-red-200 dark:border-red-700/50',
        uploadFile.status === 'uploading' &&
          'border-stone-400 dark:border-stone-500/50',
        uploadFile.status === 'pending' &&
          'border-stone-200 dark:border-stone-600'
      )}
    >
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300',
            uploadFile.status === 'success' &&
              'bg-stone-200 dark:bg-stone-700/50',
            uploadFile.status === 'error' && 'bg-red-100 dark:bg-red-900/30',
            uploadFile.status === 'uploading' &&
              'bg-stone-200 dark:bg-stone-700/50',
            uploadFile.status === 'pending' && 'bg-stone-100 dark:bg-stone-700'
          )}
        >
          {uploadFile.status === 'uploading' && <Spinner size="sm" />}
          {uploadFile.status === 'success' && (
            <CheckCircle2Icon
              className={cn('h-5 w-5', 'text-stone-600 dark:text-stone-300')}
            />
          )}
          {uploadFile.status === 'error' && (
            <TooltipWrapper
              content={t('retryUpload')}
              placement="top"
              id={`retry-${uploadFile.id}`}
              size="sm"
              showArrow={false}
            >
              <button
                type="button"
                onClick={() => onRetry(uploadFile.id)}
                className={cn(
                  'flex h-full w-full items-center justify-center rounded-xl',
                  'transition-colors duration-200 focus:outline-none',
                  'text-red-600 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-800/50'
                )}
                aria-label={t('retryUpload')}
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            </TooltipWrapper>
          )}
          {uploadFile.status === 'pending' && (
            <File
              className={cn('h-5 w-5', 'text-stone-600 dark:text-stone-400')}
            />
          )}
        </div>

        {uploadFile.status === 'uploading' && (
          <div className="absolute inset-0 animate-ping rounded-xl border-2 border-stone-400 opacity-30" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p
          className={cn(
            'truncate font-serif text-sm font-semibold',
            'text-stone-800 dark:text-stone-200'
          )}
        >
          {uploadFile.name}
        </p>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'rounded-full px-2 py-1 font-mono text-xs',
              'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-400'
            )}
          >
            {getFileSummary(uploadFile)}
          </span>

          {uploadFile.status === 'error' && uploadFile.error && (
            <span
              className={cn(
                'font-serif text-xs',
                'text-red-600 dark:text-red-400'
              )}
            >
              {uploadFile.error}
            </span>
          )}
        </div>
      </div>

      <TooltipWrapper
        content={t('removeFile')}
        placement="top"
        id={`remove-${uploadFile.id}`}
        size="sm"
        showArrow={false}
      >
        <button
          type="button"
          onClick={() => onRemove(uploadFile.id)}
          className={cn(
            'rounded-xl p-2 opacity-0 transition-all duration-200 group-hover:opacity-100',
            'text-stone-500 hover:bg-stone-200 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-600 dark:hover:text-stone-200'
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </TooltipWrapper>
    </div>
  );
}
