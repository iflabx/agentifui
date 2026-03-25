'use client';

import { UserEditModal } from '@components/admin/users/user-edit-modal';
import { UserFiltersComponent } from '@components/admin/users/user-filters';
import { UserStatsCards } from '@components/admin/users/user-stats-cards';
import { UserTable } from '@components/admin/users/user-table';
import { ConfirmDialog } from '@components/ui';
import type { EnhancedUser } from '@lib/db/users';
import { useProfile } from '@lib/hooks/use-profile';
import { useUserManagementStore } from '@lib/stores/user-management-store';
import { cn } from '@lib/utils';
import { toast } from 'sonner';

import React, { useEffect } from 'react';

import { useTranslations } from 'next-intl';

import { BatchActionsBar } from '@/admin/users/batch-actions-bar';
import { UsersPageHeader } from '@/admin/users/page-header';
import {
  createBatchActionValue,
  evaluateBatchRoleChangePermission,
  evaluateDeletePermission,
  evaluateRoleChangePermission,
  getUserDisplayName,
} from '@/admin/users/page-helpers';
import { PaginationControls } from '@/admin/users/pagination-controls';

export default function UsersManagementPage() {
  const { profile: currentUserProfile } = useProfile();
  const t = useTranslations('pages.admin.users');

  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [userToDelete, setUserToDelete] = React.useState<EnhancedUser | null>(
    null
  );
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [showBatchDialog, setShowBatchDialog] = React.useState(false);
  const [batchAction, setBatchAction] = React.useState<{
    type: 'role' | 'status';
    value: string;
  } | null>(null);
  const [isBatchUpdating, setIsBatchUpdating] = React.useState(false);
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [editingUserId, setEditingUserId] = React.useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = React.useState(false);

  const {
    users,
    stats,
    filters,
    pagination,
    loading,
    error,
    selectedUserIds,
    selectedUser,
    loadUsers,
    loadStats,
    loadFilterOptions,
    loadUserDetail,
    updateFilters,
    setPage,
    toggleUserSelection,
    selectUsers,
    clearSelection,
    changeUserRole,
    changeUserStatus,
    updateUser,
    removeUser,
    batchChangeRole,
    batchChangeStatus,
    clearError,
  } = useUserManagementStore();

  const currentUserId = currentUserProfile?.id;
  const currentUserRole = currentUserProfile?.role;
  const editingUser =
    (editingUserId && selectedUser?.id === editingUserId
      ? selectedUser
      : null) ||
    users.find(user => user.id === editingUserId) ||
    null;
  const isRefreshing = loading.users || loading.stats;

  const getDisplayName = (user?: Partial<EnhancedUser> | null) =>
    getUserDisplayName(user, t('actions.defaultUser'));

  useEffect(() => {
    loadUsers();
    loadStats();
    loadFilterOptions();
  }, [loadUsers, loadStats, loadFilterOptions]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleRefresh = () => {
    loadUsers();
    loadStats();
  };

  const handleAddUser = () => {
    toast.success(t('actions.addUserInDevelopment'));
  };

  const handleResetFilters = () => {
    updateFilters({
      role: undefined,
      status: undefined,
      auth_source: undefined,
      search: undefined,
    });
  };

  const handleSelectUser = (userId: string) => {
    toggleUserSelection(userId);
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      selectUsers(users.map(user => user.id));
      return;
    }

    clearSelection();
  };

  const handleChangeRole = async (
    user: EnhancedUser,
    role: 'admin' | 'manager' | 'user'
  ) => {
    const permission = evaluateRoleChangePermission({
      currentUserId,
      currentUserRole,
      targetUser: user,
      newRole: role,
    });
    if (!permission.allowed) {
      if (permission.reasonKey) {
        toast.error(t(permission.reasonKey));
      }
      return;
    }

    const success = await changeUserRole(user.id, role);
    if (success) {
      toast.success(
        t('messages.roleChangeSuccess', {
          name: getDisplayName(user),
          role: t(`messages.roles.${role}`),
        })
      );
    }
  };

  const handleChangeStatus = async (
    user: EnhancedUser,
    status: 'active' | 'suspended' | 'pending'
  ) => {
    const success = await changeUserStatus(user.id, status);
    if (success) {
      toast.success(
        t('messages.statusChangeSuccess', {
          name: getDisplayName(user),
          status: t(`messages.statuses.${status}`),
        })
      );
    }
  };

  const handleDeleteUser = (user: EnhancedUser) => {
    const permission = evaluateDeletePermission({
      currentUserId,
      currentUserRole,
      targetUser: user,
    });
    if (!permission.allowed) {
      if (permission.reasonKey) {
        toast.error(t(permission.reasonKey));
      }
      return;
    }

    setUserToDelete(user);
    setShowDeleteDialog(true);
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) {
      return;
    }

    setIsDeleting(true);
    const success = await removeUser(userToDelete.id);
    if (success) {
      toast.success(
        t('messages.deleteSuccess', {
          name: getDisplayName(userToDelete),
        })
      );
      setShowDeleteDialog(false);
      setUserToDelete(null);
    }
    setIsDeleting(false);
  };

  const handleBatchChangeRole = (role: 'admin' | 'manager' | 'user') => {
    const permission = evaluateBatchRoleChangePermission({
      currentUserId,
      currentUserRole,
      newRole: role,
      selectedUsers: users.filter(user => selectedUserIds.includes(user.id)),
    });
    if (!permission.allowed) {
      if (permission.reasonKey) {
        toast.error(t(permission.reasonKey));
      }
      return;
    }

    setBatchAction(createBatchActionValue('role', role));
    setShowBatchDialog(true);
  };

  const handleBatchChangeStatus = (
    status: 'active' | 'suspended' | 'pending'
  ) => {
    setBatchAction(createBatchActionValue('status', status));
    setShowBatchDialog(true);
  };

  const handleConfirmBatchAction = async () => {
    if (!batchAction) {
      return;
    }

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

  const handleViewUser = async (user: EnhancedUser) => {
    await loadUserDetail(user.id);
    toast.success(
      t('actions.viewUser', {
        name: getDisplayName(user),
      })
    );
  };

  const handleEditUser = async (user: EnhancedUser) => {
    setEditingUserId(user.id);
    setShowEditModal(true);
    await loadUserDetail(user.id);
  };

  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!editingUserId) {
      return false;
    }

    setIsSavingEdit(true);
    try {
      const success = await updateUser(
        editingUserId,
        updates as Partial<EnhancedUser>
      );
      if (!success) {
        toast.error(t('editModal.messages.updateFailed'));
        return false;
      }

      toast.success(t('editModal.messages.updateSuccess'));
      await Promise.all([
        loadUsers(),
        loadStats(),
        loadUserDetail(editingUserId),
      ]);
      return true;
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCloseEditModal = () => {
    if (isSavingEdit) {
      return;
    }
    setShowEditModal(false);
    setEditingUserId(null);
  };

  return (
    <div
      className={cn(
        'min-h-screen bg-gradient-to-br from-stone-50 via-white to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-800'
      )}
    >
      <div className="mx-auto max-w-7xl p-6">
        <UsersPageHeader
          isRefreshing={isRefreshing}
          onAddUser={handleAddUser}
          onRefresh={handleRefresh}
        />

        <UserStatsCards stats={stats} isLoading={loading.stats} />

        <UserFiltersComponent
          filters={filters}
          onFiltersChange={updateFilters}
          onReset={handleResetFilters}
        />

        {selectedUserIds.length > 0 && (
          <BatchActionsBar
            isLoading={loading.batchOperating}
            selectedCount={selectedUserIds.length}
            onClearSelection={clearSelection}
            onChangeRole={handleBatchChangeRole}
            onChangeStatus={handleBatchChangeStatus}
          />
        )}

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

        <PaginationControls pagination={pagination} onPageChange={setPage} />

        <ConfirmDialog
          isOpen={showDeleteDialog}
          onClose={() => !isDeleting && setShowDeleteDialog(false)}
          onConfirm={handleConfirmDeleteUser}
          title={t('actions.deleteUser')}
          message={t('messages.deleteConfirm', {
            name: getDisplayName(userToDelete),
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

        <UserEditModal
          isOpen={showEditModal}
          user={editingUser}
          isLoading={loading.userDetail}
          isSubmitting={isSavingEdit}
          canEditRoleStatus={currentUserRole === 'admin'}
          onClose={handleCloseEditModal}
          onSave={handleSaveEdit}
        />
      </div>
    </div>
  );
}
