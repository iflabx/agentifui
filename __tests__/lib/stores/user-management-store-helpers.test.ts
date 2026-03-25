/** @jest-environment node */
import type { EnhancedUser } from '@lib/db/users';
import {
  applyBatchRole,
  applyBatchStatus,
  buildPaginationState,
  getErrorMessage,
  mergeSelectedUser,
  mergeUpdatedUser,
  toggleSelectedUserIds,
  updateLoadingState,
} from '@lib/stores/user-management-store/helpers';

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

describe('user management store helpers', () => {
  it('builds pagination and loading state', () => {
    expect(
      buildPaginationState({
        users: [],
        total: 50,
        page: 2,
        pageSize: 20,
        totalPages: 3,
      })
    ).toEqual({ total: 50, page: 2, pageSize: 20, totalPages: 3 });

    expect(
      updateLoadingState(
        {
          users: false,
          stats: false,
          userDetail: false,
          updating: false,
          deleting: false,
          batchOperating: false,
        },
        'users',
        true
      )
    ).toMatchObject({ users: true });
  });

  it('merges user updates and toggles selections', () => {
    const updated = { ...baseUser, full_name: 'Alice' };
    expect(mergeUpdatedUser([baseUser], baseUser.id, updated)[0]).toMatchObject(
      {
        full_name: 'Alice',
      }
    );
    expect(mergeSelectedUser(baseUser, baseUser.id, updated)).toMatchObject({
      full_name: 'Alice',
    });
    expect(toggleSelectedUserIds([], 'u1')).toEqual(['u1']);
    expect(toggleSelectedUserIds(['u1'], 'u1')).toEqual([]);
  });

  it('applies batch role/status updates and formats errors', () => {
    expect(applyBatchRole([baseUser], ['u1'], 'admin')[0].role).toBe('admin');
    expect(applyBatchStatus([baseUser], ['u1'], 'suspended')[0].status).toBe(
      'suspended'
    );
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(getErrorMessage('x', 'fallback')).toBe('fallback');
  });
});
