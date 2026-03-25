import { cn } from '@lib/utils';

import type { SsoProviderSecurityTabProps } from './types';

function SecurityToggle({
  checked,
  isDark,
  label,
  onClick,
}: {
  checked: boolean;
  isDark: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'relative h-6 w-11 rounded-full border-2 transition-colors',
          checked
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
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
      <label
        className={cn(
          'font-serif text-sm font-medium',
          isDark ? 'text-stone-300' : 'text-stone-700'
        )}
      >
        {label}
      </label>
    </div>
  );
}

export function SsoProviderSecurityTab({
  isDark,
  t,
  formData,
  handleSettingsChange,
}: SsoProviderSecurityTabProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <SecurityToggle
          checked={formData.settings.security.require_https}
          isDark={isDark}
          label={t('fields.requireHttps')}
          onClick={() =>
            handleSettingsChange(
              'security.require_https',
              !formData.settings.security.require_https
            )
          }
        />
        <SecurityToggle
          checked={formData.settings.security.validate_certificates}
          isDark={isDark}
          label={t('fields.validateCertificates')}
          onClick={() =>
            handleSettingsChange(
              'security.validate_certificates',
              !formData.settings.security.validate_certificates
            )
          }
        />
      </div>

      <div>
        <label
          className={cn(
            'mb-2 block font-serif text-sm font-medium',
            isDark ? 'text-stone-300' : 'text-stone-700'
          )}
        >
          {t('fields.allowedRedirectHosts')}
        </label>
        <textarea
          value={
            formData.settings.security.allowed_redirect_hosts?.join('\n') || ''
          }
          onChange={event =>
            handleSettingsChange(
              'security.allowed_redirect_hosts',
              event.target.value.split('\n').filter(Boolean)
            )
          }
          className={cn(
            'w-full rounded-lg border px-4 py-3 font-serif text-sm transition-colors',
            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
            isDark
              ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
              : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
          )}
          placeholder={t('fields.allowedRedirectHostsPlaceholder')}
          rows={4}
        />
        <p
          className={cn(
            'mt-2 font-serif text-xs',
            isDark ? 'text-stone-400' : 'text-stone-600'
          )}
        >
          {t('fields.allowedRedirectHostsHint')}
        </p>
      </div>
    </div>
  );
}
