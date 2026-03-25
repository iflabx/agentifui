import type { UserManagementState } from './types';

export const initialState: Pick<
  UserManagementState,
  | 'users'
  | 'stats'
  | 'selectedUser'
  | 'selectedUserIds'
  | 'filterOptions'
  | 'filters'
  | 'pagination'
  | 'loading'
  | 'error'
  | 'showUserDetail'
  | 'showBatchActions'
> = {
  users: [],
  stats: null,
  selectedUser: null,
  selectedUserIds: [],
  filterOptions: {},
  filters: {
    page: 1,
    pageSize: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
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
