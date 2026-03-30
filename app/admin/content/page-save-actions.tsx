import { cn } from '@lib/utils';
import { Languages } from 'lucide-react';

import { useTranslations } from 'next-intl';

type ContentSaveActionsProps = {
  hasChanges: boolean;
  isSaving: boolean;
  isTranslating?: boolean;
  onReset: () => void;
  onSave: () => void;
  onTranslateAll?: () => void;
};

export function ContentSaveActions({
  hasChanges,
  isSaving,
  isTranslating = false,
  onReset,
  onSave,
  onTranslateAll,
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
          {onTranslateAll && (
            <button
              onClick={onTranslateAll}
              disabled={isSaving || isTranslating}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors',
                isSaving || isTranslating
                  ? 'cursor-not-allowed border border-stone-200 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-500'
                  : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
              )}
            >
              <Languages className="h-4 w-4" />
              <span>
                {isTranslating
                  ? t('saveActions.translatingAll')
                  : t('saveActions.translateAll')}
              </span>
            </button>
          )}
          <button
            onClick={onReset}
            disabled={!hasChanges || isSaving || isTranslating}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              !hasChanges || isSaving || isTranslating
                ? 'cursor-not-allowed text-stone-500'
                : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
            )}
          >
            {t('saveActions.reset')}
          </button>
          <button
            onClick={onSave}
            disabled={!hasChanges || isSaving || isTranslating}
            className={cn(
              'rounded-lg px-6 py-2 text-sm font-medium shadow-sm transition-colors',
              !hasChanges || isSaving || isTranslating
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
