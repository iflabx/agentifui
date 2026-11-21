'use client';

import { useTheme } from '@lib/hooks/use-theme';
import {
  type AppWithPermissions,
  usePermissionManagementStore,
} from '@lib/stores/permission-management-store';
import { cn } from '@lib/utils';
import { Building2, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

interface GroupPermissionListProps {
  app: AppWithPermissions;
}

export function GroupPermissionList({ app }: GroupPermissionListProps) {
  const { isDark } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
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
    if (loading.updating) return;
    setPendingGroupId(groupId);
    let success: boolean;
    try {
      success = await setGroupPermission(app.id, groupId, enabled);
    } finally {
      setPendingGroupId(null);
    }
    if (usePermissionManagementStore.getState().selectedApp?.id !== app.id)
      return;
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

  const permissions = new Map(
    app.groupPermissions.map(permission => [permission.group_id, permission])
  );
  const enabledCount = groups.filter(
    group => permissions.get(group.id)?.is_enabled
  ).length;
  const query = searchTerm.trim().toLocaleLowerCase();
  const filteredGroups = groups.filter(group => {
    const isEnabled = permissions.get(group.id)?.is_enabled || false;
    const matchesSearch =
      !query ||
      group.name.toLocaleLowerCase().includes(query) ||
      group.description?.toLocaleLowerCase().includes(query);
    return (
      matchesSearch &&
      (filter === 'all' || (filter === 'enabled' ? isEnabled : !isEnabled))
    );
  });

  return (
    <div>
      <div
        className={cn(
          'sticky top-0 z-10 space-y-2 border-b py-3',
          isDark ? 'border-stone-700 bg-stone-900' : 'border-stone-200 bg-white'
        )}
      >
        <p className="text-xs text-stone-500" aria-live="polite">
          {t('summary', { total: groups.length, enabled: enabledCount })}
          {' · '}
          {t('matchingCount', { count: filteredGroups.length })}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-stone-400"
            />
            <input
              type="search"
              name="groupPermissionSearch"
              aria-label={t('searchPlaceholder')}
              placeholder={t('searchPlaceholder')}
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              className={cn(
                'w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-stone-400 focus:outline-none',
                isDark
                  ? 'border-stone-700 bg-stone-800 text-stone-100'
                  : 'border-stone-200 bg-white text-stone-900'
              )}
            />
          </div>
          <select
            name="groupPermissionFilter"
            aria-label={t('filterLabel')}
            value={filter}
            onChange={event => setFilter(event.target.value)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-stone-400 focus:outline-none',
              isDark
                ? 'border-stone-700 bg-stone-800 text-stone-100'
                : 'border-stone-200 bg-white text-stone-900'
            )}
          >
            <option value="all">{t('filters.all')}</option>
            <option value="enabled">{t('filters.enabled')}</option>
            <option value="disabled">{t('filters.disabled')}</option>
          </select>
        </div>
      </div>
      {filteredGroups.length === 0 && (
        <p className="py-6 text-center text-sm text-stone-500">
          {t('noMatches')}
        </p>
      )}
      {filteredGroups.map(group => {
        const isEnabled = permissions.get(group.id)?.is_enabled || false;
        const isPending = pendingGroupId === group.id;

        return (
          <div
            key={group.id}
            className={cn(
              'border-b px-1 py-2.5',
              isDark
                ? 'border-stone-700 text-stone-100'
                : 'border-stone-200 text-stone-900'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h5
                  className={cn(
                    'truncate font-serif text-sm font-semibold',
                    isDark ? 'text-stone-100' : 'text-stone-900'
                  )}
                  title={group.name}
                >
                  {group.name}
                </h5>
                <p
                  className={cn(
                    'truncate font-serif text-xs',
                    isDark ? 'text-stone-400' : 'text-stone-600'
                  )}
                  title={group.description || undefined}
                >
                  {t('memberCount', { count: group.member_count || 0 })}
                  {group.description && ` • ${group.description}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
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
                  {isPending ? (
                    <span role="status" className="flex items-center gap-1">
                      <Loader2
                        aria-hidden="true"
                        className="h-3 w-3 animate-spin"
                      />
                      {t('saving')}
                    </span>
                  ) : isEnabled ? (
                    t('status.enabled')
                  ) : (
                    t('status.disabled')
                  )}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-busy={isPending}
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
