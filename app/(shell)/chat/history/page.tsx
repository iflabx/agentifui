'use client';

import { History } from '@components/history';
import { cn } from '@lib/utils';

import { useEffect } from 'react';

/**
 * History page component.
 * @description Displays the history conversation list, integrates with the sidebar, and supports dynamic stretching. Mounting logic is simple and references the settings page implementation.
 * @returns The history conversation page.
 */
export default function HistoryPage() {
  useEffect(() => {
    // Page title is managed by the DynamicTitle component, no need to set manually.
  }, []);

  return (
    <div className={cn('h-full w-full overflow-hidden', 'pt-12')}>
      <History />
    </div>
  );
}
