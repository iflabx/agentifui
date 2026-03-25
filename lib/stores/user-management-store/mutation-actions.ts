import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { AccountStatus, UserRole } from '@lib/types/database';

import {
  applyBatchRole,
  applyBatchStatus,
  getErrorMessage,
  mergeSelectedUser,
  mergeUpdatedUser,
  updateLoadingState,
} from './helpers';
import type {
  EnhancedUser,
  UserManagementStoreGet,
  UserManagementStoreSet,
} from './types';

export function createMutationActions(
  set: UserManagementStoreSet,
  get: UserManagementStoreGet
) {
  return {
    updateUser: async (userId: string, updates: Partial<EnhancedUser>) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'updating', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<EnhancedUser>(
          'users.updateUserProfile',
          {
            userId,
            updates,
          }
        );

        if (result.success) {
          const updatedUser = result.data;
          set(state => ({
            users: mergeUpdatedUser(state.users, userId, updatedUser),
            selectedUser: mergeSelectedUser(
              state.selectedUser,
              userId,
              updatedUser
            ),
            loading: updateLoadingState(state.loading, 'updating', false),
          }));
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to update user',
          loading: updateLoadingState(state.loading, 'updating', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to update user'),
          loading: updateLoadingState(state.loading, 'updating', false),
        }));
        return false;
      }
    },

    changeUserRole: async (userId: string, role: UserRole) => {
      const result = await get().updateUser(userId, { role });
      if (result) {
        void get().loadStats();
      }
      return result;
    },

    changeUserStatus: async (userId: string, status: AccountStatus) => {
      const result = await get().updateUser(userId, { status });
      if (result) {
        void get().loadStats();
      }
      return result;
    },

    removeUser: async (userId: string) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'deleting', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>('users.deleteUser', {
          userId,
        });

        if (result.success) {
          set(state => ({
            users: state.users.filter(user => user.id !== userId),
            selectedUserIds: state.selectedUserIds.filter(id => id !== userId),
            selectedUser:
              state.selectedUser?.id === userId ? null : state.selectedUser,
            loading: updateLoadingState(state.loading, 'deleting', false),
          }));
          void get().loadStats();
          return true;
        }

        set(state => ({
          error: result.error?.message || 'Failed to delete user',
          loading: updateLoadingState(state.loading, 'deleting', false),
        }));
        return false;
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to delete user'),
          loading: updateLoadingState(state.loading, 'deleting', false),
        }));
        return false;
      }
    },

    batchChangeStatus: async (status: AccountStatus) => {
      const state = get();
      const userIds = state.selectedUserIds;

      if (userIds.length === 0) {
        return false;
      }

      set(currentState => ({
        loading: updateLoadingState(
          currentState.loading,
          'batchOperating',
          true
        ),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>(
          'users.batchUpdateUserStatus',
          {
            userIds,
            status,
          }
        );

        if (result.success) {
          set(currentState => ({
            users: applyBatchStatus(currentState.users, userIds, status),
            selectedUserIds: [],
            loading: updateLoadingState(
              currentState.loading,
              'batchOperating',
              false
            ),
          }));
          void get().loadStats();
          return true;
        }

        set(currentState => ({
          error: result.error?.message || 'Failed to batch update status',
          loading: updateLoadingState(
            currentState.loading,
            'batchOperating',
            false
          ),
        }));
        return false;
      } catch (error) {
        set(currentState => ({
          error: getErrorMessage(error, 'Failed to batch update status'),
          loading: updateLoadingState(
            currentState.loading,
            'batchOperating',
            false
          ),
        }));
        return false;
      }
    },

    batchChangeRole: async (role: UserRole) => {
      const state = get();
      const userIds = state.selectedUserIds;

      if (userIds.length === 0) {
        return false;
      }

      set(currentState => ({
        loading: updateLoadingState(
          currentState.loading,
          'batchOperating',
          true
        ),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>(
          'users.batchUpdateUserRole',
          {
            userIds,
            role,
          }
        );

        if (result.success) {
          set(currentState => ({
            users: applyBatchRole(currentState.users, userIds, role),
            selectedUserIds: [],
            loading: updateLoadingState(
              currentState.loading,
              'batchOperating',
              false
            ),
          }));
          void get().loadStats();
          return true;
        }

        set(currentState => ({
          error: result.error?.message || 'Failed to batch update role',
          loading: updateLoadingState(
            currentState.loading,
            'batchOperating',
            false
          ),
        }));
        return false;
      } catch (error) {
        set(currentState => ({
          error: getErrorMessage(error, 'Failed to batch update role'),
          loading: updateLoadingState(
            currentState.loading,
            'batchOperating',
            false
          ),
        }));
        return false;
      }
    },
  };
}
