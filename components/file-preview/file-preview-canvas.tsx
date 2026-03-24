'use client';

import type { MessageAttachment } from '@lib/stores/chat-store';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { cn, formatBytes } from '@lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircleIcon,
  DownloadIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';

import React, { useEffect } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { FilePreviewBackdrop } from './file-preview-backdrop';
import { AudioPreview } from './previews/audio-preview';
import { ImagePreview } from './previews/image-preview';
import { MarkdownPreview } from './previews/markdown-preview';
import { PDFPreview } from './previews/pdf-preview';
import { TextPreview } from './previews/text-preview';
import { VideoPreview } from './previews/video-preview';

/**
 * Loading skeleton component
 */
const LoadingSkeleton: React.FC = () => {
  const t = useTranslations('filePreview');
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center space-x-2">
        <RefreshCwIcon className="h-4 w-4 animate-spin text-stone-600 dark:text-stone-400" />
        <span className="text-sm text-stone-600 dark:text-stone-400">
          {t('loading')}
        </span>
      </div>
      <div className="space-y-3 rounded-md bg-stone-100 p-4 dark:bg-stone-800">
        <div className="h-4 rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-4 w-3/4 rounded bg-stone-200 dark:bg-stone-700" />
        <div className="h-4 w-1/2 rounded bg-stone-200 dark:bg-stone-700" />
      </div>
    </div>
  );
};

/**
 * Error display component
 */
const ErrorDisplay: React.FC<{
  error: string;
  onRetry: () => void;
  onClearError: () => void;
}> = ({ error, onRetry, onClearError }) => {
  const t = useTranslations('filePreview');
  return (
    <div className="space-y-4 rounded-md border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
      <div className="flex items-start space-x-2">
        <AlertCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="font-medium">{t('failed')}</h3>
          <p className="mt-1 text-sm opacity-90">{error}</p>
        </div>
      </div>
      <div className="flex space-x-2">
        <button
          onClick={onRetry}
          className="inline-flex items-center space-x-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-800 dark:text-red-100 dark:hover:bg-red-700"
        >
          <RefreshCwIcon className="h-3 w-3" />
          <span>{t('retryButton')}</span>
        </button>
        <button
          onClick={onClearError}
          className="inline-flex items-center rounded px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-800/50"
        >
          {t('dismissButton')}
        </button>
      </div>
    </div>
  );
};

/**
 * Fallback component for unsupported file types
 */
const FileInfoFallback: React.FC<{
  file: MessageAttachment;
  onDownload: () => void;
}> = ({ file, onDownload }) => {
  const t = useTranslations('filePreview');
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('fileInfo.title')}</h3>
      <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800">
        <div className="space-y-1 text-sm">
          <p>
            <strong>{t('fileInfo.name')}</strong> {file.name}
          </p>
          <p>
            <strong>{t('fileInfo.type')}</strong> {file.type}
          </p>
          <p>
            <strong>{t('fileInfo.size')}</strong> {formatBytes(file.size)}
          </p>
        </div>
      </div>
      <div className="flex space-x-2">
        <button
          onClick={onDownload}
          className="inline-flex items-center space-x-2 rounded-md bg-stone-200 px-4 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
        >
          <DownloadIcon className="h-4 w-4" />
          <span>{t('downloadButton')}</span>
        </button>
      </div>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        {t('previewNotSupported')}
      </p>
    </div>
  );
};

/**
 * Enhanced file content viewer with document preview capabilities
 */
const FileContentViewer: React.FC<{
  file: MessageAttachment | null;
}> = ({ file }) => {
  const {
    previewContent,
    contentHeaders,
    isLoading,
    error,
    downloadFile,
    openPreview,
    clearError,
  } = useFilePreviewStore();

  const t = useTranslations('filePreview');

  if (!file) {
    return (
      <div className="py-8 text-center text-stone-600 dark:text-stone-400">
        {t('noFileSelected')}
      </div>
    );
  }

  // Handle retry
  const handleRetry = () => {
    if (file.app_id) {
      openPreview(file, file.app_id);
    }
  };

  // Show loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Show error state
  if (error) {
    return (
      <ErrorDisplay
        error={error}
        onRetry={handleRetry}
        onClearError={clearError}
      />
    );
  }

  // Show fallback if no content available
  if (!previewContent || !contentHeaders) {
    return <FileInfoFallback file={file} onDownload={downloadFile} />;
  }

  // Route to appropriate preview component based on content type
  const contentType = contentHeaders.contentType.toLowerCase();

  // Text files (including code files)
  if (contentType.startsWith('text/') && !contentType.includes('markdown')) {
    return (
      <TextPreview
        content={previewContent}
        filename={file.name}
        contentType={contentType}
        onDownload={downloadFile}
      />
    );
  }

  // Markdown files
  if (
    contentType.includes('markdown') ||
    file.name.toLowerCase().endsWith('.md')
  ) {
    return (
      <MarkdownPreview
        content={previewContent}
        filename={file.name}
        onDownload={downloadFile}
      />
    );
  }

  // PDF files
  if (contentType === 'application/pdf') {
    return (
      <PDFPreview
        content={previewContent}
        filename={file.name}
        onDownload={downloadFile}
      />
    );
  }

  // Image files (JPG, PNG, GIF, WebP, etc.)
  if (contentType.startsWith('image/')) {
    return (
      <ImagePreview
        content={previewContent}
        filename={file.name}
        onDownload={downloadFile}
      />
    );
  }

  // Audio files (MP3, WAV, etc.)
  if (contentType.startsWith('audio/')) {
    return (
      <AudioPreview
        content={previewContent}
        filename={file.name}
        onDownload={downloadFile}
      />
    );
  }

  // Video files (MP4, WebM, etc.)
  if (contentType.startsWith('video/')) {
    return (
      <VideoPreview
        content={previewContent}
        filename={file.name}
        onDownload={downloadFile}
      />
    );
  }

  // Fallback for unsupported types
  return <FileInfoFallback file={file} onDownload={downloadFile} />;
};

export const FilePreviewCanvas = () => {
  const { isPreviewOpen, currentPreviewFile, closePreview } =
    useFilePreviewStore();
  const pathname = usePathname() ?? '';
  const t = useTranslations('filePreview');

  // Auto-close preview when route changes (best practice for modal state management)
  useEffect(() => {
    if (isPreviewOpen) {
      closePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const panelVariants = {
    hidden: { x: '100%' },
    visible: { x: 0 },
  };

  // Speed up animation: reduce duration
  const transitionConfig = {
    type: 'tween',
    duration: 0.2, // Reduce from 0.3 to 0.2
    ease: 'easeInOut',
  };

  return (
    <>
      <FilePreviewBackdrop />

      <AnimatePresence>
        {isPreviewOpen && (
          <motion.div
            className={cn(
              'fixed top-0 right-0 z-50 h-full',
              'flex flex-col',
              'w-[85%] md:w-[60%] lg:w-[50%] xl:w-[40%]',
              'border-l border-stone-200 bg-white text-stone-900',
              'dark:border-l dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
            )}
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={transitionConfig}
          >
            <div
              className={cn(
                'flex flex-shrink-0 items-center justify-between border-b p-4',
                'border-stone-200 dark:border-stone-700'
              )}
            >
              <h2
                className="truncate text-xl font-semibold"
                title={currentPreviewFile?.name || 'File information'}
              >
                {currentPreviewFile?.name || 'File information'}
              </h2>
              <button
                onClick={closePreview}
                className={cn(
                  'rounded-full p-1',
                  'text-stone-600 hover:bg-stone-200 hover:text-stone-800',
                  'dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
                )}
                aria-label={t('closeButton')}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto p-6">
              <FileContentViewer file={currentPreviewFile} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
