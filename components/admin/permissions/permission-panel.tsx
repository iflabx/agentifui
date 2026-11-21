'use client';

import { useTheme } from '@lib/hooks/use-theme';
import { usePermissionManagementStore } from '@lib/stores/permission-management-store';
import { cn } from '@lib/utils';
import { Blocks, Globe, Lock, Users } from 'lucide-react';

import { useTranslations } from 'next-intl';

import { GroupPermissionList } from './group-permission-list';
import { VisibilitySelector } from './visibility-selector';

export function PermissionPanel() {
  const { isDark } = useTheme();
  const { selectedApp } = usePermissionManagementStore();
  const t = useTranslations('pages.admin.permissions.permissionPanel');

  if (!selectedApp) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <Blocks
            className={cn(
              'mx-auto mb-3 h-12 w-12',
              isDark ? 'text-stone-400' : 'text-stone-500'
            )}
          />
          <h3
            className={cn(
              'mb-1 font-serif text-base font-semibold',
              isDark ? 'text-stone-200' : 'text-stone-800'
            )}
          >
            {t('selectApp.title')}
          </h3>
          <p
            className={cn(
              'font-serif text-xs',
              isDark ? 'text-stone-400' : 'text-stone-600'
            )}
          >
            {t('selectApp.description')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-4">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl',
                isDark ? 'bg-stone-700' : 'bg-stone-100'
              )}
            >
              <Blocks
                className={cn(
                  'h-5 w-5',
                  isDark ? 'text-stone-300' : 'text-stone-600'
                )}
              />
            </div>
            <div>
              <h3
                className={cn(
                  'font-serif text-lg font-semibold',
                  isDark ? 'text-stone-100' : 'text-stone-900'
                )}
              >
                {selectedApp.display_name || selectedApp.instance_id}
              </h3>
              {selectedApp.description && (
                <p
                  className={cn(
                    'font-serif text-xs',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                >
                  {selectedApp.description}
                </p>
              )}
            </div>
          </div>
        </div>

        <div>
          <h4
            className={cn(
              'mb-2 font-serif text-base font-semibold',
              isDark ? 'text-stone-200' : 'text-stone-800'
            )}
          >
            {t('visibilitySettings.title')}
          </h4>
          <VisibilitySelector app={selectedApp} />
          <p className="mt-2 text-xs text-stone-500">
            {t('visibilitySettings.retainedGroups')}
          </p>
        </div>

        {selectedApp.visibility === 'group_only' && (
          <div>
            <h4
              className={cn(
                'mb-2 font-serif text-base font-semibold',
                isDark ? 'text-stone-200' : 'text-stone-800'
              )}
            >
              {t('groupPermissions.title')}
            </h4>
            <p
              className={cn(
                'mb-3 font-serif text-xs',
                isDark ? 'text-stone-400' : 'text-stone-600'
              )}
            >
              {t('groupPermissions.description')}
            </p>
            <GroupPermissionList key={selectedApp.id} app={selectedApp} />
          </div>
        )}

        <div
          className={cn(
            'rounded-lg border p-3',
            isDark
              ? 'border-stone-700 bg-stone-800'
              : 'border-stone-200 bg-stone-50'
          )}
        >
          <h5
            className={cn(
              'mb-2 font-serif text-xs font-semibold',
              isDark ? 'text-stone-200' : 'text-stone-800'
            )}
          >
            {t('permissionExplanation.title')}
          </h5>
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <Globe className="h-3 w-3 text-green-500" />
              <span
                className={cn(
                  'font-serif',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('permissionExplanation.public')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-3 w-3 text-blue-500" />
              <span
                className={cn(
                  'font-serif',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('permissionExplanation.groupOnly')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="h-3 w-3 text-purple-500" />
              <span
                className={cn(
                  'font-serif',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('permissionExplanation.private')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
