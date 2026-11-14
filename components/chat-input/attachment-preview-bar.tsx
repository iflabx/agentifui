'use client';

import type { AttachmentFile } from '@lib/stores/attachment-store';
import { cn } from '@lib/utils';

import React, { useEffect, useRef } from 'react';

import { useTranslations } from 'next-intl';

import { AttachmentPreviewItem } from './attachment-preview-item';

/**
 * Attachment preview bar component properties
 */
interface AttachmentPreviewBarProps {
  files: AttachmentFile[];
  uploadConfig: { enabled: boolean; maxFiles: number };
  onRemove: (id: string) => void;
  /** Callback function to notify parent component of height changes */
  onHeightChange: (height: number) => void;
  /** Retry upload callback */
  onRetryUpload: (id: string) => void;
}

/**
 * Attachment preview bar component
 * @description Displays uploaded files with preview and manages height animations
 *
 * @features
 * - Dynamic height calculation and animation
 * - File count limit warnings
 * - Responsive file preview grid
 * - Upload retry functionality
 */
export const AttachmentPreviewBar: React.FC<AttachmentPreviewBarProps> = ({
  onHeightChange,
  onRetryUpload,
  files,
  uploadConfig,
  onRemove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('components.chatInput.attachmentPreview');

  // Monitor file list changes or window size changes, dynamically calculate and notify height with animation styles
  useEffect(() => {
    let calculatedHeight = 0;
    const container = containerRef.current;

    const calculateAndApplyHeight = () => {
      if (container) {
        // First remove temporary height, calculate actual content height
        container.style.height = ''; // Clear old height
        calculatedHeight = files.length > 0 ? container.scrollHeight : 0;

        // Apply calculated height to style, trigger CSS transition
        container.style.height = `${calculatedHeight}px`;

        // Notify parent component of height change
        onHeightChange(calculatedHeight);
      }
    };

    // Use requestAnimationFrame to ensure height calculation after DOM update
    const rafId = requestAnimationFrame(calculateAndApplyHeight);

    // Use ResizeObserver to monitor container content size changes
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(calculateAndApplyHeight);
    });
    if (container) {
      // Monitor inner flex container, not outer container with overflow
      const innerFlexContainer = container.querySelector(':scope > div');
      if (innerFlexContainer) {
        resizeObserver.observe(innerFlexContainer);
      }
    }

    // Cleanup function
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      // Clear height style for correct calculation next time
      if (container) {
        container.style.height = '';
      }
    };
  }, [files.length, onHeightChange]); // Depends on file count changes

  // If no files, return empty container
  if (files.length === 0) {
    return (
      <div
        ref={containerRef}
        className="overflow-hidden transition-[height] duration-300 ease-in-out"
        style={{ height: 0 }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'border-gray-200 dark:border-gray-700', // Theme-aware border
        'overflow-hidden',
        'transition-[height] duration-300 ease-in-out'
      )}
      style={{ height: 0 }}
    >
      {/* Inner container for padding and flex layout, ResizeObserver monitors this element */}
      <div className="px-3 pt-3 pb-2">
        {/* If file count exceeds limit, show warning message */}
        {uploadConfig.enabled &&
          uploadConfig.maxFiles > 0 &&
          files.length > uploadConfig.maxFiles && (
            <div
              className={cn(
                'mb-2 rounded-lg px-3 py-2 font-serif text-sm',
                'border border-orange-300 bg-orange-100 text-orange-700',
                'dark:border-orange-500/30 dark:bg-orange-900/30 dark:text-orange-300'
              )}
            >
              {t('fileLimitExceeded', {
                current: files.length,
                max: uploadConfig.maxFiles,
              })}
            </div>
          )}

        {/* File list container */}
        <div className="flex flex-wrap gap-2">
          {files.map(file => (
            <AttachmentPreviewItem
              key={file.id}
              attachment={file}
              onRetry={onRetryUpload}
              onRemove={onRemove}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
