import { Dropdown } from '@components/ui/dropdown';
import type { EnhancedUser } from '@lib/db/users';
import type { AccountStatus, UserRole } from '@lib/types/database';
import { cn } from '@lib/utils';
import { Edit2, Eye, MoreHorizontal, Trash2 } from 'lucide-react';

import {
  type UserTableTranslations,
  canChangeUserRole,
  canDeleteUser,
  canEditUser,
  getRoleInfo,
  getStatusInfo,
} from './helpers';

interface UserRowActionsProps {
  currentUserId?: string | null;
  currentUserRole?: UserRole | null;
  onDeleteUser: (user: EnhancedUser) => void;
  onEditUser: (user: EnhancedUser) => void;
  onRequestRoleChange: (user: EnhancedUser, role: UserRole) => void;
  onRequestStatusChange: (user: EnhancedUser, status: AccountStatus) => void;
  onViewUser: (user: EnhancedUser) => void;
  t: UserTableTranslations;
  user: EnhancedUser;
}

export function UserRowActions({
  currentUserId,
  currentUserRole,
  onDeleteUser,
  onEditUser,
  onRequestRoleChange,
  onRequestStatusChange,
  onViewUser,
  t,
  user,
}: UserRowActionsProps) {
  const currentUser = {
    id: currentUserId,
    role: currentUserRole,
  };
  const canEdit = canEditUser(currentUser, user);
  const canDelete = canDeleteUser(currentUser, user);

  return (
    <Dropdown
      trigger={
        <button
          className={cn(
            'rounded-lg p-2 transition-colors',
            'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      }
    >
      <div className="py-1">
        <button
          onClick={() => onViewUser(user)}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 font-serif text-sm transition-colors',
            'text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
          )}
        >
          <Eye className="h-4 w-4" />
          {t('actions.viewDetails')}
        </button>

        <button
          onClick={() => onEditUser(user)}
          disabled={!canEdit}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 font-serif text-sm transition-colors',
            !canEdit
              ? 'cursor-not-allowed text-stone-400 dark:cursor-not-allowed dark:text-stone-600'
              : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
          )}
        >
          <Edit2 className="h-4 w-4" />
          {t('actions.editInfo')}
        </button>

        <div className={cn('my-1 h-px', 'bg-stone-200 dark:bg-stone-700')} />

        <div
          className={cn(
            'px-4 py-2 font-serif text-xs font-semibold tracking-wider uppercase',
            'text-stone-500'
          )}
        >
          {t('actions.changeRole')}
        </div>

        {(['admin', 'manager', 'user'] as const).map(role => {
          const roleInfo = getRoleInfo(t, role);
          const canChange = canChangeUserRole(currentUser, user, role);
          const isCurrent = user.role === role;

          return (
            <button
              key={role}
              onClick={() => onRequestRoleChange(user, role)}
              disabled={!canChange || isCurrent}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2 font-serif text-sm transition-colors',
                !canChange || isCurrent
                  ? 'cursor-not-allowed text-stone-400 dark:cursor-not-allowed dark:text-stone-600'
                  : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
              )}
            >
              {roleInfo.icon}
              {roleInfo.label}
              {isCurrent && (
                <span className="ml-auto text-xs">{t('actions.current')}</span>
              )}
              {!canChange && !isCurrent && user.id === currentUserId && (
                <span className="ml-auto text-xs">{t('actions.self')}</span>
              )}
              {!canChange &&
                !isCurrent &&
                user.role === 'admin' &&
                user.id !== currentUserId && (
                  <span className="ml-auto text-xs">{t('actions.admin')}</span>
                )}
            </button>
          );
        })}

        <div className={cn('my-1 h-px', 'bg-stone-200 dark:bg-stone-700')} />

        <div
          className={cn(
            'px-4 py-2 font-serif text-xs font-semibold tracking-wider uppercase',
            'text-stone-500'
          )}
        >
          {t('actions.changeStatus')}
        </div>

        {(['active', 'suspended', 'pending'] as const).map(status => {
          const statusInfo = getStatusInfo(t, status);
          const isCurrent = user.status === status;

          return (
            <button
              key={status}
              onClick={() => onRequestStatusChange(user, status)}
              disabled={isCurrent}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2 font-serif text-sm transition-colors',
                isCurrent
                  ? 'cursor-not-allowed text-stone-400 dark:cursor-not-allowed dark:text-stone-600'
                  : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
              )}
            >
              {statusInfo.icon}
              {statusInfo.label}
              {isCurrent && (
                <span className="ml-auto text-xs">{t('actions.current')}</span>
              )}
            </button>
          );
        })}

        <div className={cn('my-1 h-px', 'bg-stone-200 dark:bg-stone-700')} />

        <button
          onClick={() => onDeleteUser(user)}
          disabled={!canDelete}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 font-serif text-sm transition-colors',
            !canDelete
              ? 'cursor-not-allowed text-stone-400 dark:cursor-not-allowed dark:text-stone-600'
              : 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300'
          )}
        >
          <Trash2 className="h-4 w-4" />
          {t('actions.deleteUser')}
          {!canDelete && user.id === currentUserId && (
            <span className="ml-auto text-xs">{t('actions.self')}</span>
          )}
          {!canDelete && user.role === 'admin' && user.id !== currentUserId && (
            <span className="ml-auto text-xs">{t('actions.admin')}</span>
          )}
        </button>
      </div>
    </Dropdown>
  );
}
