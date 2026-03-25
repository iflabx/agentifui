import { toggleSelectedUserIds } from './helpers';
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
      }));

      void get().loadUsers();
    },

    setPageSize: (pageSize: number) => {
      set(state => ({
        filters: { ...state.filters, pageSize, page: 1 },
      }));

      void get().loadUsers();
    },

    selectUser: (user: EnhancedUser) => {
      set({ selectedUser: user });
    },

    selectUsers: (userIds: string[]) => {
      set({ selectedUserIds: userIds });
    },

    toggleUserSelection: (userId: string) => {
      set(state => ({
        selectedUserIds: toggleSelectedUserIds(state.selectedUserIds, userId),
      }));
    },

    clearSelection: () => {
      set({ selectedUserIds: [], selectedUser: null });
    },

    showUserDetailModal: (user: EnhancedUser) => {
      set({
        selectedUser: user,
        showUserDetail: true,
      });
    },

    hideUserDetailModal: () => {
      set({
        showUserDetail: false,
        selectedUser: null,
      });
    },

    clearError: () => {
      set({ error: null });
    },

    resetStore: () => {
      set(initialState);
    },
  };
}
