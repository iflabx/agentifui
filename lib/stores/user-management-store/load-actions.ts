import { callInternalDataAction } from '@lib/db/internal-data-api';

import {
  buildPaginationState,
  getErrorMessage,
  updateLoadingState,
} from './helpers';
import type {
  EnhancedUser,
  UserListPayload,
  UserManagementStoreGet,
  UserManagementStoreSet,
  UserStats,
} from './types';

export function createLoadActions(
  set: UserManagementStoreSet,
  get: UserManagementStoreGet
) {
  return {
    loadUsers: async () => {
      const state = get();
      set(currentState => ({
        loading: updateLoadingState(currentState.loading, 'users', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<UserListPayload>(
          'users.getUserList',
          { filters: state.filters }
        );

        if (result.success) {
          set(currentState => ({
            users: result.data.users,
            pagination: buildPaginationState(result.data),
            loading: updateLoadingState(currentState.loading, 'users', false),
          }));
          return;
        }

        set(currentState => ({
          error: result.error?.message || 'Failed to load user list',
          loading: updateLoadingState(currentState.loading, 'users', false),
        }));
      } catch (error) {
        set(currentState => ({
          error: getErrorMessage(error, 'Failed to load user list'),
          loading: updateLoadingState(currentState.loading, 'users', false),
        }));
      }
    },

    loadStats: async () => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'stats', true),
        error: null,
      }));

      try {
        const result =
          await callInternalDataAction<UserStats>('users.getUserStats');

        if (result.success) {
          set(state => ({
            stats: result.data,
            loading: updateLoadingState(state.loading, 'stats', false),
          }));
          return;
        }

        set(state => ({
          error: result.error?.message || 'Failed to load statistics',
          loading: updateLoadingState(state.loading, 'stats', false),
        }));
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to load statistics'),
          loading: updateLoadingState(state.loading, 'stats', false),
        }));
      }
    },

    loadUserDetail: async (userId: string) => {
      set(state => ({
        loading: updateLoadingState(state.loading, 'userDetail', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<EnhancedUser | null>(
          'users.getUserById',
          { userId }
        );

        if (result.success && result.data) {
          set(state => ({
            selectedUser: result.data,
            loading: updateLoadingState(state.loading, 'userDetail', false),
          }));
          return;
        }

        set(state => ({
          error: result.error?.message || 'Failed to load user detail',
          loading: updateLoadingState(state.loading, 'userDetail', false),
        }));
      } catch (error) {
        set(state => ({
          error: getErrorMessage(error, 'Failed to load user detail'),
          loading: updateLoadingState(state.loading, 'userDetail', false),
        }));
      }
    },

    loadFilterOptions: async () => {
      console.log('Filter options loading: simplified in group system');
    },

    loadDepartmentsByOrganization: async (_organizationName: string) => {
      console.log('Department options loading: removed in group system');
    },
  };
}
