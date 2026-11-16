'use client';

import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { cn } from '@lib/utils';
import { Workflow } from 'lucide-react';

import React, { type RefObject } from 'react';

import { useTranslations } from 'next-intl';

interface ChatflowFloatingControllerProps {
  isVisible: boolean;
  isTrackerVisible: boolean;
  onToggleTracker: () => void;
  className?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Chatflow floating controller component
 *
 * Features:
 * - Floating ball-shaped controller
 * - Click to directly switch the display/hide of the node tracker
 * - Temporary UI, can be completely closed
 */
export function ChatflowFloatingController({
  isVisible,
  isTrackerVisible,
  onToggleTracker,
  className,
  buttonRef,
}: ChatflowFloatingControllerProps) {
  const t = useTranslations('pages.chatflow.floatingController');

  // Get execution status from store
  const isExecuting = useChatflowExecutionStore(state => state.isExecuting);
  const error = useChatflowExecutionStore(state => state.error);

  // As long as isVisible is true, the floating ball is displayed, regardless of whether there are nodes executing
  if (!isVisible) {
    return null;
  }

  const handleToggleTracker = () => {
    onToggleTracker();
  };

  const getStatusColor = () => {
    if (error) return 'text-red-500';
    if (isExecuting) return 'text-yellow-500';
    return 'text-green-500';
  };

  return (
    <div className={cn('fixed right-4 bottom-24 z-20', className)}>
      {/* Floating ball - click to directly switch the node tracker */}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isTrackerVisible}
        aria-label={isTrackerVisible ? t('hideTracker') : t('showTracker')}
        onClick={handleToggleTracker}
        className={cn(
          'h-12 w-12 rounded-full shadow-lg transition-all duration-200',
          'flex items-center justify-center',
          'hover:scale-105 hover:shadow-xl active:scale-95',
          'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
        )}
        title={isTrackerVisible ? t('hideTracker') : t('showTracker')}
      >
        <Workflow className={cn('h-5 w-5', getStatusColor())} />
      </button>
    </div>
  );
}
