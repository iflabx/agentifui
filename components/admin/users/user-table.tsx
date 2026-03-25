'use client';

import { ConfirmDialog } from '@components/ui';
import type { EnhancedUser } from '@lib/db/users';
import { useDateFormatter } from '@lib/hooks/use-date-formatter';
import { useProfile } from '@lib/hooks/use-profile';
import { cn } from '@lib/utils';
import { CheckSquare, Square } from 'lucide-react';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  getRoleInfo,
  getStatusInfo,
  getUserDisplayName,
} from './user-table/helpers';
import {
  UserTableEmptyState,
  UserTableLoadingState,
} from './user-table/states';
import { UserTableRow } from './user-table/user-row';

interface UserTableProps {
  users: EnhancedUser[];
  selectedUserIds: string[];
  isLoading: boolean;
  onSelectUser: (userId: string) => void;
  onSelectAll: (selected: boolean) => void;
  onEditUser: (user: EnhancedUser) => void;
  onViewUser: (user: EnhancedUser) => void;
  onDeleteUser: (user: EnhancedUser) => void;
  onChangeRole: (
    user: EnhancedUser,
    role: 'admin' | 'manager' | 'user'
  ) => void;
  onChangeStatus: (
    user: EnhancedUser,
    status: 'active' | 'suspended' | 'pending'
  ) => void;
}

type PendingAction = {
  user: EnhancedUser;
  type: 'role' | 'status';
  value: EnhancedUser['role'] | EnhancedUser['status'];
};

export function UserTable({
  users,
  selectedUserIds,
  isLoading,
  onSelectUser,
  onSelectAll,
  onEditUser,
  onViewUser,
  onDeleteUser,
  onChangeRole,
  onChangeStatus,
}: UserTableProps) {
  const { profile: currentUserProfile } = useProfile();
  const { formatDate } = useDateFormatter();
  const t = useTranslations('pages.admin.users');

  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const isAllSelected =
    users.length > 0 && selectedUserIds.length === users.length;
  const isPartiallySelected = selectedUserIds.length > 0 && !isAllSelected;

  const handleRoleChange = (
    user: EnhancedUser,
    role: 'admin' | 'manager' | 'user'
  ) => {
    setPendingAction({ user, type: 'role', value: role });
    setShowRoleDialog(true);
  };

  const handleStatusChange = (
    user: EnhancedUser,
    status: 'active' | 'suspended' | 'pending'
  ) => {
    setPendingAction({ user, type: 'status', value: status });
    setShowStatusDialog(true);
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) {
      return;
    }

    setIsUpdating(true);
    try {
      if (pendingAction.type === 'role') {
        await onChangeRole(
          pendingAction.user,
          pendingAction.value as 'admin' | 'manager' | 'user'
        );
        setShowRoleDialog(false);
      } else {
        await onChangeStatus(
          pendingAction.user,
          pendingAction.value as 'active' | 'suspended' | 'pending'
        );
        setShowStatusDialog(false);
      }
      setPendingAction(null);
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return <UserTableLoadingState t={t} />;
  }

  if (users.length === 0) {
    return <UserTableEmptyState t={t} />;
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border shadow-sm',
        'border-stone-200/50 bg-white dark:border-stone-700/50 dark:bg-stone-800/50'
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full table-fixed">
          <thead
            className={cn(
              'border-b',
              'border-stone-200/50 bg-stone-50/80 dark:border-stone-700/50 dark:bg-stone-900/50'
            )}
          >
            <tr>
              <th className="w-12 px-4 py-4">
                <button
                  onClick={() => onSelectAll(!isAllSelected)}
                  className={cn(
                    'flex items-center justify-center rounded-md p-1 transition-colors',
                    'text-stone-600 hover:bg-stone-100/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
                  )}
                >
                  {isAllSelected ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : isPartiallySelected ? (
                    <Square className="h-4 w-4 border-2" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              <th
                className={cn(
                  'w-48 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.userInfo')}
              </th>
              <th
                className={cn(
                  'w-44 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.contact')}
              </th>
              <th
                className={cn(
                  'w-40 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.groups')}
              </th>
              <th
                className={cn(
                  'w-36 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.rolePermissions')}
              </th>
              <th
                className={cn(
                  'w-28 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.status')}
              </th>
              <th
                className={cn(
                  'w-32 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.lastLogin')}
              </th>
              <th
                className={cn(
                  'w-32 px-4 py-4 text-left font-serif text-sm font-semibold',
                  'text-stone-700 dark:text-stone-300'
                )}
              >
                {t('table.headers.registerTime')}
              </th>
              <th className="w-16 px-4 py-4"></th>
            </tr>
          </thead>

          <tbody>
            {users.map(user => (
              <UserTableRow
                key={user.id}
                currentUserId={currentUserProfile?.id}
                currentUserRole={currentUserProfile?.role}
                formatDate={formatDate}
                isSelected={selectedUserIds.includes(user.id)}
                onDeleteUser={onDeleteUser}
                onEditUser={onEditUser}
                onRequestRoleChange={handleRoleChange}
                onRequestStatusChange={handleStatusChange}
                onSelectUser={onSelectUser}
                onViewUser={onViewUser}
                t={t}
                user={user}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={showRoleDialog}
        onClose={() => !isUpdating && setShowRoleDialog(false)}
        onConfirm={handleConfirmAction}
        title={t('actions.changeRole')}
        message={t('messages.roleChangeConfirm', {
          name: getUserDisplayName(t, pendingAction?.user),
          role:
            pendingAction?.value && pendingAction?.type === 'role'
              ? getRoleInfo(t, pendingAction.value as EnhancedUser['role'])
                  .label
              : pendingAction?.value || '',
        })}
        confirmText={t('actions.changeRole')}
        variant="default"
        icon="edit"
        isLoading={isUpdating}
      />

      <ConfirmDialog
        isOpen={showStatusDialog}
        onClose={() => !isUpdating && setShowStatusDialog(false)}
        onConfirm={handleConfirmAction}
        title={t('actions.changeStatus')}
        message={t('messages.statusChangeConfirm', {
          name: getUserDisplayName(t, pendingAction?.user),
          status:
            pendingAction?.value && pendingAction?.type === 'status'
              ? getStatusInfo(t, pendingAction.value as EnhancedUser['status'])
                  .label
              : pendingAction?.value || '',
        })}
        confirmText={t('actions.changeStatus')}
        variant="default"
        icon="edit"
        isLoading={isUpdating}
      />
    </div>
  );
}
