import { cn } from '@lib/utils';
import { AlertCircle } from 'lucide-react';

import type { SsoProviderRawJsonEditorProps } from './types';

export function SsoProviderRawJsonEditor({
  isDark,
  jsonError,
  onChange,
  t,
  value,
}: SsoProviderRawJsonEditorProps) {
  return (
    <div className="mb-6">
      <label
        className={cn(
          'mb-3 block font-serif text-sm font-medium',
          isDark ? 'text-stone-300' : 'text-stone-700'
        )}
      >
        {t('rawJsonConfig')}
      </label>
      <div className="relative">
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          className={cn(
            'w-full rounded-lg border p-4 font-mono text-sm transition-colors',
            'focus:ring-2 focus:ring-offset-2 focus:outline-none',
            jsonError
              ? isDark
                ? 'border-red-500 bg-red-900/20 text-red-200 focus:ring-red-500/30'
                : 'border-red-500 bg-red-50 text-red-900 focus:ring-red-500/30'
              : isDark
                ? 'border-stone-600 bg-stone-800/50 text-stone-200 focus:border-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:border-stone-400 focus:ring-stone-400/30 focus:ring-offset-white'
          )}
          rows={20}
          placeholder={t('rawJsonConfig')}
        />
        {jsonError && (
          <div className="mt-2 flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            {jsonError}
          </div>
        )}
      </div>
    </div>
  );
}
