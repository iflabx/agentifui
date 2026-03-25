import type { AccountStatus, UserRole } from '@lib/types/database';
import { cn } from '@lib/utils';
import {
  CheckSquare,
  Crown,
  Shield,
  UserCheck,
  UserIcon,
  UserX,
} from 'lucide-react';

import { useTranslations } from 'next-intl';

type BatchActionsBarProps = {
  isLoading: boolean;
  selectedCount: number;
  onClearSelection: () => void;
  onChangeRole: (role: UserRole) => void;
  onChangeStatus: (status: AccountStatus) => void;
};

export function BatchActionsBar({
  isLoading,
  selectedCount,
  onClearSelection,
  onChangeRole,
  onChangeStatus,
}: BatchActionsBarProps) {
  const t = useTranslations('pages.admin.users');

  return (
    <div
      className={cn(
        'mb-6 rounded-xl border border-stone-200/50 bg-white/80 p-5 shadow-lg shadow-stone-200/50 backdrop-blur-sm dark:border-stone-700/50 dark:bg-stone-800/60 dark:shadow-stone-900/20'
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
            )}
          >
            <CheckSquare className="h-4 w-4" />
          </div>
          <div>
            <span
              className={cn(
                'font-serif text-sm font-semibold',
                'text-stone-800 dark:text-stone-200'
              )}
            >
              {t('batchOperations.selected', { count: selectedCount })}
            </span>
            <button
              onClick={onClearSelection}
              className={cn(
                'ml-3 rounded-lg px-2 py-1 font-serif text-xs text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
              )}
            >
              {t('batchOperations.cancelSelection')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onChangeRole('admin')}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-purple-700'
            )}
          >
            <Shield className="h-3 w-3" />
            {t('batchOperations.setAsAdmin')}
          </button>

          <button
            onClick={() => onChangeRole('manager')}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-amber-700'
            )}
          >
            <Crown className="h-3 w-3" />
            {t('batchOperations.setAsManager')}
          </button>

          <button
            onClick={() => onChangeRole('user')}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-stone-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-stone-700'
            )}
          >
            <UserIcon className="h-3 w-3" />
            {t('batchOperations.setAsUser')}
          </button>

          <button
            onClick={() => onChangeStatus('active')}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-green-700'
            )}
          >
            <UserCheck className="h-3 w-3" />
            {t('batchOperations.activate')}
          </button>

          <button
            onClick={() => onChangeStatus('suspended')}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-red-700'
            )}
          >
            <UserX className="h-3 w-3" />
            {t('batchOperations.suspend')}
          </button>
        </div>
      </div>
    </div>
  );
}
