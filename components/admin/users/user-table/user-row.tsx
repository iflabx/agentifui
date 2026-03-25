import { UserAvatar } from '@components/ui';
import type { EnhancedUser } from '@lib/db/users';
import {
  DateFormatPresets,
  type useDateFormatter,
} from '@lib/hooks/use-date-formatter';
import type { AccountStatus, UserRole } from '@lib/types/database';
import { cn } from '@lib/utils';
import { CheckSquare, Square } from 'lucide-react';

import {
  type UserTableTranslations,
  formatUserPhone,
  getBadgeClasses,
  getMoreGroupsTooltip,
  getRoleInfo,
  getStatusInfo,
} from './helpers';
import { UserRowActions } from './row-actions';

type FormatDateFn = ReturnType<typeof useDateFormatter>['formatDate'];

interface UserTableRowProps {
  currentUserId?: string | null;
  currentUserRole?: UserRole | null;
  formatDate: FormatDateFn;
  isSelected: boolean;
  onDeleteUser: (user: EnhancedUser) => void;
  onEditUser: (user: EnhancedUser) => void;
  onRequestRoleChange: (user: EnhancedUser, role: UserRole) => void;
  onRequestStatusChange: (user: EnhancedUser, status: AccountStatus) => void;
  onSelectUser: (userId: string) => void;
  onViewUser: (user: EnhancedUser) => void;
  t: UserTableTranslations;
  user: EnhancedUser;
}

export function UserTableRow({
  currentUserId,
  currentUserRole,
  formatDate,
  isSelected,
  onDeleteUser,
  onEditUser,
  onRequestRoleChange,
  onRequestStatusChange,
  onSelectUser,
  onViewUser,
  t,
  user,
}: UserTableRowProps) {
  const roleInfo = getRoleInfo(t, user.role);
  const statusInfo = getStatusInfo(t, user.status);
  const moreGroupsTooltip = getMoreGroupsTooltip(t, user);

  return (
    <tr
      className={cn(
        'h-20 border-b transition-all duration-200',
        'border-stone-200/50 dark:border-stone-700/50',
        isSelected
          ? 'bg-stone-100/70 dark:bg-stone-700/30'
          : 'hover:bg-stone-50/70 dark:hover:bg-stone-800/50',
        'hover:shadow-sm'
      )}
    >
      <td className="px-4 py-4">
        <button
          onClick={() => onSelectUser(user.id)}
          className={cn(
            'flex items-center justify-center rounded-md p-1 transition-colors',
            'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
          )}
        >
          {isSelected ? (
            <CheckSquare className="h-4 w-4" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
      </td>

      <td className="px-4 py-4">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <UserAvatar
              avatarUrl={user.avatar_url}
              userName={
                user.full_name || user.username || t('actions.defaultUser')
              }
              size="md"
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center space-x-1">
              <span
                className={cn(
                  'truncate font-serif text-sm font-medium',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {user.full_name || user.username || t('actions.notSet')}
              </span>
              {user.role === 'admin' && (
                <span className="text-xs text-red-500">👑</span>
              )}
            </div>
            <span
              className={cn('truncate font-serif text-xs', 'text-stone-500')}
            >
              @{user.username || t('actions.notSet')}
            </span>
          </div>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="min-w-0 space-y-1">
          <p
            className={cn(
              'flex items-center gap-1 truncate font-serif text-sm',
              'text-stone-700 dark:text-stone-300'
            )}
            title={user.email || t('actions.notSetEmail')}
          >
            <span className="text-xs">{t('actions.emailIcon')}</span>
            <span className="truncate">
              {user.email || t('actions.notSet')}
            </span>
          </p>
          <p
            className={cn(
              'flex items-center gap-1 truncate font-serif text-sm',
              'text-stone-600 dark:text-stone-400'
            )}
            title={user.phone || t('actions.notSetPhone')}
          >
            <span className="text-xs">{t('actions.phoneIcon')}</span>
            <span className="truncate">
              {formatUserPhone(user.phone) || t('actions.notSet')}
            </span>
          </p>
        </div>
      </td>

      <td className="px-4 py-4">
        <div className="flex h-16 flex-col justify-center space-y-1">
          {user.groups && user.groups.length > 0 ? (
            <>
              {user.groups.slice(0, 2).map(group => (
                <p
                  key={group.id}
                  className={cn(
                    'truncate font-serif text-sm',
                    'text-stone-700 dark:text-stone-300'
                  )}
                  title={group.description || group.name}
                >
                  {group.name}
                </p>
              ))}
              {user.groups.length > 2 && (
                <p
                  className={cn(
                    'truncate font-serif text-xs',
                    'text-stone-500 dark:text-stone-400'
                  )}
                  title={moreGroupsTooltip || undefined}
                >
                  {t('actions.moreGroups', { count: user.groups.length - 2 })}
                </p>
              )}
            </>
          ) : (
            <p className={cn('font-serif text-sm', 'text-stone-500')}>
              {t('actions.notInGroup')}
            </p>
          )}
        </div>
      </td>

      <td className="min-w-0 px-4 py-4">
        <div
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 font-serif text-xs font-medium',
            getBadgeClasses(roleInfo.variant)
          )}
          title={roleInfo.label}
        >
          {roleInfo.icon}
          <span className="truncate">{roleInfo.label}</span>
        </div>
      </td>

      <td className="min-w-0 px-4 py-4">
        <div
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 font-serif text-xs font-medium',
            getBadgeClasses(statusInfo.variant)
          )}
          title={statusInfo.label}
        >
          {statusInfo.icon}
          <span className="truncate">{statusInfo.label}</span>
        </div>
      </td>

      <td className="px-4 py-4">
        <p
          className={cn(
            'truncate font-serif text-sm',
            'text-stone-700 dark:text-stone-300'
          )}
          title={formatDate(user.last_sign_in_at, DateFormatPresets.dateTime)}
        >
          {formatDate(user.last_sign_in_at, DateFormatPresets.dateTime)}
        </p>
      </td>

      <td className="px-4 py-4">
        <p
          className={cn(
            'truncate font-serif text-sm',
            'text-stone-700 dark:text-stone-300'
          )}
          title={formatDate(user.created_at, DateFormatPresets.dateTime)}
        >
          {formatDate(user.created_at, DateFormatPresets.dateTime)}
        </p>
      </td>

      <td className="px-4 py-4">
        <UserRowActions
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onDeleteUser={onDeleteUser}
          onEditUser={onEditUser}
          onRequestRoleChange={onRequestRoleChange}
          onRequestStatusChange={onRequestStatusChange}
          onViewUser={onViewUser}
          t={t}
          user={user}
        />
      </td>
    </tr>
  );
}
