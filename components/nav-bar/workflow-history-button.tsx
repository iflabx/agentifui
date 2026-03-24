'use client';

import { useTheme } from '@lib/hooks/use-theme';
import { useWorkflowHistoryStore } from '@lib/stores/workflow-history-store';
import { cn } from '@lib/utils';
import { History } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

/**
 * Workflow history button component (NavBar version)
 *
 * Only displayed on workflow and text generation pages
 */
export function WorkflowHistoryButton() {
  const { isDark } = useTheme();
  const pathname = usePathname() ?? '';
  const { showHistory, toggleHistory } = useWorkflowHistoryStore();
  const t = useTranslations('navbar.workflow');

  // Check if it is on the workflow or text generation page
  const isWorkflowPage =
    pathname?.includes('/apps/workflow/') ||
    pathname?.includes('/apps/text-generation/');

  if (!isWorkflowPage) {
    return null;
  }

  return (
    <button
      onClick={toggleHistory}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-200',
        'font-serif text-sm font-medium',
        showHistory
          ? isDark
            ? 'bg-stone-600 text-stone-100 shadow-lg'
            : 'bg-stone-700 text-white shadow-lg'
          : isDark
            ? 'border border-stone-600 text-stone-300 hover:bg-stone-700/80 hover:text-stone-100'
            : 'border border-stone-300 text-stone-700 hover:bg-stone-100 hover:text-stone-900'
      )}
      title={showHistory ? t('closeHistory') : t('viewHistory')}
    >
      <History className="h-4 w-4" />
      <span className="hidden sm:inline">
        {showHistory ? t('closeHistoryShort') : t('historyShort')}
      </span>
    </button>
  );
}
