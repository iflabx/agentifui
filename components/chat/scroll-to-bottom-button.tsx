'use client';

import { useChatScrollStore } from '@lib/stores/chat-scroll-store';
import { cn } from '@lib/utils';
import { ChevronDown } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

/**
 * ScrollToBottomButton component
 * Renders only on /chat route (but not /chat/new) and when not at the bottom.
 */
export const ScrollToBottomButton = () => {
  const { isAtBottom } = useChatScrollStore();
  const resetScrollState = useChatScrollStore(state => state.resetScrollState);
  const pathname = usePathname() ?? '';
  const t = useTranslations('pages.chat.input');

  // Render condition:
  // 1. On /chat route (but not /chat/new)
  // 2. Not at the bottom
  const isInChatPage = pathname.startsWith('/chat') && pathname !== '/chat/new';
  const shouldRender = isInChatPage && !isAtBottom;

  // Calculate bottom offset dynamically based on input height (CSS variable --chat-input-height)
  const bottomOffset = `calc(var(--chat-input-height, 80px) + 5.5rem)`;

  const handleClick = () => {
    // Reset scroll state and scroll to bottom
    resetScrollState();
  };

  if (!shouldRender) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        // Positioning and z-index
        'absolute bottom-0 left-1/2 z-10 mb-4 -translate-x-1/2',

        // Base styles
        'cursor-pointer rounded-full p-1.5 shadow-md transition-transform duration-150 ease-in-out',

        // Color theme
        'bg-stone-200 dark:bg-stone-700',
        'hover:bg-stone-300 dark:hover:bg-stone-600',
        'text-stone-700 dark:text-stone-300',

        // Interaction effects
        'hover:scale-110 active:scale-95'
      )}
      style={{
        bottom: bottomOffset,
      }}
      aria-label={t('scrollToBottom')}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  );
};
