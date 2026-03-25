import { cn } from '@lib/utils';
import { UserIcon } from 'lucide-react';

import type { UserTableTranslations } from './helpers';

interface UserTableStateProps {
  t: UserTableTranslations;
}

export function UserTableLoadingState({ t }: UserTableStateProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border shadow-sm',
        'border-stone-200/50 bg-white dark:border-stone-700/50 dark:bg-stone-800/50'
      )}
    >
      <div className="p-12 text-center">
        <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-b-2 border-stone-400"></div>
        <p className="font-serif text-lg text-stone-600 dark:text-stone-400">
          {t('table.loading')}
        </p>
        <p className="mt-2 font-serif text-sm text-stone-500">
          {t('table.loadingSubtext')}
        </p>
      </div>
    </div>
  );
}

export function UserTableEmptyState({ t }: UserTableStateProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-12 text-center shadow-sm',
        'border-stone-200/50 bg-white dark:border-stone-700/50 dark:bg-stone-800/50'
      )}
    >
      <div
        className={cn(
          'mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full',
          'bg-stone-100 dark:bg-stone-700/50'
        )}
      >
        <UserIcon
          className={cn('h-8 w-8', 'text-stone-400 dark:text-stone-500')}
        />
      </div>
      <h3
        className={cn(
          'mb-3 font-serif text-xl font-semibold',
          'text-stone-700 dark:text-stone-300'
        )}
      >
        {t('table.noData')}
      </h3>
      <p className={cn('mb-4 font-serif text-base', 'text-stone-500')}>
        {t('table.noDataSubtext')}
      </p>
      <p
        className={cn(
          'font-serif text-sm',
          'text-stone-400 dark:text-stone-600'
        )}
      >
        {t('table.noDataHint')}
      </p>
    </div>
  );
}
