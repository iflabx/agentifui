'use client';

import { ChatInputBackdrop, ScrollToBottomButton } from '@components/chat';
import { FilePreviewCanvas } from '@components/file-preview/file-preview-canvas';
import { cn } from '@lib/utils';

import type { CSSProperties, ComponentPropsWithRef, ReactNode } from 'react';

import { AppChatLayout } from './app-chat-layout';
import { ChatSessionHeader } from './chat-session-header';

interface ChatSessionViewProps {
  as?: 'div' | 'main';
  appLayout?: boolean;
  appTitle?: string;
  children: ReactNode;
  composer: ReactNode;
  header?: ReactNode;
  showWelcome?: boolean;
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
  appLayout = false,
  appTitle,
  children,
  composer,
  header,
  showWelcome = false,
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
    <AppChatLayout value={appLayout}>
      <Container
        className={cn(
          'relative flex h-full min-h-0 w-full flex-col bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100',
          className
        )}
        data-chat-session
        data-app-chat-layout={appLayout ? '' : undefined}
      >
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col',
            appLayout ? 'overflow-hidden pt-12 md:pt-10' : contentClassName,
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
          {appLayout && appTitle && !showWelcome && (
            <ChatSessionHeader title={appTitle} />
          )}
          {!showWelcome && (
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
          {backdrop && !appLayout && <ChatInputBackdrop />}
          {composer && (
            <div
              data-app-chat-composer={
                appLayout
                  ? showWelcome
                    ? 'welcome'
                    : 'conversation'
                  : undefined
              }
              className={cn(
                appLayout
                  ? showWelcome
                    ? 'absolute inset-0 flex flex-col overflow-y-auto px-4 py-6'
                    : 'max-h-[55dvh] shrink-0 overflow-y-auto px-4 pb-4'
                  : 'contents'
              )}
            >
              <div
                className={
                  !appLayout
                    ? 'contents'
                    : showWelcome
                      ? 'my-auto shrink-0'
                      : undefined
                }
              >
                {composer}
              </div>
            </div>
          )}
        </div>
        {preview}
        {filePreview && <FilePreviewCanvas />}
      </Container>
    </AppChatLayout>
  );
}
