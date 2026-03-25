import { cn } from '@lib/utils';

import type { SsoProviderProtocolTabProps } from './types';

export function SsoProviderProtocolTab({
  isDark,
  t,
  formData,
  handleSettingsChange,
}: SsoProviderProtocolTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <label
          className={cn(
            'mb-2 block font-serif text-sm font-medium',
            isDark ? 'text-stone-300' : 'text-stone-700'
          )}
        >
          {t('fields.baseUrl')}
        </label>
        <input
          type="url"
          value={formData.settings.protocol_config.base_url}
          onChange={event =>
            handleSettingsChange('protocol_config.base_url', event.target.value)
          }
          className={cn(
            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
            isDark
              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
          )}
          placeholder={t('fields.baseUrlPlaceholder')}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.loginEndpoint')}
          </label>
          <input
            type="text"
            value={formData.settings.protocol_config.endpoints.login}
            onChange={event =>
              handleSettingsChange(
                'protocol_config.endpoints.login',
                event.target.value
              )
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.loginEndpointPlaceholder')}
          />
        </div>

        <div>
          <label
            className={cn(
              'mb-2 block font-serif text-sm font-medium',
              isDark ? 'text-stone-300' : 'text-stone-700'
            )}
          >
            {t('fields.logoutEndpoint')}
          </label>
          <input
            type="text"
            value={formData.settings.protocol_config.endpoints.logout}
            onChange={event =>
              handleSettingsChange(
                'protocol_config.endpoints.logout',
                event.target.value
              )
            }
            className={cn(
              'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
              'focus:ring-2 focus:ring-offset-2 focus:outline-none',
              isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
            )}
            placeholder={t('fields.logoutEndpointPlaceholder')}
          />
        </div>
      </div>

      <div>
        <h3
          className={cn(
            'mb-4 font-serif text-lg font-semibold',
            isDark ? 'text-stone-200' : 'text-stone-800'
          )}
        >
          {t('fields.attributeMapping')}
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            [
              'employee_id',
              'fields.employeeId',
              'fields.employeeIdPlaceholder',
            ],
            ['username', 'fields.username', 'fields.usernamePlaceholder'],
            ['full_name', 'fields.fullName', 'fields.fullNamePlaceholder'],
            ['email', 'fields.email', 'fields.emailPlaceholder'],
          ].map(([field, labelKey, placeholderKey]) => (
            <div key={field}>
              <label
                className={cn(
                  'mb-2 block font-serif text-sm font-medium',
                  isDark ? 'text-stone-300' : 'text-stone-700'
                )}
              >
                {t(labelKey)}
              </label>
              <input
                type="text"
                value={
                  formData.settings.protocol_config.attributes_mapping[
                    field as keyof typeof formData.settings.protocol_config.attributes_mapping
                  ] || ''
                }
                onChange={event =>
                  handleSettingsChange(
                    `protocol_config.attributes_mapping.${field}`,
                    event.target.value
                  )
                }
                className={cn(
                  'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
                  'focus:ring-2 focus:ring-offset-2 focus:outline-none',
                  isDark
                    ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                    : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
                )}
                placeholder={t(placeholderKey)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
