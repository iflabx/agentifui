'use client';

import { UserMessageActions } from '@components/chat/message-actions';
import { highlightMessageText } from '@components/chat/message-text-highlight';
import { useMobile, useMounted } from '@lib/hooks';
import { MessageAttachment } from '@lib/stores/chat-store';
import { cn } from '@lib/utils';

import React from 'react';

import { FileAttachmentDisplay } from './file-attachment-display';

interface UserMessageProps {
  content: string;
  attachments?: MessageAttachment[];
  conversationAppId?: string | null;
  id: string;
  className?: string;
  highlightQuery?: string;
  onCopy?: () => void;
  onEdit?: () => void;
  editDisabled?: boolean;
  editor?: React.ReactNode;
}

export const UserMessage: React.FC<UserMessageProps> = ({
  content,
  attachments = [],
  conversationAppId = null,
  id,
  className,
  highlightQuery,
  onEdit,
  editDisabled,
  editor,
}) => {
  const isMobile = useMobile();
  const isMounted = useMounted();
  const hasAttachments = attachments && attachments.length > 0;
  const previewAppId = conversationAppId || undefined;

  if (!isMounted) {
    return null;
  }

  return (
    <div className="group mb-6 flex w-full justify-end" data-message-id={id}>
      <div className="flex w-full max-w-3xl flex-col items-end">
        {/* Attachment display area - right aligned */}
        {hasAttachments && (
          <FileAttachmentDisplay
            attachments={attachments.map(att => ({
              ...att,
              app_id: att.app_id || previewAppId,
            }))}
            appId={previewAppId}
            className={cn('mb-2 w-full')}
          />
        )}
        {/* Message bubble - modern design, stone color theme */}
        {editor || (
          <div
            className={cn(
              'max-w-full rounded-2xl px-4 py-3 text-base leading-relaxed',
              'markdown-body assistant-message-content shadow-sm',
              'bg-stone-200/80 text-stone-800',
              'dark:bg-stone-700/70 dark:text-stone-100',
              'border',
              'border-stone-300/80 dark:border-stone-600/30',
              isMobile ? 'max-w-[85%]' : 'max-w-[75%]',
              className
            )}
          >
            {highlightMessageText(content, highlightQuery)}
          </div>
        )}

        {/* Message action buttons */}
        {!editor && (
          <UserMessageActions
            messageId={id}
            content={content}
            onEdit={onEdit}
            editDisabled={editDisabled}
          />
        )}
      </div>
    </div>
  );
};
