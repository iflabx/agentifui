/** @jest-environment node */
import {
  createGroupUserPagination,
  filterGroupMembers,
  getPaginationRange,
  selectAllVisibleUsers,
  toggleSelectedUserIds,
} from '@components/admin/groups/group-members-modal/helpers';

describe('group members modal helpers', () => {
  it('filters members by username, full name, or email', () => {
    const members = [
      {
        id: 'm1',
        user: {
          username: 'alice',
          full_name: 'Alice Zhang',
          email: 'alice@example.com',
        },
      },
      {
        id: 'm2',
        user: {
          username: 'bob',
          full_name: 'Bob Li',
          email: 'bob@example.com',
        },
      },
    ] as never;

    expect(filterGroupMembers(members, 'alice')).toHaveLength(1);
    expect(filterGroupMembers(members, 'bob@example.com')).toHaveLength(1);
    expect(filterGroupMembers(members, '')).toHaveLength(2);
  });

  it('creates the default pagination state', () => {
    expect(createGroupUserPagination()).toEqual({
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('toggles selected users and supports select all', () => {
    expect(toggleSelectedUserIds(['u1'], 'u2')).toEqual(['u1', 'u2']);
    expect(toggleSelectedUserIds(['u1', 'u2'], 'u1')).toEqual(['u2']);
    expect(
      selectAllVisibleUsers([{ id: 'u1' }, { id: 'u2' }] as never, true)
    ).toEqual(['u1', 'u2']);
    expect(selectAllVisibleUsers([{ id: 'u1' }] as never, false)).toEqual([]);
  });

  it('computes pagination ranges', () => {
    expect(getPaginationRange(2, 10, 25)).toEqual({
      start: 11,
      end: 20,
      total: 25,
    });
  });
});
