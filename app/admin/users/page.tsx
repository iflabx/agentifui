'use client';

import { UserFiltersComponent } from '@components/admin/users/user-filters';
import { UserStatsCards } from '@components/admin/users/user-stats-cards';
import { UserTable } from '@components/admin/users/user-table';
import { ConfirmDialog } from '@components/ui';
import { useProfile } from '@lib/hooks/use-profile';
import { useUserManagementStore } from '@lib/stores/user-management-store';
import { cn } from '@lib/utils';
import {
  CheckSquare,
  Crown,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  UserIcon,
  UserX,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import React, { useEffect } from 'react';

import { useTranslations } from 'next-intl';

interface User {
  id: string;
  role: 'admin' | 'manager' | 'user';
  full_name?: string | null;
  email?: string | null;
}

export default function UsersManagementPage() {
  const { profile: currentUserProfile } = useProfile();
  const t = useTranslations('pages.admin.users');

  // Dialog state for delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [userToDelete, setUserToDelete] = React.useState<User | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [showBatchDialog, setShowBatchDialog] = React.useState(false);
  const [batchAction, setBatchAction] = React.useState<{
    type: 'role' | 'status';
    value: string;
  } | null>(null);
  const [isBatchUpdating, setIsBatchUpdating] = React.useState(false);

  // get status and operations from user management store
  const {
    users,
    stats,
    filters,
    pagination,
    loading,
    error,
    selectedUserIds,
    loadUsers,
    loadStats,
    loadFilterOptions,

    updateFilters,
    setPage,
    toggleUserSelection,
    selectUsers,
    clearSelection,
    changeUserRole,
    changeUserStatus,
    removeUser,
    batchChangeRole,
    batchChangeStatus,
    clearError,
  } = useUserManagementStore();

  // check if can change user role (prevent admin from downgrading other admins)
  const canChangeUserRole = (
    targetUser: User,
    newRole: 'admin' | 'manager' | 'user'
  ) => {
    // if current user is not admin, do not allow any role change
    if (currentUserProfile?.role !== 'admin') {
      return false;
    }

    // prevent admin from modifying their own role
    if (targetUser.id === currentUserProfile?.id) {
      toast.error(t('messages.cannotChangeOwnRole'));
      return false;
    }

    // prevent non-super admin from downgrading other admins
    if (targetUser.role === 'admin' && newRole !== 'admin') {
      toast.error(t('messages.cannotDowngradeOtherAdmin'));
      return false;
    }

    return true;
  };

  // check if can delete user (prevent deleting admin account)
  const canDeleteUser = (targetUser: User) => {
    // if current user is not admin, do not allow delete
    if (currentUserProfile?.role !== 'admin') {
      return false;
    }

    // prevent deleting self
    if (targetUser.id === currentUserProfile?.id) {
      toast.error(t('messages.cannotDeleteSelf'));
      return false;
    }

    // prevent deleting other admins
    if (targetUser.role === 'admin') {
      toast.error(t('messages.cannotDeleteOtherAdmin'));
      return false;
    }

    return true;
  };

  // check if batch operation contains protected users
  const canBatchChangeRole = (newRole: 'admin' | 'manager' | 'user') => {
    if (currentUserProfile?.role !== 'admin') {
      return false;
    }

    const selectedUsers = users.filter(user =>
      selectedUserIds.includes(user.id)
    );

    // check if contains current user
    const includesSelf = selectedUsers.some(
      user => user.id === currentUserProfile?.id
    );
    if (includesSelf) {
      toast.error(t('messages.cannotIncludeSelf'));
      return false;
    }

    // check if trying to downgrade other admins
    const hasAdminBeingDowngraded = selectedUsers.some(
      user => user.role === 'admin' && newRole !== 'admin'
    );
    if (hasAdminBeingDowngraded) {
      toast.error(t('messages.cannotDowngradeAdmin'));
      return false;
    }

    return true;
  };

  // load data when page initializes
  useEffect(() => {
    loadUsers();
    loadStats();
    loadFilterOptions();
  }, [loadUsers, loadStats, loadFilterOptions]);

  // handle error prompt
  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  // handle filter reset
  const handleResetFilters = () => {
    updateFilters({
      role: undefined,
      status: undefined,
      auth_source: undefined,
      search: undefined,
    });
  };

  // handle user selection
  const handleSelectUser = (userId: string) => {
    toggleUserSelection(userId);
  };

  // handle select all/cancel all
  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      selectUsers(users.map(user => user.id));
    } else {
      clearSelection();
    }
  };

  // handle user role change (with safety check)
  const handleChangeRole = async (
    user: User,
    role: 'admin' | 'manager' | 'user'
  ) => {
    if (!canChangeUserRole(user, role)) {
      return;
    }

    const success = await changeUserRole(user.id, role);
    if (success) {
      const roleText = t(`messages.roles.${role}`);
      toast.success(
        t('messages.roleChangeSuccess', {
          name: user.full_name || user.email || 'Unknown User',
          role: roleText,
        })
      );
    }
  };

  // handle user status change
  const handleChangeStatus = async (
    user: User,
    status: 'active' | 'suspended' | 'pending'
  ) => {
    const success = await changeUserStatus(user.id, status);
    if (success) {
      const statusText = t(`messages.statuses.${status}`);
      toast.success(
        t('messages.statusChangeSuccess', {
          name: user.full_name || user.email || 'Unknown User',
          status: statusText,
        })
      );
    }
  };

  // handle user delete (with safety check)
  const handleDeleteUser = (user: User) => {
    if (!canDeleteUser(user)) {
      return;
    }

    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  // confirm delete user
  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;

    setIsDeleting(true);
    const success = await removeUser(userToDelete.id);
    if (success) {
      toast.success(
        t('messages.deleteSuccess', {
          name: userToDelete.full_name || userToDelete.email || 'Unknown User',
        })
      );
      setShowDeleteDialog(false);
      setUserToDelete(null);
    }
    setIsDeleting(false);
  };

  const handleBatchChangeRole = (role: 'admin' | 'manager' | 'user') => {
    if (!canBatchChangeRole(role)) {
      return;
    }
    setBatchAction({ type: 'role', value: role });
    setShowBatchDialog(true);
  };

  const handleBatchChangeStatus = (
    status: 'active' | 'suspended' | 'pending'
  ) => {
    setBatchAction({ type: 'status', value: status });
    setShowBatchDialog(true);
  };

  const handleConfirmBatchAction = async () => {
    if (!batchAction) return;

    setIsBatchUpdating(true);
    try {
      if (batchAction.type === 'role') {
        const success = await batchChangeRole(
          batchAction.value as 'admin' | 'manager' | 'user'
        );
        if (success) {
          toast.success(
            t('messages.batchRoleChangeSuccess', {
              count: selectedUserIds.length,
            })
          );
        }
      } else {
        const success = await batchChangeStatus(
          batchAction.value as 'active' | 'suspended' | 'pending'
        );
        if (success) {
          toast.success(
            t('messages.batchStatusChangeSuccess', {
              count: selectedUserIds.length,
            })
          );
        }
      }
      setShowBatchDialog(false);
      setBatchAction(null);
    } finally {
      setIsBatchUpdating(false);
    }
  };

  // handle view user (use toast temporarily)
  const handleViewUser = (user: User) => {
    toast.success(
      t('actions.viewUser', {
        name: user.full_name || user.email || 'Unknown User',
      })
    );
  };

  // handle edit user (use toast temporarily)
  const handleEditUser = (user: User) => {
    toast.success(
      t('actions.editUser', {
        name: user.full_name || user.email || 'Unknown User',
      })
    );
  };

  // pagination control
  const PaginationControls = () => {
    if (pagination.totalPages <= 1) return null;

    return (
      <div className="mt-6 flex items-center justify-between">
        <div
          className={cn(
            'font-serif text-sm',
            'text-stone-600 dark:text-stone-400'
          )}
        >
          {t('pagination.showing', {
            start: (pagination.page - 1) * pagination.pageSize + 1,
            end: Math.min(
              pagination.page * pagination.pageSize,
              pagination.total
            ),
            total: pagination.total,
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className={cn(
              'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
              pagination.page <= 1
                ? 'cursor-not-allowed opacity-50'
                : 'border-stone-300 text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
            )}
          >
            {t('pagination.previous')}
          </button>

          <span
            className={cn(
              'px-3 py-1.5 font-serif text-sm',
              'text-stone-700 dark:text-stone-300'
            )}
          >
            {pagination.page} / {pagination.totalPages}
          </span>

          <button
            onClick={() => setPage(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className={cn(
              'rounded-lg border px-3 py-1.5 font-serif text-sm transition-colors',
              pagination.page >= pagination.totalPages
                ? 'cursor-not-allowed opacity-50'
                : 'border-stone-300 text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
            )}
          >
            {t('pagination.next')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        'min-h-screen bg-gradient-to-br from-stone-50 via-white to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-800'
      )}
    >
      <div className="mx-auto max-w-7xl p-6">
        {/* Page title and action bar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1
              className={cn(
                'mb-3 bg-gradient-to-r from-stone-800 to-stone-600 bg-clip-text font-serif text-4xl leading-relaxed font-bold text-transparent dark:from-stone-100 dark:to-stone-300'
              )}
            >
              {t('title')}
            </h1>
            <p
              className={cn(
                'flex items-center gap-2 font-serif text-base',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              <Users className="h-4 w-4" />
              {t('subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh button */}
            <button
              onClick={() => {
                loadUsers();
                loadStats();
              }}
              disabled={loading.users || loading.stats}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-4 py-2.5 font-serif shadow-sm transition-all duration-200',
                loading.users || loading.stats
                  ? 'cursor-not-allowed opacity-50'
                  : 'border-stone-300/50 text-stone-700 backdrop-blur-sm hover:border-stone-400 hover:bg-stone-50/80 hover:shadow-md dark:border-stone-600/50 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:bg-stone-700/50 dark:hover:shadow-md'
              )}
            >
              <RefreshCw
                className={cn(
                  'h-4 w-4',
                  (loading.users || loading.stats) && 'animate-spin'
                )}
              />
              <span className="hidden sm:inline">
                {t('actions.refreshData')}
              </span>
            </button>

            {/* Add user button */}
            <button
              onClick={() => toast.success(t('actions.addUserInDevelopment'))}
              className={cn(
                'flex items-center gap-2 rounded-xl bg-gradient-to-r from-stone-700 to-stone-800 px-4 py-2.5 font-serif text-white shadow-sm transition-all duration-200 hover:from-stone-600 hover:to-stone-700 hover:shadow-md dark:from-stone-600 dark:to-stone-700 dark:hover:from-stone-500 dark:hover:to-stone-600'
              )}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('actions.addUser')}</span>
            </button>
          </div>
        </div>

        {/* Statistics cards */}
        <UserStatsCards stats={stats} isLoading={loading.stats} />

        {/* Filter component */}
        <UserFiltersComponent
          filters={filters}
          onFiltersChange={updateFilters}
          onReset={handleResetFilters}
        />

        {/* Batch operation bar */}
        {selectedUserIds.length > 0 && (
          <div
            className={cn(
              'mb-6 rounded-xl border border-stone-200/50 bg-white/80 p-5 shadow-lg shadow-stone-200/50 backdrop-blur-sm dark:border-stone-700/50 dark:bg-stone-800/60 dark:shadow-stone-900/20'
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
                  )}
                >
                  <CheckSquare className="h-4 w-4" />
                </div>
                <div>
                  <span
                    className={cn(
                      'font-serif text-sm font-semibold',
                      'text-stone-800 dark:text-stone-200'
                    )}
                  >
                    {t('batchOperations.selected', {
                      count: selectedUserIds.length,
                    })}
                  </span>
                  <button
                    onClick={clearSelection}
                    className={cn(
                      'ml-3 rounded-lg px-2 py-1 font-serif text-xs text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
                    )}
                  >
                    {t('batchOperations.cancelSelection')}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Batch role operations */}
                <button
                  onClick={() => handleBatchChangeRole('admin')}
                  disabled={loading.batchOperating}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-purple-700'
                  )}
                >
                  <Shield className="h-3 w-3" />
                  {t('batchOperations.setAsAdmin')}
                </button>

                <button
                  onClick={() => handleBatchChangeRole('manager')}
                  disabled={loading.batchOperating}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-amber-700'
                  )}
                >
                  <Crown className="h-3 w-3" />
                  {t('batchOperations.setAsManager')}
                </button>

                <button
                  onClick={() => handleBatchChangeRole('user')}
                  disabled={loading.batchOperating}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-stone-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-stone-700'
                  )}
                >
                  <UserIcon className="h-3 w-3" />
                  {t('batchOperations.setAsUser')}
                </button>

                {/* Batch status operations */}
                <button
                  onClick={() => handleBatchChangeStatus('active')}
                  disabled={loading.batchOperating}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-green-700'
                  )}
                >
                  <UserCheck className="h-3 w-3" />
                  {t('batchOperations.activate')}
                </button>

                <button
                  onClick={() => handleBatchChangeStatus('suspended')}
                  disabled={loading.batchOperating}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 font-serif text-sm text-white transition-colors hover:bg-red-700'
                  )}
                >
                  <UserX className="h-3 w-3" />
                  {t('batchOperations.suspend')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User table */}
        <UserTable
          users={users}
          selectedUserIds={selectedUserIds}
          isLoading={loading.users}
          onSelectUser={handleSelectUser}
          onSelectAll={handleSelectAll}
          onEditUser={handleEditUser}
          onViewUser={handleViewUser}
          onDeleteUser={handleDeleteUser}
          onChangeRole={handleChangeRole}
          onChangeStatus={handleChangeStatus}
        />

        {/* Pagination controls */}
        <PaginationControls />

        {/* Delete confirmation dialog */}
        <ConfirmDialog
          isOpen={showDeleteDialog}
          onClose={() => !isDeleting && setShowDeleteDialog(false)}
          onConfirm={handleConfirmDeleteUser}
          title={t('actions.deleteUser')}
          message={t('messages.deleteConfirm', {
            name:
              userToDelete?.full_name || userToDelete?.email || 'Unknown User',
          })}
          confirmText={t('actions.deleteUser')}
          variant="danger"
          icon="delete"
          isLoading={isDeleting}
        />

        <ConfirmDialog
          isOpen={showBatchDialog}
          onClose={() => !isBatchUpdating && setShowBatchDialog(false)}
          onConfirm={handleConfirmBatchAction}
          title={
            batchAction?.type === 'role'
              ? t('actions.changeRole')
              : t('actions.changeStatus')
          }
          message={
            batchAction?.type === 'role'
              ? t('messages.batchRoleChangeConfirm', {
                  count: selectedUserIds.length,
                  role: batchAction?.value
                    ? t(`messages.roles.${batchAction.value}`)
                    : batchAction?.value || '',
                })
              : t('messages.batchStatusChangeConfirm', {
                  count: selectedUserIds.length,
                  status: batchAction?.value
                    ? t(`messages.statuses.${batchAction.value}`)
                    : batchAction?.value || '',
                })
          }
          confirmText={t('actions.confirm')}
          variant="default"
          icon="edit"
          isLoading={isBatchUpdating}
        />
      </div>
    </div>
  );
}
