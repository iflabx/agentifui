/** @jest-environment node */
import type { EnhancedUser } from '@lib/db/users';

import {
  evaluateBatchRoleChangePermission,
  evaluateDeletePermission,
  evaluateRoleChangePermission,
  getPaginationRange,
  getUserDisplayName,
} from '@/admin/users/page-helpers';

const baseUser: EnhancedUser = {
  id: 'u1',
  email: 'user@example.com',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  role: 'user',
  status: 'active',
  profile_created_at: '2026-01-01T00:00:00Z',
  profile_updated_at: '2026-01-01T00:00:00Z',
};

describe('admin users page helpers', () => {
  it('prefers full name then email for display name', () => {
    expect(
      getUserDisplayName({ ...baseUser, full_name: 'Alice' }, 'Default')
    ).toBe('Alice');
    expect(getUserDisplayName(baseUser, 'Default')).toBe('user@example.com');
    expect(getUserDisplayName(null, 'Default')).toBe('Default');
  });

  it('blocks unsafe role and delete operations', () => {
    expect(
      evaluateRoleChangePermission({
        currentUserId: 'admin-1',
        currentUserRole: 'admin',
        targetUser: { ...baseUser, id: 'admin-2', role: 'admin' },
        newRole: 'user',
      })
    ).toEqual({
      allowed: false,
      reasonKey: 'messages.cannotDowngradeOtherAdmin',
    });

    expect(
      evaluateDeletePermission({
        currentUserId: 'u1',
        currentUserRole: 'admin',
        targetUser: baseUser,
      })
    ).toEqual({
      allowed: false,
      reasonKey: 'messages.cannotDeleteSelf',
    });
  });

  it('validates batch role changes and pagination ranges', () => {
    expect(
      evaluateBatchRoleChangePermission({
        currentUserId: 'admin-1',
        currentUserRole: 'admin',
        newRole: 'user',
        selectedUsers: [
          { ...baseUser, id: 'admin-2', role: 'admin' },
          { ...baseUser, id: 'u2' },
        ],
      })
    ).toEqual({
      allowed: false,
      reasonKey: 'messages.cannotDowngradeAdmin',
    });

    expect(
      getPaginationRange({ total: 45, page: 2, pageSize: 20, totalPages: 3 })
    ).toEqual({ start: 21, end: 40, total: 45 });
    expect(
      getPaginationRange({ total: 0, page: 1, pageSize: 20, totalPages: 0 })
    ).toEqual({ start: 0, end: 0, total: 0 });
  });
});
