import { cn } from '@lib/utils';

import { useTranslations } from 'next-intl';

import { type UsersPagination, getPaginationRange } from './page-helpers';

type PaginationControlsProps = {
  pagination: UsersPagination;
  onPageChange: (page: number) => void;
};

export function PaginationControls({
  pagination,
  onPageChange,
}: PaginationControlsProps) {
  const t = useTranslations('pages.admin.users');

  if (pagination.totalPages <= 1) {
    return null;
  }

  const range = getPaginationRange(pagination);

  return (
    <div className="mt-6 flex items-center justify-between">
      <div
        className={cn(
          'font-serif text-sm',
          'text-stone-600 dark:text-stone-400'
        )}
      >
        {t('pagination.showing', range)}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1}
          className={cn(
            'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
            pagination.page <= 1
              ? 'cursor-not-allowed opacity-50'
              : 'border-stone-300 text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
          )}
        >
          {t('pagination.previous')}
        </button>

        <span
          className={cn(
            'px-3 py-1.5 font-serif text-sm',
            'text-stone-700 dark:text-stone-300'
          )}
        >
          {pagination.page} / {pagination.totalPages}
        </span>

        <button
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          className={cn(
            'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
            pagination.page >= pagination.totalPages
              ? 'cursor-not-allowed opacity-50'
              : 'border-stone-300 text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
          )}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
