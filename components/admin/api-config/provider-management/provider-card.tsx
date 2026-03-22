'use client';

import { Button } from '@components/ui/button';
import { useTheme } from '@lib/hooks/use-theme';
import { Provider } from '@lib/types/database';
import { cn } from '@lib/utils';
import { Edit, Trash2 } from 'lucide-react';

import { useTranslations } from 'next-intl';

import { getAuthTypeLabel, getProviderTypeLabel } from './provider-labels';

interface ProviderCardProps {
  provider: Provider;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  isEditing?: boolean;
  disabled?: boolean;
}

export function ProviderCard({
  provider,
  onEdit,
  onDelete,
  isEditing = false,
  disabled = false,
}: ProviderCardProps) {
  const { isDark } = useTheme();
  const t = useTranslations('pages.admin.apiConfig.providerManagement.modal');

  return (
    <div
      className={cn(
        'group rounded-xl border p-4 transition-all duration-200',
        isDark
          ? 'border-stone-700 bg-stone-800/50 hover:bg-stone-800/70'
          : 'border-stone-200 bg-stone-50/50 hover:bg-stone-100/70',
        isEditing &&
          (isDark
            ? 'border-stone-500 bg-stone-700/50 ring-1 ring-stone-500/50'
            : 'border-stone-400 bg-stone-100/50 ring-1 ring-stone-400/50'),
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              className={cn(
                'font-serif font-medium',
                isDark ? 'text-stone-100' : 'text-stone-900'
              )}
            >
              {provider.name}
            </h4>

            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 font-serif text-xs font-medium',
                isDark
                  ? 'bg-stone-700 text-stone-300'
                  : 'bg-stone-200 text-stone-700'
              )}
            >
              {getProviderTypeLabel(t, provider.type)}
            </span>

            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 font-serif text-xs font-medium',
                provider.is_active
                  ? isDark
                    ? 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700'
                    : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : isDark
                    ? 'bg-red-900/50 text-red-300 ring-1 ring-red-700'
                    : 'bg-red-50 text-red-700 ring-1 ring-red-200'
              )}
            >
              {provider.is_active ? t('status.enabled') : t('status.disabled')}
            </span>

            {provider.is_default && (
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-serif text-xs font-medium',
                  isDark
                    ? 'bg-blue-900/50 text-blue-300 ring-1 ring-blue-700'
                    : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                )}
              >
                {t('status.default')}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div
              className={cn(
                'flex items-center gap-2 font-serif text-sm',
                isDark ? 'text-stone-300' : 'text-stone-600'
              )}
            >
              <span className="font-medium">API URL:</span>
              <span className="break-all">{provider.base_url}</span>
            </div>
            <div
              className={cn(
                'flex items-center gap-2 font-serif text-sm',
                isDark ? 'text-stone-300' : 'text-stone-600'
              )}
            >
              <span className="font-medium">{t('form.authMethod')}:</span>
              <span>{getAuthTypeLabel(t, provider.auth_type)}</span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'ml-4 flex items-center gap-2 opacity-0 transition-opacity duration-200',
            'group-hover:opacity-100',
            disabled && 'pointer-events-none'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(provider)}
            disabled={disabled}
            className={cn(
              'h-9 w-9 rounded-lg p-0 transition-all duration-200 hover:scale-105 hover:shadow-sm',
              isDark
                ? 'text-stone-300 hover:border hover:border-blue-600/30 hover:bg-blue-800/20 hover:text-blue-300'
                : 'text-stone-600 hover:border hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
            )}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(provider)}
            disabled={disabled}
            className={cn(
              'h-9 w-9 rounded-lg p-0 transition-all duration-200 hover:scale-105 hover:shadow-sm',
              isDark
                ? 'text-red-400 hover:border hover:border-red-600/30 hover:bg-red-800/20 hover:text-red-300'
                : 'text-red-500 hover:border hover:border-red-200 hover:bg-red-50 hover:text-red-700'
            )}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
