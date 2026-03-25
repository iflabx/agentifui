import { cn } from '@lib/utils';
import { AlertCircle, Lightbulb } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { useTranslations } from 'next-intl';

interface InstanceIdFieldProps {
  value: string;
  isEditing: boolean;
  error: string;
  onChange: (value: string) => void;
}

export function InstanceIdField({
  value,
  isEditing,
  error,
  onChange,
}: InstanceIdFieldProps) {
  const t = useTranslations('pages.admin.apiConfig.page');

  return (
    <div>
      <label
        className={cn(
          'mb-2 block font-serif text-sm font-medium',
          'text-stone-700 dark:text-stone-300'
        )}
      >
        {t('fields.instanceId.label')}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          className={cn(
            'w-full rounded-lg border px-3 py-2 font-serif',
            !isEditing && 'pr-20',
            'border-stone-300 bg-white text-stone-900 placeholder-stone-500 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100 dark:placeholder-stone-400',
            isEditing && 'cursor-not-allowed bg-stone-100 dark:bg-stone-800',
            error && 'border-red-500'
          )}
          placeholder={t('fields.instanceId.placeholder')}
          required
          disabled={isEditing}
        />

        {!isEditing && (
          <button
            type="button"
            onClick={() => onChange(uuidv4())}
            className={cn(
              'absolute top-1/2 right-2 -translate-y-1/2 transform',
              'flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all',
              'border shadow-sm hover:scale-105 hover:shadow-md',
              'font-serif font-medium',
              'border-stone-300 bg-gradient-to-r from-stone-100 to-stone-200 text-stone-700 hover:from-stone-200 hover:to-stone-300 hover:text-stone-800 dark:border-stone-500 dark:bg-gradient-to-r dark:from-stone-600 dark:to-stone-700 dark:text-stone-200 dark:hover:from-stone-500 dark:hover:to-stone-600 dark:hover:text-white'
            )}
            title={t('fields.instanceId.generateTooltip')}
          >
            <Lightbulb className="h-3 w-3" />
            <span>{t('fields.instanceId.generateButton')}</span>
          </button>
        )}
      </div>

      {isEditing ? (
        <p
          className={cn(
            'mt-1 font-serif text-xs',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {t('validation.instanceId.notModifiable')}
        </p>
      ) : (
        <p
          className={cn(
            'mt-1 font-serif text-xs',
            'text-stone-500 dark:text-stone-400'
          )}
        >
          {t('validation.instanceId.formatDescription')}
        </p>
      )}

      {error && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 font-serif text-xs text-red-500'
          )}
        >
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
