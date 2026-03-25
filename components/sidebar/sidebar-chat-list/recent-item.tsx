'use client';

import { SidebarListButton } from '@components/sidebar/sidebar-list-button';
import { TypeWriter } from '@components/ui/typewriter';
import { cn } from '@lib/utils';
import type { LucideIcon } from 'lucide-react';

import type * as React from 'react';

import {
  type SidebarRecentItem,
  isRecentTaskExecution,
  shouldUseTypewriter,
} from './helpers';

type SidebarRecentItemRowProps = {
  chat: SidebarRecentItem;
  active: boolean;
  icon: LucideIcon;
  isLoading: boolean;
  moreActionsTrigger: React.ReactNode;
  hasOpenDropdown: boolean;
  disableHover: boolean;
  untitledLabel: string;
  onClick: () => void;
  onTypewriterComplete: (chatId: string) => void;
};

export function SidebarRecentItemRow({
  chat,
  active,
  icon: Icon,
  isLoading,
  moreActionsTrigger,
  hasOpenDropdown,
  disableHover,
  untitledLabel,
  onClick,
  onTypewriterComplete,
}: SidebarRecentItemRowProps) {
  const title = chat.title || untitledLabel;
  const useTypewriter = shouldUseTypewriter(chat);
  const typewriterText = !isRecentTaskExecution(chat)
    ? chat.titleTypewriterState?.targetTitle || ''
    : '';

  return (
    <div className="group relative">
      <SidebarListButton
        icon={<Icon className="h-3.5 w-3.5" />}
        active={active}
        onClick={onClick}
        isLoading={isLoading}
        hasOpenDropdown={hasOpenDropdown}
        disableHover={disableHover}
        moreActionsTrigger={moreActionsTrigger}
      >
        <div className="flex h-4 w-full items-center">
          {isLoading ? (
            <div
              className={cn(
                'h-4 w-[85%] animate-pulse rounded-md',
                'bg-stone-400 opacity-80 dark:bg-stone-600'
              )}
            />
          ) : useTypewriter ? (
            <h4
              className={cn(
                'w-full truncate font-serif text-xs leading-4 font-medium',
                'text-stone-700 dark:text-gray-200'
              )}
            >
              <TypeWriter
                text={String(typewriterText)}
                speed={30}
                delay={200}
                className="font-serif text-xs leading-4 font-medium"
                onComplete={() => {
                  if (!isRecentTaskExecution(chat)) {
                    onTypewriterComplete(chat.id);
                  }
                }}
              />
            </h4>
          ) : (
            <h4
              className={cn(
                'w-full truncate font-serif text-xs leading-4 font-medium',
                'text-stone-700 dark:text-gray-200'
              )}
            >
              {title}
            </h4>
          )}
        </div>
      </SidebarListButton>
    </div>
  );
}
