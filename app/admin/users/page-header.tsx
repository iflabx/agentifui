import { cn } from '@lib/utils';
import { Plus, RefreshCw, Users } from 'lucide-react';

import { useTranslations } from 'next-intl';

type UsersPageHeaderProps = {
  isRefreshing: boolean;
  onAddUser: () => void;
  onRefresh: () => void;
};

export function UsersPageHeader({
  isRefreshing,
  onAddUser,
  onRefresh,
}: UsersPageHeaderProps) {
  const t = useTranslations('pages.admin.users');

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1
          className={cn(
            'mb-3 bg-gradient-to-r from-stone-800 to-stone-600 bg-clip-text font-serif text-4xl leading-relaxed font-bold text-transparent dark:from-stone-100 dark:to-stone-300'
          )}
        >
          {t('title')}
        </h1>
        <p
          className={cn(
            'flex items-center gap-2 font-serif text-base',
            'text-stone-600 dark:text-stone-400'
          )}
        >
          <Users className="h-4 w-4" />
          {t('subtitle')}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={cn(
            'flex items-center gap-2 rounded-xl border px-4 py-2.5 font-serif shadow-sm transition-all duration-200',
            isRefreshing
              ? 'cursor-not-allowed opacity-50'
              : 'border-stone-300/50 text-stone-700 backdrop-blur-sm hover:border-stone-400 hover:bg-stone-50/80 hover:shadow-md dark:border-stone-600/50 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-700/50 dark:hover:shadow-md'
          )}
        >
          <RefreshCw
            className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
          />
          <span className="hidden sm:inline">{t('actions.refreshData')}</span>
        </button>

        <button
          onClick={onAddUser}
          className={cn(
            'flex items-center gap-2 rounded-xl bg-gradient-to-r from-stone-700 to-stone-800 px-4 py-2.5 font-serif text-white shadow-sm transition-all duration-200 hover:from-stone-600 hover:to-stone-700 hover:shadow-md dark:from-stone-600 dark:to-stone-700 dark:hover:from-stone-500 dark:hover:to-stone-600'
          )}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('actions.addUser')}</span>
        </button>
      </div>
    </div>
  );
}
