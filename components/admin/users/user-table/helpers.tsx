import type { EnhancedUser } from '@lib/db/users';
import type { AccountStatus, UserRole } from '@lib/types/database';
import { Clock, Crown, Shield, UserCheck, UserIcon, UserX } from 'lucide-react';

import type { ReactNode } from 'react';

export type UserTableBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral';

export type UserTableTranslations = (
  key: string,
  values?: Record<string, string | number>
) => string;

interface CurrentUserAccess {
  id?: string | null;
  role?: UserRole | null;
}

interface UserBadgeInfo {
  label: string;
  icon: ReactNode;
  variant: UserTableBadgeVariant;
}

export function getUserDisplayName(
  t: UserTableTranslations,
  user?: Partial<EnhancedUser> | null
) {
  return user?.full_name || user?.email || t('actions.defaultUser');
}

export function canChangeUserRole(
  currentUser: CurrentUserAccess,
  targetUser: EnhancedUser,
  newRole: UserRole
) {
  if (currentUser.role !== 'admin') {
    return false;
  }

  if (targetUser.id === currentUser.id) {
    return false;
  }

  if (targetUser.role === 'admin' && newRole !== 'admin') {
    return false;
  }

  return true;
}

export function canDeleteUser(
  currentUser: CurrentUserAccess,
  targetUser: EnhancedUser
) {
  if (currentUser.role !== 'admin') {
    return false;
  }

  if (targetUser.id === currentUser.id) {
    return false;
  }

  if (targetUser.role === 'admin') {
    return false;
  }

  return true;
}

export function canEditUser(
  currentUser: CurrentUserAccess,
  targetUser: EnhancedUser
) {
  if (currentUser.role === 'admin') {
    return true;
  }

  return targetUser.id === currentUser.id;
}

export function getRoleInfo(
  t: UserTableTranslations,
  role: UserRole
): UserBadgeInfo {
  switch (role) {
    case 'admin':
      return {
        label: t('messages.roles.admin'),
        icon: <Shield className="h-4 w-4" />,
        variant: 'danger',
      };
    case 'manager':
      return {
        label: t('messages.roles.manager'),
        icon: <Crown className="h-4 w-4" />,
        variant: 'warning',
      };
    default:
      return {
        label: t('messages.roles.user'),
        icon: <UserIcon className="h-4 w-4" />,
        variant: 'neutral',
      };
  }
}

export function getStatusInfo(
  t: UserTableTranslations,
  status: AccountStatus
): UserBadgeInfo {
  switch (status) {
    case 'active':
      return {
        label: t('messages.statuses.active'),
        icon: <UserCheck className="h-4 w-4" />,
        variant: 'success',
      };
    case 'suspended':
      return {
        label: t('messages.statuses.suspended'),
        icon: <UserX className="h-4 w-4" />,
        variant: 'danger',
      };
    case 'pending':
    default:
      return {
        label: t('messages.statuses.pending'),
        icon: <Clock className="h-4 w-4" />,
        variant: status === 'pending' ? 'warning' : 'neutral',
      };
  }
}

export function getBadgeClasses(variant: UserTableBadgeVariant) {
  const variantMap: Record<UserTableBadgeVariant, string> = {
    success:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
    warning:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
    danger:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    neutral:
      'bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-700/50 dark:text-stone-300 dark:border-stone-600',
  };

  return variantMap[variant];
}

export function formatUserPhone(phone: string | null | undefined) {
  if (!phone) {
    return null;
  }

  return phone.startsWith('86') ? phone.slice(2) : phone;
}

export function getMoreGroupsTooltip(
  t: UserTableTranslations,
  user: EnhancedUser
) {
  if (!user.groups || user.groups.length <= 2) {
    return null;
  }

  return t('actions.moreGroupsTooltip', {
    count: user.groups.length - 2,
    names: user.groups
      .slice(2)
      .map(group => group.name)
      .join(', '),
  });
}
