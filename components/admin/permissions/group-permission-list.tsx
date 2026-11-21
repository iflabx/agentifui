'use client';

import { useTheme } from '@lib/hooks/use-theme';
import {
  type AppWithPermissions,
  usePermissionManagementStore,
} from '@lib/stores/permission-management-store';
import { cn } from '@lib/utils';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';

import { useTranslations } from 'next-intl';

interface GroupPermissionListProps {
  app: AppWithPermissions;
}

export function GroupPermissionList({ app }: GroupPermissionListProps) {
  const { isDark } = useTheme();
  const {
    groups,
    setGroupPermission,
    loading,
    groupsLoaded,
    permissionStatus,
    permissionError,
    loadGroups,
    loadAppPermissions,
  } = usePermissionManagementStore();
  const t = useTranslations(
    'pages.admin.permissions.permissionPanel.groupPermissions'
  );
  const tMessages = useTranslations('pages.admin.permissions.messages');

  const handleTogglePermission = async (groupId: string, enabled: boolean) => {
    const success = await setGroupPermission(app.id, groupId, enabled);
    if (success) {
      if (
        usePermissionManagementStore.getState().permissionStatus === 'error'
      ) {
        toast.warning(tMessages('permissionRefreshFailed'));
        return;
      }
      const groupName = groups.find(g => g.id === groupId)?.name || 'Group';
      const messageKey = enabled
        ? 'groupPermissionEnabled'
        : 'groupPermissionDisabled';
      toast.success(tMessages(messageKey, { groupName }));
    }
  };

  if (permissionStatus === 'error') {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('loadFailed')}</p>
        <p>{permissionError}</p>
        <button
          type="button"
          onClick={() =>
            groupsLoaded ? loadAppPermissions(app.id) : loadGroups()
          }
          disabled={loading.groups}
          className="underline"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (permissionStatus !== 'ready' || loading.groups) {
    return (
      <p role="status" className="text-sm">
        {t('loading')}
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border p-6 text-center',
          isDark
            ? 'border-stone-700 bg-stone-800'
            : 'border-stone-200 bg-stone-50'
        )}
      >
        <Building2
          className={cn(
            'mx-auto mb-3 h-10 w-10',
            isDark ? 'text-stone-400' : 'text-stone-500'
          )}
        />
        <h3
          className={cn(
            'mb-1 font-serif text-base font-semibold',
            isDark ? 'text-stone-200' : 'text-stone-800'
          )}
        >
          {t('noGroups.title')}
        </h3>
        <p
          className={cn(
            'font-serif text-xs',
            isDark ? 'text-stone-400' : 'text-stone-600'
          )}
        >
          {t('noGroups.description')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map(group => {
        const groupPermission = app.groupPermissions.find(
          p => p.group_id === group.id
        );
        const isEnabled = groupPermission?.is_enabled || false;

        return (
          <div
            key={group.id}
            className={cn(
              'rounded-lg border p-3 transition-all duration-200',
              isDark
                ? 'border-stone-700 bg-stone-800'
                : 'border-stone-200 bg-white'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg',
                    isDark ? 'bg-stone-700' : 'bg-stone-100'
                  )}
                >
                  <Building2
                    className={cn(
                      'h-4 w-4',
                      isDark ? 'text-stone-300' : 'text-stone-600'
                    )}
                  />
                </div>
                <div>
                  <h5
                    className={cn(
                      'font-serif text-sm font-semibold',
                      isDark ? 'text-stone-100' : 'text-stone-900'
                    )}
                  >
                    {group.name}
                  </h5>
                  <p
                    className={cn(
                      'font-serif text-xs',
                      isDark ? 'text-stone-400' : 'text-stone-600'
                    )}
                  >
                    {t('memberCount', { count: group.member_count || 0 })}
                    {group.description && ` • ${group.description}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'font-serif text-xs font-medium',
                    isEnabled
                      ? 'text-green-600'
                      : isDark
                        ? 'text-stone-400'
                        : 'text-stone-600'
                  )}
                >
                  {isEnabled ? t('status.enabled') : t('status.disabled')}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`${group.name}: ${isEnabled ? t('actions.disable') : t('actions.enable')}`}
                  onClick={() => handleTogglePermission(group.id, !isEnabled)}
                  disabled={loading.updating}
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    isEnabled
                      ? 'bg-green-600'
                      : isDark
                        ? 'bg-stone-700'
                        : 'bg-stone-300'
                  )}
                  title={isEnabled ? t('actions.disable') : t('actions.enable')}
                >
                  <span
                    className={cn(
                      'inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200',
                      isEnabled ? 'translate-x-5' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
