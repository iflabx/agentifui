import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { AccountStatus, UserRole } from '@lib/types/database';

import {
  getErrorMessage,
  mergeSelectedUser,
  updateLoadingState,
} from './helpers';
import type {
  EnhancedUser,
  SessionRevocationResult,
  UserManagementStoreGet,
  UserManagementStoreSet,
} from './types';

export function createMutationActions(
  set: UserManagementStoreSet,
  get: UserManagementStoreGet
) {
  return {
    revokeAllSessions: async (
      userId: string
    ): Promise<SessionRevocationResult> => {
      const result = await callInternalDataAction<SessionRevocationResult>(
        'users.revokeAllSessions',
        { userId, reasonCode: 'ADMIN_REQUEST' }
      );
      if (!result.success)
        throw new Error(result.error?.message || 'Session revocation failed');
      return result.data;
    },
    updateUser: async (userId: string, updates: Partial<EnhancedUser>) => {
      const profileUpdates = { ...updates };
      delete profileUpdates.email;
      set(state => ({
        loading: updateLoadingState(state.loading, 'updating', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<EnhancedUser>(
          'users.updateUserProfile',
          {
            userId,
            updates: profileUpdates,
          }
        );

        if (result.success) {
          const updatedUser = result.data;
          set(state => ({
            selectedUser: mergeSelectedUser(
              state.selectedUser,
              userId,
              updatedUser
            ),
          }));
          await Promise.all([get().loadUsers(), get().loadStats()]);
          set(state => ({
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
      return get().updateUser(userId, { role });
    },

    changeUserStatus: async (userId: string, status: AccountStatus) => {
      return get().updateUser(userId, { status });
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
          if (get().selectedUser?.id === userId) get().hideUserDetailModal();
          await Promise.all([get().loadUsers(), get().loadStats()]);
          set(state => ({
            loading: updateLoadingState(state.loading, 'deleting', false),
          }));
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
      const userIds = state.users
        .filter(user => state.selectedUserIds.includes(user.id))
        .map(user => user.id);

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
          await Promise.all([get().loadUsers(), get().loadStats()]);
          set(currentState => ({
            selectedUserIds: [],
            loading: updateLoadingState(
              currentState.loading,
              'batchOperating',
              false
            ),
          }));
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
      const userIds = state.users
        .filter(user => state.selectedUserIds.includes(user.id))
        .map(user => user.id);

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
          await Promise.all([get().loadUsers(), get().loadStats()]);
          set(currentState => ({
            selectedUserIds: [],
            loading: updateLoadingState(
              currentState.loading,
              'batchOperating',
              false
            ),
          }));
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
