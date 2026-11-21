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
      const requestId = state.readRequestIds.users + 1;
      set(currentState => ({
        readRequestIds: { ...currentState.readRequestIds, users: requestId },
        users: [],
        selectedUserIds: [],
        loading: updateLoadingState(currentState.loading, 'users', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<UserListPayload>(
          'users.getUserList',
          { filters: state.filters }
        );

        if (get().readRequestIds.users !== requestId) return false;

        if (result.success) {
          const lastPage = Math.max(1, result.data.totalPages);
          if ((state.filters.page ?? 1) > lastPage) {
            set(currentState => ({
              filters: { ...currentState.filters, page: lastPage },
              pagination: {
                ...buildPaginationState(result.data),
                page: lastPage,
              },
            }));
            return get().loadUsers();
          }
          set(currentState => ({
            users: result.data.users,
            filters: { ...currentState.filters, page: result.data.page },
            pagination: buildPaginationState(result.data),
            loading: updateLoadingState(currentState.loading, 'users', false),
          }));
          return true;
        }

        set(currentState => ({
          error: result.error?.message || 'Failed to load user list',
          loading: updateLoadingState(currentState.loading, 'users', false),
        }));
      } catch (error) {
        if (get().readRequestIds.users !== requestId) return false;
        set(currentState => ({
          error: getErrorMessage(error, 'Failed to load user list'),
          loading: updateLoadingState(currentState.loading, 'users', false),
        }));
      }
      return false;
    },

    loadStats: async () => {
      const requestId = get().readRequestIds.stats + 1;
      set(state => ({
        readRequestIds: { ...state.readRequestIds, stats: requestId },
        loading: updateLoadingState(state.loading, 'stats', true),
      }));

      try {
        const result =
          await callInternalDataAction<UserStats>('users.getUserStats');

        if (get().readRequestIds.stats !== requestId) return;

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
        if (get().readRequestIds.stats !== requestId) return;
        set(state => ({
          error: getErrorMessage(error, 'Failed to load statistics'),
          loading: updateLoadingState(state.loading, 'stats', false),
        }));
      }
    },

    loadUserDetail: async (userId: string) => {
      const requestId = get().readRequestIds.userDetail + 1;
      set(state => ({
        readRequestIds: { ...state.readRequestIds, userDetail: requestId },
        selectedUser: null,
        showUserDetail: true,
        loading: updateLoadingState(state.loading, 'userDetail', true),
        error: null,
      }));

      try {
        const result = await callInternalDataAction<EnhancedUser | null>(
          'users.getUserById',
          { userId }
        );

        if (get().readRequestIds.userDetail !== requestId) return false;

        if (result.success && result.data?.id === userId) {
          set(state => ({
            selectedUser: result.data,
            loading: updateLoadingState(state.loading, 'userDetail', false),
          }));
          return true;
        }

        set(state => ({
          showUserDetail: false,
          error: result.error?.message || 'Failed to load user detail',
          loading: updateLoadingState(state.loading, 'userDetail', false),
        }));
      } catch (error) {
        if (get().readRequestIds.userDetail !== requestId) return false;
        set(state => ({
          showUserDetail: false,
          error: getErrorMessage(error, 'Failed to load user detail'),
          loading: updateLoadingState(state.loading, 'userDetail', false),
        }));
      }
      return false;
    },

    loadFilterOptions: async () => {
      console.log('Filter options loading: simplified in group system');
    },

    loadDepartmentsByOrganization: async (_organizationName: string) => {
      console.log('Department options loading: removed in group system');
    },
  };
}
