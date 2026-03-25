import { cn } from '@lib/utils';
import { Upload } from 'lucide-react';

import type { ChangeEvent, DragEvent, RefObject } from 'react';

interface FileUploadDropzoneProps {
  accept?: string;
  canUploadMore: boolean;
  error?: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileSizeHint: string;
  fileTypeHint: string;
  inputDisabled: boolean;
  isUploading: boolean;
  maxFiles: number;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  remaining: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function FileUploadDropzone({
  accept,
  canUploadMore,
  error,
  fileInputRef,
  fileSizeHint,
  fileTypeHint,
  inputDisabled,
  isUploading,
  maxFiles,
  onDragOver,
  onDrop,
  onInputChange,
  remaining,
  t,
}: FileUploadDropzoneProps) {
  if (!canUploadMore) {
    return null;
  }

  return (
    <>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className={cn(
          'group relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center',
          'backdrop-blur-sm transition-all duration-300 ease-in-out',
          'hover:scale-[1.01] hover:shadow-lg',
          'bg-gradient-to-br from-white/80 to-stone-50/80 dark:from-stone-800/80 dark:to-stone-700/80',
          error
            ? 'border-red-400 bg-red-50/50 hover:border-red-300 dark:bg-red-900/10'
            : 'border-stone-300 hover:border-stone-400 dark:border-stone-600 dark:hover:border-stone-500',
          isUploading && 'cursor-not-allowed opacity-75'
        )}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <div
          className={cn(
            'absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100',
            'transition-opacity duration-300',
            'bg-gradient-to-br from-stone-100/50 to-stone-200/50 dark:from-stone-700/50 dark:to-stone-600/50'
          )}
        />

        <div className="relative z-10 space-y-4">
          <div
            className={cn(
              'inline-flex h-16 w-16 items-center justify-center rounded-2xl',
              'shadow-lg transition-transform duration-300 group-hover:scale-110',
              'border border-stone-300/50 bg-gradient-to-br from-stone-100 to-stone-200 shadow-stone-200/50 dark:border-stone-600/50 dark:bg-gradient-to-br dark:from-stone-700 dark:to-stone-600 dark:shadow-stone-900/50'
            )}
          >
            <Upload
              className={cn('h-7 w-7', 'text-stone-600 dark:text-stone-300')}
            />
          </div>

          <div className="space-y-2">
            <p
              className={cn(
                'font-serif text-base font-semibold',
                'text-stone-800 dark:text-stone-200'
              )}
            >
              {isUploading ? t('uploading') : t('dropOrClick')}
            </p>

            <div
              className={cn(
                'space-y-1 font-serif text-sm',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              <p>{t('maxFiles', { maxFiles, remaining })}</p>
              <p>{fileTypeHint}</p>
              {fileSizeHint && <p>{fileSizeHint}</p>}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        className="hidden"
        onChange={onInputChange}
        disabled={inputDisabled}
      />
    </>
  );
}
