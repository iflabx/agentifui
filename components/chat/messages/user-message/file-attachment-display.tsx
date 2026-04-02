'use client';

import { useMobile } from '@lib/hooks/use-mobile';
import type { MessageAttachment } from '@lib/stores/chat-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { cn, formatBytes } from '@lib/utils';
import {
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileMusicIcon,
  FileTextIcon,
  FileVideoIcon,
} from 'lucide-react';

import React from 'react';

interface FileAttachmentDisplayProps {
  attachments: MessageAttachment[];
  appId?: string; // Dify application ID for preview functionality
  className?: string;
}

/**
 * Get the appropriate file icon component based on MIME type.
 * @param mimeType - The MIME type of the file.
 * @returns The icon component for the file type.
 */
const getFileIcon = (mimeType: string | undefined) => {
  // Type safety check
  if (!mimeType || typeof mimeType !== 'string') return FileIcon;

  if (mimeType.startsWith('image/')) return FileImageIcon;
  if (mimeType.startsWith('audio/')) return FileMusicIcon;
  if (mimeType.startsWith('video/')) return FileVideoIcon;
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('csv') ||
    mimeType.includes('text')
  )
    return FileTextIcon;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar') ||
    mimeType.includes('7z') ||
    mimeType.includes('gzip')
  )
    return FileArchiveIcon;
  return FileIcon;
};

/**
 * FileAttachmentDisplay component
 * Renders a list of file attachments with icons and file info.
 */
export const FileAttachmentDisplay: React.FC<FileAttachmentDisplayProps> = ({
  attachments,
  appId,
  className,
}) => {
  const openPreview = useFilePreviewStore(state => state.openPreview);
  const isMobile = useMobile();

  // If there are no attachments, render nothing
  if (!attachments || attachments.length === 0) return null;

  /**
   * Handle click on an attachment.
   * Closes sidebar or mobile nav if open, then opens file preview.
   * @param attachment - The clicked attachment
   */
  const handleAttachmentClick = (attachment: MessageAttachment) => {
    const sidebarState = useSidebarStore.getState();

    if (isMobile) {
      if (sidebarState.isMobileNavVisible) {
        sidebarState.hideMobileNav();
      }
    } else {
      if (sidebarState.isExpanded) {
        sidebarState.toggleSidebar();
      }
    }

    const resolvedAppId = attachment.app_id || appId;

    // Preserve attachment app context first; only fall back to the external appId.
    const enhancedAttachment: MessageAttachment = {
      ...attachment,
      app_id: resolvedAppId,
    };

    openPreview(enhancedAttachment, resolvedAppId);
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap justify-end gap-2 px-2 pt-2 pb-1',
        className
      )}
      style={{
        maxWidth: '100%',
        minHeight: '0',
        marginRight: 0,
      }}
    >
      {attachments.map(attachment => {
        const IconComponent = getFileIcon(attachment.type);
        return (
          <button
            key={attachment.id}
            onClick={() => handleAttachmentClick(attachment)}
            className={cn(
              'relative flex max-w-[180px] flex-shrink basis-[calc((100%-1rem)/3)] items-center gap-2 rounded-md py-1 pr-1 pl-2 sm:max-w-[200px]',
              'text-left',
              'border border-stone-300 bg-stone-200 hover:bg-stone-300',
              'dark:border-stone-700/80 dark:bg-stone-800/90 dark:hover:bg-stone-700/90'
            )}
            title={`Preview ${attachment.name}`}
            aria-label={`Preview file ${attachment.name}`}
          >
            <div
              className={cn(
                'relative flex h-5 w-5 flex-shrink-0 items-center justify-center',
                'text-stone-700 dark:text-stone-200'
              )}
            >
              <IconComponent className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-grow">
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  'text-stone-900 dark:text-stone-100'
                )}
              >
                {attachment.name}
              </p>
              <p
                className={cn(
                  'text-xs',
                  'whitespace-nowrap',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {formatBytes(attachment.size)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
};
