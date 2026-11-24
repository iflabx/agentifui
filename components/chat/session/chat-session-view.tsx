'use client';

import { ChatInputBackdrop, ScrollToBottomButton } from '@components/chat';
import { FilePreviewCanvas } from '@components/file-preview/file-preview-canvas';
import { cn } from '@lib/utils';

import type { CSSProperties, ComponentPropsWithRef, ReactNode } from 'react';

interface ChatSessionViewProps {
  as?: 'div' | 'main';
  children: ReactNode;
  composer: ReactNode;
  header?: ReactNode;
  welcome?: ReactNode;
  showWelcome?: boolean;
  processAction?: ReactNode;
  afterComposer?: ReactNode;
  preview?: ReactNode;
  filePreview?: boolean;
  previewOpen?: boolean;
  jumpToBottom?: boolean;
  backdrop?: boolean;
  inputHeight?: number;
  className?: string;
  contentClassName?: string;
  scrollProps?: ComponentPropsWithRef<'div'>;
}

export function ChatSessionView({
  as: Container = 'div',
  children,
  composer,
  header,
  welcome,
  showWelcome = false,
  processAction,
  afterComposer,
  preview,
  filePreview,
  previewOpen,
  jumpToBottom = true,
  backdrop = true,
  inputHeight,
  className,
  contentClassName = 'pt-10',
  scrollProps,
}: ChatSessionViewProps) {
  const { className: scrollClassName, ...scrollBindings } = scrollProps ?? {};
  return (
    <Container
      className={cn(
        'relative flex h-full min-h-0 w-full flex-col bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100',
        className
      )}
      data-chat-session
    >
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col',
          contentClassName,
          filePreview && 'transition-[width] duration-300 ease-in-out',
          previewOpen ? 'w-[50%] lg:w-[60%]' : 'w-full'
        )}
        style={
          inputHeight === undefined
            ? undefined
            : ({ '--chat-input-height': `${inputHeight}px` } as CSSProperties)
        }
      >
        {header}
        {showWelcome ? (
          <div className="min-h-0 flex-1">{welcome}</div>
        ) : (
          <div className="min-h-0 flex-1">
            <div
              {...scrollBindings}
              className={cn(
                'chat-scroll-container h-full overflow-y-auto overscroll-contain',
                scrollClassName
              )}
            >
              {children}
            </div>
          </div>
        )}
        {jumpToBottom && <ScrollToBottomButton />}
        {processAction}
        {backdrop && <ChatInputBackdrop />}
        {composer}
        {afterComposer}
      </div>
      {preview}
      {filePreview && <FilePreviewCanvas />}
    </Container>
  );
}
