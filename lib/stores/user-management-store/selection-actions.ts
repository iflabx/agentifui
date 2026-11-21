import { toggleSelectedUserIds, updateLoadingState } from './helpers';
import { initialState } from './state';
import type {
  EnhancedUser,
  UserFilters,
  UserManagementStoreGet,
  UserManagementStoreSet,
} from './types';

export function createSelectionActions(
  set: UserManagementStoreSet,
  get: UserManagementStoreGet
) {
  return {
    updateFilters: (newFilters: Partial<UserFilters>) => {
      set(state => ({
        filters: { ...state.filters, ...newFilters, page: 1 },
        selectedUserIds: [],
      }));

      void get().loadUsers();
    },

    setPage: (page: number) => {
      set(state => ({
        filters: { ...state.filters, page },
        selectedUserIds: [],
      }));

      void get().loadUsers();
    },

    setPageSize: (pageSize: number) => {
      set(state => ({
        filters: { ...state.filters, pageSize, page: 1 },
        selectedUserIds: [],
      }));

      void get().loadUsers();
    },

    selectUser: (user: EnhancedUser) => {
      set(state => ({
        selectedUser: user,
        readRequestIds: {
          ...state.readRequestIds,
          userDetail: state.readRequestIds.userDetail + 1,
        },
        loading: updateLoadingState(state.loading, 'userDetail', false),
      }));
    },

    selectUsers: (userIds: string[]) => {
      set(state => ({
        selectedUserIds: state.loading.users
          ? []
          : [...new Set(userIds)].filter(userId =>
              state.users.some(user => user.id === userId)
            ),
      }));
    },

    toggleUserSelection: (userId: string) => {
      if (get().loading.users || !get().users.some(user => user.id === userId))
        return;
      set(state => ({
        selectedUserIds: toggleSelectedUserIds(state.selectedUserIds, userId),
      }));
    },

    clearSelection: () => {
      set({ selectedUserIds: [] });
    },

    showUserDetailModal: (user: EnhancedUser) => {
      get().selectUser(user);
      set({
        selectedUser: user,
        showUserDetail: true,
      });
    },

    hideUserDetailModal: () => {
      set(state => ({
        showUserDetail: false,
        selectedUser: null,
        readRequestIds: {
          ...state.readRequestIds,
          userDetail: state.readRequestIds.userDetail + 1,
        },
        loading: updateLoadingState(state.loading, 'userDetail', false),
      }));
    },

    clearError: () => {
      set({ error: null });
    },

    resetStore: () => {
      set(state => ({
        ...initialState,
        readRequestIds: {
          users: state.readRequestIds.users + 1,
          stats: state.readRequestIds.stats + 1,
          userDetail: state.readRequestIds.userDetail + 1,
        },
      }));
    },
  };
}
