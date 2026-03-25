import type { EnhancedUser, UserFilters, UserStats } from '@lib/db/users';
import type { AccountStatus, UserRole } from '@lib/types/database';

export type { EnhancedUser, UserFilters, UserStats } from '@lib/db/users';

export interface LoadingState {
  users: boolean;
  stats: boolean;
  userDetail: boolean;
  updating: boolean;
  deleting: boolean;
  batchOperating: boolean;
}

export type FilterOptions = Record<string, never>;

export interface PaginationState {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserListPayload {
  users: EnhancedUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserManagementState {
  users: EnhancedUser[];
  stats: UserStats | null;
  selectedUser: EnhancedUser | null;
  selectedUserIds: string[];
  filterOptions: FilterOptions;
  filters: UserFilters;
  pagination: PaginationState;
  loading: LoadingState;
  error: string | null;
  showUserDetail: boolean;
  showBatchActions: boolean;
  loadUsers: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadUserDetail: (userId: string) => Promise<void>;
  loadFilterOptions: () => Promise<void>;
  loadDepartmentsByOrganization: (organizationName: string) => Promise<void>;
  updateFilters: (filters: Partial<UserFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  selectUser: (user: EnhancedUser) => void;
  selectUsers: (userIds: string[]) => void;
  toggleUserSelection: (userId: string) => void;
  clearSelection: () => void;
  updateUser: (
    userId: string,
    updates: Partial<EnhancedUser>
  ) => Promise<boolean>;
  changeUserRole: (userId: string, role: UserRole) => Promise<boolean>;
  changeUserStatus: (userId: string, status: AccountStatus) => Promise<boolean>;
  removeUser: (userId: string) => Promise<boolean>;
  batchChangeStatus: (status: AccountStatus) => Promise<boolean>;
  batchChangeRole: (role: UserRole) => Promise<boolean>;
  showUserDetailModal: (user: EnhancedUser) => void;
  hideUserDetailModal: () => void;
  clearError: () => void;
  resetStore: () => void;
}

export type UserManagementStoreSet = (
  partial:
    | Partial<UserManagementState>
    | ((state: UserManagementState) => Partial<UserManagementState>)
) => void;
export type UserManagementStoreGet = () => UserManagementState;
