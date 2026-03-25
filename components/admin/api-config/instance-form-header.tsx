import { useApiConfigStore } from '@lib/stores/api-config-store';
import { cn } from '@lib/utils';
import { Loader2, RefreshCw, Sliders, Star } from 'lucide-react';
import { toast } from 'sonner';

import { useTranslations } from 'next-intl';

interface InstanceFormHeaderProps {
  isEditing: boolean;
  instanceId?: string;
  instanceName: string;
  isCurrentDefault: boolean;
  setAsDefault: boolean;
  onToggleSetAsDefault: () => void;
  hasUnsavedChanges: boolean;
  isSyncing: boolean;
  canSync: boolean;
  onOpenDifyPanel: () => void;
  onSyncFromDify: () => void;
}

export function InstanceFormHeader({
  isEditing,
  instanceId,
  instanceName,
  isCurrentDefault,
  setAsDefault,
  onToggleSetAsDefault,
  hasUnsavedChanges,
  isSyncing,
  canSync,
  onOpenDifyPanel,
  onSyncFromDify,
}: InstanceFormHeaderProps) {
  const t = useTranslations('pages.admin.apiConfig.page');
  const tButtons = useTranslations('buttons');

  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h3
          className={cn(
            'font-serif text-lg font-bold',
            'text-stone-900 dark:text-stone-100'
          )}
        >
          {isEditing ? t('title.edit') : t('title.add')}
        </h3>

        {hasUnsavedChanges && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1.5 font-serif text-xs font-medium',
              'animate-pulse border border-dashed border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300'
            )}
          >
            <div
              className={cn(
                'h-2 w-2 rounded-full',
                'bg-amber-500 dark:bg-amber-400'
              )}
            />
            {t('unsavedChanges')}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {isEditing ? (
          <button
            type="button"
            onClick={() => {
              if (isCurrentDefault || !instanceId) {
                return;
              }

              if (
                confirm(
                  t('defaultApp.setDefaultConfirm', {
                    name: instanceName || 'this app',
                  })
                )
              ) {
                useApiConfigStore
                  .getState()
                  .setDefaultInstance(instanceId)
                  .then(() => {
                    toast.success(t('defaultApp.setDefaultSuccess'));
                  })
                  .catch(error => {
                    console.error('Failed to set default app:', error);
                    toast.error(t('defaultApp.setDefaultFailed'));
                  });
              }
            }}
            disabled={isCurrentDefault}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 transition-all',
              'border',
              isCurrentDefault
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:scale-105',
              isCurrentDefault
                ? 'border-stone-300/50 bg-stone-100/50 text-stone-500 dark:border-stone-600/50 dark:bg-stone-700/30 dark:text-stone-400'
                : 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
            )}
          >
            <Star
              className={cn('h-4 w-4', isCurrentDefault && 'fill-current')}
            />
            <span className="font-serif text-sm font-medium">
              {isCurrentDefault
                ? t('defaultApp.isDefault')
                : t('defaultApp.setAsDefault')}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleSetAsDefault}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all',
              'border hover:scale-105',
              setAsDefault
                ? 'border-stone-400 bg-stone-200 text-stone-800 dark:border-stone-500 dark:bg-stone-600 dark:text-stone-200'
                : 'border-stone-300 bg-stone-100 text-stone-700 hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
            )}
          >
            <Star className={cn('h-4 w-4', setAsDefault && 'fill-current')} />
            <span className="font-serif text-sm font-medium">
              {setAsDefault
                ? t('defaultApp.willSetAsDefault')
                : t('defaultApp.setAsDefault')}
            </span>
          </button>
        )}

        <div
          className={cn(
            'flex gap-2 rounded-lg p-2',
            'bg-stone-100/50 dark:bg-stone-800/50'
          )}
        >
          <button
            type="button"
            onClick={onOpenDifyPanel}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 transition-all',
              'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-stone-800 dark:bg-stone-700/50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
            )}
          >
            <Sliders className="h-4 w-4" />
            <span className="font-serif text-sm font-medium">
              {t('difyConfig.title')}
            </span>
          </button>

          <button
            type="button"
            onClick={onSyncFromDify}
            disabled={!canSync || isSyncing}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 transition-all',
              !canSync || isSyncing
                ? 'cursor-not-allowed border border-stone-200 bg-stone-200/50 text-stone-400 dark:bg-stone-800/50 dark:text-stone-500'
                : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-stone-800 dark:bg-stone-700/50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-200'
            )}
            title={
              isEditing
                ? tButtons('tooltip.syncFromDifyEdit')
                : canSync
                  ? tButtons('tooltip.syncFromDifyCreate')
                  : tButtons('tooltip.fillCredentials')
            }
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="font-serif text-sm font-medium">
              {isSyncing ? tButtons('syncInProgress') : tButtons('syncConfig')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
