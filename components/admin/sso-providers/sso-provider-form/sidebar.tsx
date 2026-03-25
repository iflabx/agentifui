import { cn } from '@lib/utils';
import { Code } from 'lucide-react';

import { getTabColorClasses } from './constants';
import type { SsoProviderSidebarProps } from './types';

export function SsoProviderSidebar({
  activeTab,
  isDark,
  showRawJson,
  tabs,
  onSelectTab,
  onToggleRawJson,
  t,
}: SsoProviderSidebarProps) {
  return (
    <div
      className={cn(
        'w-64 border-r p-6',
        isDark
          ? 'border-stone-700/50 bg-stone-800/50'
          : 'border-stone-200/50 bg-stone-50/50'
      )}
    >
      <div className="space-y-2">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-4 py-3 font-serif text-sm font-medium transition-all duration-200',
                isActive
                  ? getTabColorClasses(tab.color, true, isDark)
                  : cn(
                      'border-transparent',
                      getTabColorClasses(tab.color, false, isDark),
                      isDark ? 'hover:bg-stone-700/50' : 'hover:bg-stone-100/50'
                    )
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          'mt-6 border-t pt-6',
          isDark ? 'border-stone-700/50' : 'border-stone-200/50'
        )}
      >
        <button
          onClick={onToggleRawJson}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border px-4 py-3 font-serif text-sm font-medium transition-all duration-200',
            showRawJson
              ? isDark
                ? 'border-amber-500/50 bg-amber-900/20 text-amber-400'
                : 'border-amber-500/50 bg-amber-50 text-amber-700'
              : cn(
                  'border-transparent',
                  isDark
                    ? 'text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                    : 'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700'
                )
          )}
        >
          <Code className="h-4 w-4" />
          {showRawJson ? t('hideRawJson') : t('showRawJson')}
        </button>
      </div>
    </div>
  );
}
