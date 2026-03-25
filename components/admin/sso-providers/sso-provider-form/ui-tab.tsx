import { cn } from '@lib/utils';

import type { SsoProviderUiTabProps } from './types';

export function SsoProviderUiTab({
  isDark,
  t,
  formData,
  handleSettingsChange,
}: SsoProviderUiTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.icon')}
          </label>
          <input
            type="text"
            value={formData.settings.ui.icon || ''}
            onChange={event =>
              handleSettingsChange('ui.icon', event.target.value)
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.iconPlaceholder')}
          />
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.theme')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['primary', 'secondary', 'default', 'outline'] as const).map(
              theme => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => handleSettingsChange('ui.theme', theme)}
                  className={cn(
                    'rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                    formData.settings.ui.theme === theme
                      ? isDark
                        ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400'
                        : 'border-emerald-500/50 bg-emerald-50 text-emerald-700'
                      : isDark
                        ? 'border-stone-600 text-stone-400 hover:border-stone-500 hover:bg-stone-700/50'
                        : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50/80'
                  )}
                >
                  {t(`themes.${theme}`)}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div>
        <label
          className={cn(
            'mb-2 block font-serif text-sm font-medium',
            isDark ? 'text-stone-300' : 'text-stone-700'
          )}
        >
          {t('fields.description')}
        </label>
        <textarea
          value={formData.settings.ui.description || ''}
          onChange={event =>
            handleSettingsChange('ui.description', event.target.value)
          }
          className={cn(
            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
            isDark
              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
          )}
          placeholder={t('fields.descriptionPlaceholder')}
          rows={3}
        />
      </div>
    </div>
  );
}
