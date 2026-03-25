import { cn } from '@lib/utils';

import type { ReactNode } from 'react';

import { useTranslations } from 'next-intl';

type ContentFullscreenPreviewProps = {
  activeTab: 'about' | 'home';
  isOpen: boolean;
  title?: string | null;
  onClose: () => void;
  children: ReactNode;
};

export function ContentFullscreenPreview({
  activeTab,
  isOpen,
  title,
  onClose,
  children,
}: ContentFullscreenPreviewProps) {
  const t = useTranslations('pages.admin.content.page');

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
      <div className="flex h-full flex-col">
        <div
          className={cn(
            'flex flex-shrink-0 items-center justify-between px-4 py-3',
            'bg-white/50 dark:bg-stone-800/50'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'h-3 w-3 rounded-full',
                'bg-stone-400 dark:bg-stone-600'
              )}
            />
            <span
              className={cn(
                'text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('fullscreenPreview')} -
              {title || (activeTab === 'about' ? 'About' : 'Home')}
            </span>
          </div>
          <button
            onClick={onClose}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-stone-100 text-stone-700 hover:bg-stone-200',
              'dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600'
            )}
          >
            {t('closePreview')}
          </button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
