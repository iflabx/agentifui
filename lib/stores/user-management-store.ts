/**
 * User Management State Store
 *
 * Uses Zustand to manage the state for the user management interface,
 * including user list, filters, pagination, statistics, etc.
 */
import {
  type EnhancedUser,
  type UserFilters,
  type UserStats,
  batchUpdateUserRole,
  batchUpdateUserStatus,
  deleteUser,
  getUserById,
  getUserList,
  getUserStats,
  updateUserProfile,
} from '@lib/db/users';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Loading state interface
interface LoadingState {
  users: boolean;
  stats: boolean;
  userDetail: boolean;
  updating: boolean;
  deleting: boolean;
  batchOperating: boolean;
}

// Filter options type (simplified, no organization/department)
interface FilterOptions {
  // No organization/department options needed in group system
}

// User management state interface
interface UserManagementState {
  // Data state
  users: EnhancedUser[];
  stats: UserStats | null;
  selectedUser: EnhancedUser | null;
  selectedUserIds: string[];

  // Filter options data
  filterOptions: FilterOptions;

  // Pagination and filters
  filters: UserFilters;
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };

  // Loading state
  loading: LoadingState;
  error: string | null;

  // UI state
  showUserDetail: boolean;
  showBatchActions: boolean;

  // Actions
  loadUsers: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadUserDetail: (userId: string) => Promise<void>;
  loadFilterOptions: () => Promise<void>;

  updateFilters: (filters: Partial<UserFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  selectUser: (user: EnhancedUser) => void;
  selectUsers: (userIds: string[]) => void;
  toggleUserSelection: (userId: string) => void;
  clearSelection: () => void;

  // User operations
  updateUser: (
    userId: string,
    updates: Partial<EnhancedUser>
  ) => Promise<boolean>;
  changeUserRole: (
    userId: string,
    role: 'admin' | 'manager' | 'user'
  ) => Promise<boolean>;
  changeUserStatus: (
    userId: string,
    status: 'active' | 'suspended' | 'pending'
  ) => Promise<boolean>;
  removeUser: (userId: string) => Promise<boolean>;

  // Batch operations
  batchChangeStatus: (
    status: 'active' | 'suspended' | 'pending'
  ) => Promise<boolean>;
  batchChangeRole: (role: 'admin' | 'manager' | 'user') => Promise<boolean>;

  // UI operations
  showUserDetailModal: (user: EnhancedUser) => void;
  hideUserDetailModal: () => void;

  // Cleanup
  clearError: () => void;
  resetStore: () => void;
}

// Initial state
const initialState = {
  users: [],
  stats: null,
  selectedUser: null,
  selectedUserIds: [],
  filterOptions: {
    // No organization/department options needed in group system
  },
  filters: {
    page: 1,
    pageSize: 20,
    sortBy: 'created_at' as const,
    sortOrder: 'desc' as const,
  },
  pagination: {
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  },
  loading: {
    users: false,
    stats: false,
    userDetail: false,
    updating: false,
    deleting: false,
    batchOperating: false,
  },
  error: null,
  showUserDetail: false,
  showBatchActions: false,
};

export const useUserManagementStore = create<UserManagementState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Load user list
      loadUsers: async () => {
        const state = get();
        set(state => ({
          loading: { ...state.loading, users: true },
          error: null,
        }));

        try {
          const result = await getUserList(state.filters);

          if (result.success) {
            set(state => ({
              users: result.data.users,
              pagination: {
                total: result.data.total,
                page: result.data.page,
                pageSize: result.data.pageSize,
                totalPages: result.data.totalPages,
              },
              loading: { ...state.loading, users: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load user list',
              loading: { ...state.loading, users: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load user list',
            loading: { ...state.loading, users: false },
          }));
        }
      },

      // Load statistics
      loadStats: async () => {
        set(state => ({
          loading: { ...state.loading, stats: true },
          error: null,
        }));

        try {
          const result = await getUserStats();

          if (result.success) {
            set(state => ({
              stats: result.data,
              loading: { ...state.loading, stats: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load statistics',
              loading: { ...state.loading, stats: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load statistics',
            loading: { ...state.loading, stats: false },
          }));
        }
      },

      // Load user detail
      loadUserDetail: async (userId: string) => {
        set(state => ({
          loading: { ...state.loading, userDetail: true },
          error: null,
        }));

        try {
          const result = await getUserById(userId);

          if (result.success && result.data) {
            set(state => ({
              selectedUser: result.data,
              loading: { ...state.loading, userDetail: false },
            }));
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to load user detail',
              loading: { ...state.loading, userDetail: false },
            }));
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to load user detail',
            loading: { ...state.loading, userDetail: false },
          }));
        }
      },

      // Load filter options (no-op in group system)
      loadFilterOptions: async () => {
        // No need to preload filter options in group system
        console.log('Filter options loading: simplified in group system');
      },

      // Load departments by organization (removed in group system)
      loadDepartmentsByOrganization: async (organizationName: string) => {
        // This feature is removed in group system
        console.log('Department options loading: removed in group system');
      },

      // Update filter conditions
      updateFilters: (newFilters: Partial<UserFilters>) => {
        set(state => ({
          filters: { ...state.filters, ...newFilters, page: 1 }, // Reset to first page
          selectedUserIds: [], // Clear selection
        }));

        // Automatically reload data
        get().loadUsers();
      },

      // Set page number
      setPage: (page: number) => {
        set(state => ({
          filters: { ...state.filters, page },
        }));

        // Automatically reload data
        get().loadUsers();
      },

      // Set page size
      setPageSize: (pageSize: number) => {
        set(state => ({
          filters: { ...state.filters, pageSize, page: 1 }, // Reset to first page
        }));

        // Automatically reload data
        get().loadUsers();
      },

      // Select a user
      selectUser: (user: EnhancedUser) => {
        set({ selectedUser: user });
      },

      // Select multiple users
      selectUsers: (userIds: string[]) => {
        set({ selectedUserIds: userIds });
      },

      // Toggle user selection
      toggleUserSelection: (userId: string) => {
        set(state => {
          const selectedIds = state.selectedUserIds;
          const isSelected = selectedIds.includes(userId);

          return {
            selectedUserIds: isSelected
              ? selectedIds.filter(id => id !== userId)
              : [...selectedIds, userId],
          };
        });
      },

      // Clear selection
      clearSelection: () => {
        set({ selectedUserIds: [], selectedUser: null });
      },

      // Update user
      updateUser: async (userId: string, updates: Partial<EnhancedUser>) => {
        set(state => ({
          loading: { ...state.loading, updating: true },
          error: null,
        }));

        try {
          const result = await updateUserProfile(userId, updates as any);

          if (result.success) {
            // Update local state
            set(state => ({
              users: state.users.map(user =>
                user.id === userId ? { ...user, ...updates } : user
              ),
              selectedUser:
                state.selectedUser?.id === userId
                  ? { ...state.selectedUser, ...updates }
                  : state.selectedUser,
              loading: { ...state.loading, updating: false },
            }));

            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to update user',
              loading: { ...state.loading, updating: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error ? error.message : 'Failed to update user',
            loading: { ...state.loading, updating: false },
          }));
          return false;
        }
      },

      // Change user role
      changeUserRole: async (
        userId: string,
        role: 'admin' | 'manager' | 'user'
      ) => {
        const result = await get().updateUser(userId, { role });
        if (result) {
          // Reload statistics
          get().loadStats();
        }
        return result;
      },

      // Change user status
      changeUserStatus: async (
        userId: string,
        status: 'active' | 'suspended' | 'pending'
      ) => {
        const result = await get().updateUser(userId, { status });
        if (result) {
          // Reload statistics
          get().loadStats();
        }
        return result;
      },

      // Remove user
      removeUser: async (userId: string) => {
        set(state => ({
          loading: { ...state.loading, deleting: true },
          error: null,
        }));

        try {
          const result = await deleteUser(userId);

          if (result.success) {
            // Remove user from local state
            set(state => ({
              users: state.users.filter(user => user.id !== userId),
              selectedUserIds: state.selectedUserIds.filter(
                id => id !== userId
              ),
              selectedUser:
                state.selectedUser?.id === userId ? null : state.selectedUser,
              loading: { ...state.loading, deleting: false },
            }));

            // Reload statistics
            get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to delete user',
              loading: { ...state.loading, deleting: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error ? error.message : 'Failed to delete user',
            loading: { ...state.loading, deleting: false },
          }));
          return false;
        }
      },

      // Batch change user status
      batchChangeStatus: async (status: 'active' | 'suspended' | 'pending') => {
        const state = get();
        const userIds = state.selectedUserIds;

        if (userIds.length === 0) return false;

        set(state => ({
          loading: { ...state.loading, batchOperating: true },
          error: null,
        }));

        try {
          const result = await batchUpdateUserStatus(userIds, status);

          if (result.success) {
            // Update local state
            set(state => ({
              users: state.users.map(user =>
                userIds.includes(user.id) ? { ...user, status } : user
              ),
              selectedUserIds: [], // Clear selection
              loading: { ...state.loading, batchOperating: false },
            }));

            // Reload statistics
            get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to batch update status',
              loading: { ...state.loading, batchOperating: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to batch update status',
            loading: { ...state.loading, batchOperating: false },
          }));
          return false;
        }
      },

      // Batch change user role
      batchChangeRole: async (role: 'admin' | 'manager' | 'user') => {
        const state = get();
        const userIds = state.selectedUserIds;

        if (userIds.length === 0) return false;

        set(state => ({
          loading: { ...state.loading, batchOperating: true },
          error: null,
        }));

        try {
          const result = await batchUpdateUserRole(userIds, role);

          if (result.success) {
            // Update local state
            set(state => ({
              users: state.users.map(user =>
                userIds.includes(user.id) ? { ...user, role } : user
              ),
              selectedUserIds: [], // Clear selection
              loading: { ...state.loading, batchOperating: false },
            }));

            // Reload statistics
            get().loadStats();
            return true;
          } else {
            set(state => ({
              error: result.error?.message || 'Failed to batch update role',
              loading: { ...state.loading, batchOperating: false },
            }));
            return false;
          }
        } catch (error) {
          set(state => ({
            error:
              error instanceof Error
                ? error.message
                : 'Failed to batch update role',
            loading: { ...state.loading, batchOperating: false },
          }));
          return false;
        }
      },

      // Show user detail modal
      showUserDetailModal: (user: EnhancedUser) => {
        set({
          selectedUser: user,
          showUserDetail: true,
        });
      },

      // Hide user detail modal
      hideUserDetailModal: () => {
        set({
          showUserDetail: false,
          selectedUser: null,
        });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },

      // Reset store
      resetStore: () => {
        set(initialState);
      },
    }),
    {
      name: 'user-management-store',
      partialize: (state: UserManagementState) => ({
        filters: state.filters, // Only persist filter conditions
      }),
    }
  )
);
