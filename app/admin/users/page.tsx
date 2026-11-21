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
  evaluateStatusChangePermission,
  getUserDisplayName,
} from '@/admin/users/page-helpers';
import { PaginationControls } from '@/admin/users/pagination-controls';

export default function UsersManagementPage() {
  const { profile: currentUserProfile } = useProfile();
  const t = useTranslations('pages.admin.users');
  const governanceT = useTranslations('governance');
  const [revokeTarget, setRevokeTarget] = React.useState<EnhancedUser | null>(
    null
  );
  const [revoking, setRevoking] = React.useState(false);

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
  const [readOnlyDetail, setReadOnlyDetail] = React.useState(false);
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
    showUserDetail,
    loadUsers,
    loadStats,
    loadFilterOptions,
    loadUserDetail,
    hideUserDetailModal,
    updateFilters,
    setPage,
    toggleUserSelection,
    selectUsers,
    clearSelection,
    changeUserRole,
    changeUserStatus,
    updateUser,
    removeUser,
    revokeAllSessions,
    batchChangeRole,
    batchChangeStatus,
    clearError,
  } = useUserManagementStore();

  const currentUserId = currentUserProfile?.id;
  const currentUserRole = currentUserProfile?.role;
  const isRefreshing = loading.users || loading.stats;

  const getDisplayName = (user?: Partial<EnhancedUser> | null) =>
    getUserDisplayName(user, t('actions.defaultUser'));

  useEffect(() => {
    loadUsers();
    loadStats();
    loadFilterOptions();
    return hideUserDetailModal;
  }, [loadUsers, loadStats, loadFilterOptions, hideUserDetailModal]);

  useEffect(() => {
    setShowBatchDialog(false);
    setBatchAction(null);
  }, [selectedUserIds]);

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

  const handleRevokeSessions = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const result = await revokeAllSessions(revokeTarget.id);
      toast.success(governanceT('revoked', { count: result.revokedCount }));
      if (result.cacheCleanup === 'pending')
        toast.warning(governanceT('cleanupPending'));
      setRevokeTarget(null);
      if (revokeTarget.id === currentUserId) window.location.reload();
    } catch {
      toast.error(governanceT('revokeFailed'));
    } finally {
      setRevoking(false);
    }
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
    const permission = evaluateStatusChangePermission({
      currentUserId,
      currentUserRole,
      targetUser: user,
      newStatus: status,
    });
    if (!permission.allowed) {
      if (permission.reasonKey) toast.error(t(permission.reasonKey));
      return;
    }
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
    const permission = users
      .filter(user => selectedUserIds.includes(user.id))
      .map(user =>
        evaluateStatusChangePermission({
          currentUserId,
          currentUserRole,
          targetUser: user,
          newStatus: status,
        })
      )
      .find(result => !result.allowed);
    if (permission) {
      if (permission.reasonKey) toast.error(t(permission.reasonKey));
      return;
    }
    setBatchAction(createBatchActionValue('status', status));
    setShowBatchDialog(true);
  };

  const handleConfirmBatchAction = async () => {
    if (!batchAction || selectedUserIds.length === 0) {
      return;
    }

    setIsBatchUpdating(true);
    try {
      let success: boolean;
      if (batchAction.type === 'role') {
        success = await batchChangeRole(
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
        success = await batchChangeStatus(
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
      if (success) {
        setShowBatchDialog(false);
        setBatchAction(null);
      }
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleViewUser = async (user: EnhancedUser) => {
    setReadOnlyDetail(true);
    await loadUserDetail(user.id);
  };

  const handleEditUser = async (user: EnhancedUser) => {
    setReadOnlyDetail(false);
    await loadUserDetail(user.id);
  };

  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    if (!selectedUser || readOnlyDetail) {
      return false;
    }

    if (updates.role !== undefined) {
      const permission = evaluateRoleChangePermission({
        currentUserId,
        currentUserRole,
        targetUser: selectedUser,
        newRole: updates.role as EnhancedUser['role'],
      });
      if (!permission.allowed) {
        if (permission.reasonKey) toast.error(t(permission.reasonKey));
        return false;
      }
    }
    if (updates.status !== undefined) {
      const permission = evaluateStatusChangePermission({
        currentUserId,
        currentUserRole,
        targetUser: selectedUser,
        newStatus: updates.status as EnhancedUser['status'],
      });
      if (!permission.allowed) {
        if (permission.reasonKey) toast.error(t(permission.reasonKey));
        return false;
      }
    }

    setIsSavingEdit(true);
    try {
      const success = await updateUser(
        selectedUser.id,
        updates as Partial<EnhancedUser>
      );
      if (!success) {
        toast.error(t('editModal.messages.updateFailed'));
        return false;
      }

      toast.success(t('editModal.messages.updateSuccess'));
      return true;
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCloseEditModal = () => {
    if (isSavingEdit) {
      return;
    }
    hideUserDetailModal();
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

        <p className="mb-4 text-sm text-stone-500">
          {t('batchOperations.currentPageOnly')}
        </p>

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
          onRevokeSessions={setRevokeTarget}
          onChangeRole={handleChangeRole}
          onChangeStatus={handleChangeStatus}
        />

        <PaginationControls pagination={pagination} onPageChange={setPage} />

        <ConfirmDialog
          isOpen={Boolean(revokeTarget)}
          onClose={() => !revoking && setRevokeTarget(null)}
          onConfirm={handleRevokeSessions}
          title={governanceT('revokeSessions')}
          message={governanceT('revokeConfirm')}
          confirmText={governanceT('revokeSessions')}
          variant="danger"
          isLoading={revoking}
        />

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
          isOpen={showUserDetail}
          user={selectedUser}
          isLoading={loading.userDetail}
          isSubmitting={isSavingEdit}
          canEditRoleStatus={currentUserRole === 'admin'}
          currentUserId={currentUserId}
          readOnly={readOnlyDetail}
          onClose={handleCloseEditModal}
          onSave={handleSaveEdit}
        />
      </div>
    </div>
  );
}
