import { cn } from '@lib/utils';

import { useTranslations } from 'next-intl';

type ContentSaveActionsProps = {
  hasChanges: boolean;
  isSaving: boolean;
  onReset: () => void;
  onSave: () => void;
};

export function ContentSaveActions({
  hasChanges,
  isSaving,
  onReset,
  onSave,
}: ContentSaveActionsProps) {
  const t = useTranslations('pages.admin.content.page');

  return (
    <div className={cn('flex-shrink-0 p-4', 'bg-white dark:bg-stone-900')}>
      <div className="flex items-center justify-between">
        <div>
          {hasChanges && (
            <div
              className={cn(
                'flex items-center gap-2 text-sm',
                'text-stone-500 dark:text-stone-400'
              )}
            >
              <div className="h-2 w-2 rounded-full bg-orange-500" />
              <span>{t('saveActions.hasChanges')}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onReset}
            disabled={!hasChanges || isSaving}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              !hasChanges || isSaving
                ? 'cursor-not-allowed text-stone-500'
                : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
            )}
          >
            {t('saveActions.reset')}
          </button>
          <button
            onClick={onSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              'rounded-lg px-6 py-2 text-sm font-medium shadow-sm transition-colors',
              !hasChanges || isSaving
                ? 'cursor-not-allowed bg-stone-300 text-stone-500 dark:bg-stone-700 dark:text-stone-400'
                : 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white'
            )}
          >
            {isSaving ? t('saveActions.saving_') : t('saveActions.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
