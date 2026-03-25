import type { AccountStatus, UserRole } from '@lib/types/database';

import type {
  EnhancedUser,
  LoadingState,
  PaginationState,
  UserListPayload,
} from './types';

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function updateLoadingState(
  loading: LoadingState,
  key: keyof LoadingState,
  value: boolean
): LoadingState {
  return {
    ...loading,
    [key]: value,
  };
}

export function buildPaginationState(
  payload: UserListPayload
): PaginationState {
  return {
    total: payload.total,
    page: payload.page,
    pageSize: payload.pageSize,
    totalPages: payload.totalPages,
  };
}

export function mergeUpdatedUser(
  users: EnhancedUser[],
  userId: string,
  updatedUser: EnhancedUser
) {
  return users.map(user =>
    user.id === userId ? { ...user, ...updatedUser } : user
  );
}

export function mergeSelectedUser(
  selectedUser: EnhancedUser | null,
  userId: string,
  updatedUser: EnhancedUser
) {
  if (selectedUser?.id !== userId) {
    return selectedUser;
  }

  return { ...selectedUser, ...updatedUser };
}

export function toggleSelectedUserIds(
  selectedUserIds: string[],
  userId: string
) {
  return selectedUserIds.includes(userId)
    ? selectedUserIds.filter(id => id !== userId)
    : [...selectedUserIds, userId];
}

export function applyBatchStatus(
  users: EnhancedUser[],
  userIds: string[],
  status: AccountStatus
) {
  return users.map(user =>
    userIds.includes(user.id) ? { ...user, status } : user
  );
}

export function applyBatchRole(
  users: EnhancedUser[],
  userIds: string[],
  role: UserRole
) {
  return users.map(user =>
    userIds.includes(user.id) ? { ...user, role } : user
  );
}
