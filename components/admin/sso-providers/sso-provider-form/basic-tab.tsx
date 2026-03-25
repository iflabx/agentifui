import type { SsoProtocol } from '@lib/types/database';
import { cn } from '@lib/utils';

import type { SsoProviderBasicTabProps } from './types';

export function SsoProviderBasicTab({
  isDark,
  t,
  formData,
  setFormData,
  handleProtocolChange,
  handleSettingsChange,
  protocolIcons,
}: SsoProviderBasicTabProps) {
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
            {t('fields.providerName')}
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={event =>
              setFormData(prev => ({ ...prev, name: event.target.value }))
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.providerNamePlaceholder')}
            required
          />
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.protocol')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['CAS', 'SAML', 'OAuth2', 'OIDC'] as SsoProtocol[]).map(
              protocol => {
                const Icon = protocolIcons[protocol];
                const isSelected = formData.protocol === protocol;

                return (
                  <button
                    key={protocol}
                    type="button"
                    onClick={() => handleProtocolChange(protocol)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 font-serif text-sm transition-all duration-200',
                      isSelected
                        ? isDark
                          ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-400'
                          : 'border-emerald-500/50 bg-emerald-50 text-emerald-700'
                        : isDark
                          ? 'border-stone-600 text-stone-400 hover:border-stone-500 hover:bg-stone-700/50'
                          : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50/80'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {protocol}
                  </button>
                );
              }
            )}
          </div>
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.displayOrder')}
          </label>
          <input
            type="number"
            value={formData.display_order}
            onChange={event =>
              setFormData(prev => ({
                ...prev,
                display_order: parseInt(event.target.value, 10) || 0,
              }))
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            min="0"
          />
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.buttonText')}
          </label>
          <input
            type="text"
            value={formData.button_text || ''}
            onChange={event =>
              setFormData(prev => ({
                ...prev,
                button_text: event.target.value || null,
              }))
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.buttonTextPlaceholder')}
          />
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.emailDomain')}
          </label>
          <input
            type="text"
            value={
              typeof formData.settings.email_domain === 'string'
                ? formData.settings.email_domain
                : ''
            }
            onChange={event =>
              handleSettingsChange('email_domain', event.target.value)
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.emailDomainPlaceholder')}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            setFormData(prev => ({
              ...prev,
              enabled: !prev.enabled,
            }))
          }
          className={cn(
            'relative h-6 w-11 rounded-full border-2 transition-colors',
            formData.enabled
              ? isDark
                ? 'border-emerald-500 bg-emerald-500'
                : 'border-emerald-600 bg-emerald-600'
              : isDark
                ? 'border-stone-600 bg-stone-700'
                : 'border-stone-300 bg-stone-200'
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
              formData.enabled ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </button>
        <label
          className={cn(
            'font-serif text-sm font-medium',
            isDark ? 'text-stone-300' : 'text-stone-700'
          )}
        >
          {t('fields.enableProvider')}
        </label>
      </div>
    </div>
  );
}
