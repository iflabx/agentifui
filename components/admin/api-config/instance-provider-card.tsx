import { CustomProviderSelector } from '@components/admin/api-config/custom-provider-selector';
import type { Provider } from '@lib/stores/api-config-store';
import { cn } from '@lib/utils';

import { useTranslations } from 'next-intl';

interface InstanceProviderCardProps {
  isEditing: boolean;
  providers: Provider[];
  selectedProviderId: string;
  currentProviderName: string;
  onProviderChange: (providerId: string) => void;
}

export function InstanceProviderCard({
  isEditing,
  providers,
  selectedProviderId,
  currentProviderName,
  onProviderChange,
}: InstanceProviderCardProps) {
  const t = useTranslations('pages.admin.apiConfig.page');

  return (
    <div
      className={cn(
        'mb-6 rounded-lg border p-4',
        'border-stone-200 bg-stone-50 dark:border-stone-600 dark:bg-stone-700/50'
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3
            className={cn(
              'font-serif text-sm font-medium',
              'text-stone-800 dark:text-stone-200'
            )}
          >
            {t('provider.title')}
          </h3>
          <p
            className={cn(
              'mt-1 font-serif text-xs',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {isEditing ? t('provider.current') : t('provider.select')}
          </p>
        </div>

        {isEditing ? (
          <div
            className={cn(
              'rounded-md px-3 py-1.5 font-serif text-sm',
              'bg-stone-200 text-stone-700 dark:bg-stone-600 dark:text-stone-200'
            )}
          >
            {currentProviderName}
          </div>
        ) : (
          <div className="w-48">
            <CustomProviderSelector
              providers={providers}
              selectedProviderId={selectedProviderId}
              onProviderChange={onProviderChange}
              placeholder={t('provider.selectPlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
