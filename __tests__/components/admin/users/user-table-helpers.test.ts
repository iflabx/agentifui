/** @jest-environment node */
import {
  canChangeUserRole,
  canDeleteUser,
  canEditUser,
  formatUserPhone,
  getBadgeClasses,
  getMoreGroupsTooltip,
  getRoleInfo,
  getStatusInfo,
  getUserDisplayName,
} from '@components/admin/users/user-table/helpers';

const t = (key: string, values?: Record<string, string | number>) => {
  if (key === 'actions.moreGroupsTooltip') {
    return `${values?.count}:${values?.names}`;
  }

  return key;
};

const baseUser = {
  id: 'u-1',
  role: 'user',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  profile_created_at: '2026-01-01T00:00:00Z',
  profile_updated_at: '2026-01-01T00:00:00Z',
} as const;

describe('user table helpers', () => {
  it('derives display names with fallback order', () => {
    expect(
      getUserDisplayName(t, {
        full_name: 'Alice',
        email: 'a@example.com',
      } as never)
    ).toBe('Alice');
    expect(getUserDisplayName(t, { email: 'a@example.com' } as never)).toBe(
      'a@example.com'
    );
    expect(getUserDisplayName(t, null)).toBe('actions.defaultUser');
  });

  it('enforces role change, delete, and edit permissions', () => {
    const currentAdmin = { id: 'admin-1', role: 'admin' as const };
    const selfAdmin = { ...baseUser, id: 'admin-1', role: 'admin' as const };
    const otherAdmin = { ...baseUser, id: 'admin-2', role: 'admin' as const };
    const otherUser = { ...baseUser, id: 'user-2', role: 'user' as const };

    expect(canChangeUserRole(currentAdmin, selfAdmin as never, 'manager')).toBe(
      false
    );
    expect(canChangeUserRole(currentAdmin, otherAdmin as never, 'user')).toBe(
      false
    );
    expect(canChangeUserRole(currentAdmin, otherUser as never, 'manager')).toBe(
      true
    );
    expect(canDeleteUser(currentAdmin, selfAdmin as never)).toBe(false);
    expect(canDeleteUser(currentAdmin, otherAdmin as never)).toBe(false);
    expect(canDeleteUser(currentAdmin, otherUser as never)).toBe(true);
    expect(
      canEditUser({ id: 'user-1', role: 'user' }, otherUser as never)
    ).toBe(false);
    expect(
      canEditUser({ id: 'user-2', role: 'user' }, otherUser as never)
    ).toBe(true);
  });

  it('formats badge metadata and phones', () => {
    expect(getRoleInfo(t, 'admin').label).toBe('messages.roles.admin');
    expect(getRoleInfo(t, 'manager').variant).toBe('warning');
    expect(getStatusInfo(t, 'active').variant).toBe('success');
    expect(getStatusInfo(t, 'pending').label).toBe('messages.statuses.pending');
    expect(getBadgeClasses('danger')).toContain('text-red-700');
    expect(formatUserPhone('8613812345678')).toBe('13812345678');
    expect(formatUserPhone('13812345678')).toBe('13812345678');
    expect(formatUserPhone(null)).toBeNull();
  });

  it('builds overflow group tooltip text', () => {
    expect(
      getMoreGroupsTooltip(t, {
        ...baseUser,
        groups: [
          { id: 'g1', name: 'A', joined_at: '2026-01-01T00:00:00Z' },
          { id: 'g2', name: 'B', joined_at: '2026-01-01T00:00:00Z' },
          { id: 'g3', name: 'C', joined_at: '2026-01-01T00:00:00Z' },
        ],
      } as never)
    ).toBe('1:C');
    expect(
      getMoreGroupsTooltip(t, { ...baseUser, groups: [] } as never)
    ).toBeNull();
  });
});
