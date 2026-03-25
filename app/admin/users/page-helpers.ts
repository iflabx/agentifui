import type { EnhancedUser } from '@lib/db/users';
import type { AccountStatus, UserRole } from '@lib/types/database';

export type PermissionResult = {
  allowed: boolean;
  reasonKey?: string;
};

export type UsersPagination = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function getUserDisplayName(
  user: Partial<EnhancedUser> | null | undefined,
  fallback: string
) {
  return user?.full_name || user?.email || fallback;
}

export function evaluateRoleChangePermission(input: {
  currentUserId?: string | null;
  currentUserRole?: UserRole | null;
  targetUser: EnhancedUser;
  newRole: UserRole;
}): PermissionResult {
  if (input.currentUserRole !== 'admin') {
    return { allowed: false };
  }

  if (input.targetUser.id === input.currentUserId) {
    return {
      allowed: false,
      reasonKey: 'messages.cannotChangeOwnRole',
    };
  }

  if (input.targetUser.role === 'admin' && input.newRole !== 'admin') {
    return {
      allowed: false,
      reasonKey: 'messages.cannotDowngradeOtherAdmin',
    };
  }

  return { allowed: true };
}

export function evaluateDeletePermission(input: {
  currentUserId?: string | null;
  currentUserRole?: UserRole | null;
  targetUser: EnhancedUser;
}): PermissionResult {
  if (input.currentUserRole !== 'admin') {
    return { allowed: false };
  }

  if (input.targetUser.id === input.currentUserId) {
    return {
      allowed: false,
      reasonKey: 'messages.cannotDeleteSelf',
    };
  }

  if (input.targetUser.role === 'admin') {
    return {
      allowed: false,
      reasonKey: 'messages.cannotDeleteOtherAdmin',
    };
  }

  return { allowed: true };
}

export function evaluateBatchRoleChangePermission(input: {
  currentUserId?: string | null;
  currentUserRole?: UserRole | null;
  newRole: UserRole;
  selectedUsers: EnhancedUser[];
}): PermissionResult {
  if (input.currentUserRole !== 'admin') {
    return { allowed: false };
  }

  const includesSelf = input.selectedUsers.some(
    user => user.id === input.currentUserId
  );
  if (includesSelf) {
    return {
      allowed: false,
      reasonKey: 'messages.cannotIncludeSelf',
    };
  }

  const hasAdminBeingDowngraded = input.selectedUsers.some(
    user => user.role === 'admin' && input.newRole !== 'admin'
  );
  if (hasAdminBeingDowngraded) {
    return {
      allowed: false,
      reasonKey: 'messages.cannotDowngradeAdmin',
    };
  }

  return { allowed: true };
}

export function getPaginationRange(pagination: UsersPagination) {
  if (pagination.total === 0) {
    return { start: 0, end: 0, total: 0 };
  }

  return {
    start: (pagination.page - 1) * pagination.pageSize + 1,
    end: Math.min(pagination.page * pagination.pageSize, pagination.total),
    total: pagination.total,
  };
}

export function createBatchActionValue<T extends UserRole | AccountStatus>(
  type: 'role' | 'status',
  value: T
) {
  return { type, value } as const;
}
