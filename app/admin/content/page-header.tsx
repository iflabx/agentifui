import { ContentTabs } from '@components/admin/content/content-tabs';
import { cn } from '@lib/utils';
import { Eye } from 'lucide-react';

import { useTranslations } from 'next-intl';

type ContentManagementHeaderProps = {
  activeTab: 'about' | 'home';
  showPreview: boolean;
  onShowPreview: () => void;
  onTabChange: (tab: 'about' | 'home') => void;
};

export function ContentManagementHeader({
  activeTab,
  showPreview,
  onShowPreview,
  onTabChange,
}: ContentManagementHeaderProps) {
  const t = useTranslations('pages.admin.content.page');

  return (
    <div className={cn('flex-shrink-0', 'bg-stone-50 dark:bg-stone-900')}>
      <div className="w-full px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1
              className={cn(
                'text-xl font-semibold',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {t('title')}
            </h1>
            <p
              className={cn(
                'hidden text-sm md:block',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {!showPreview && (
              <button
                onClick={onShowPreview}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition-colors',
                  'border border-stone-200 bg-white text-stone-600 hover:bg-stone-100',
                  'dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                )}
              >
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline">{t('showPreview')}</span>
              </button>
            )}
            <ContentTabs activeTab={activeTab} onTabChange={onTabChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
