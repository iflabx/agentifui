/** @jest-environment node */
import { callInternalDataAction } from '@lib/db/internal-data-api';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import { type Result, failure, success } from '@lib/types/result';

jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));

const group = {
  id: 'group',
  name: 'Original group',
  description: 'Original description',
  created_by: 'admin',
  created_at: '2026-11-20T00:00:00Z',
  member_count: 2,
};

function members(...userIds: string[]) {
  return userIds.map(userId => ({
    id: `membership-${userId}`,
    group_id: group.id,
    user_id: userId,
    created_at: group.created_at,
  }));
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.mocked(callInternalDataAction).mockReset();
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
  useGroupManagementStore.setState({
    groups: [group, { ...group, id: 'other', member_count: 4 }],
    currentGroup: group,
    groupMembers: { [group.id]: members('one', 'two') },
    stats: { totalGroups: 2, activeGroups: 2, totalMembers: 6 },
  });
});

afterEach(() => {
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
});

describe('group edits', () => {
  it('uses server fields and preserves list counts', async () => {
    jest.mocked(callInternalDataAction).mockResolvedValueOnce(
      success({
        ...group,
        name: 'Server normalized',
        description: null,
        member_count: 999,
      })
    );

    expect(
      await useGroupManagementStore.getState().updateGroup(group.id, {
        name: 'Submitted',
        description: '',
      })
    ).toBe(true);

    expect(callInternalDataAction).toHaveBeenCalledWith('groups.updateGroup', {
      groupId: group.id,
      data: { name: 'Submitted', description: '' },
    });
    const state = useGroupManagementStore.getState();
    expect(state.groups[0]).toMatchObject({
      name: 'Server normalized',
      description: null,
      member_count: 2,
    });
    expect(state.currentGroup).toEqual(state.groups[0]);
    expect(state.stats.totalMembers).toBe(6);
  });

  it('creates a group without a description', async () => {
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(
        success({ ...group, id: 'new-group', description: null })
      );
    expect(
      await useGroupManagementStore
        .getState()
        .createGroup({ name: 'New group' })
    ).toBe(true);
    expect(useGroupManagementStore.getState().groups[0]).toMatchObject({
      id: 'new-group',
      description: null,
      member_count: 0,
    });
  });
});

describe('authoritative membership counts', () => {
  it('applies the full-list count delta only once', async () => {
    const authoritative = members('one', 'two', 'external');
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValue(success(authoritative));

    expect(
      await useGroupManagementStore.getState().loadGroupMembers(group.id)
    ).toBe(true);
    expect(
      await useGroupManagementStore.getState().loadGroupMembers(group.id)
    ).toBe(true);

    const state = useGroupManagementStore.getState();
    expect(state.groupMembers[group.id]).toEqual(authoritative);
    expect(state.groups.map(group => group.member_count)).toEqual([3, 4]);
    expect(state.currentGroup?.member_count).toBe(3);
    expect(state.stats).toEqual({
      totalGroups: 2,
      activeGroups: 2,
      totalMembers: 7,
    });
  });

  it('ignores an older member snapshot that returns after a newer reload', async () => {
    type MemberList = ReturnType<typeof members>;
    const older = deferred<Result<MemberList>>();
    const newer = deferred<Result<MemberList>>();
    jest
      .mocked(callInternalDataAction)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const olderLoad = useGroupManagementStore
      .getState()
      .loadGroupMembers(group.id);
    const newerLoad = useGroupManagementStore
      .getState()
      .loadGroupMembers(group.id);

    newer.resolve(success(members('one', 'two', 'new')));
    expect(await newerLoad).toBe(true);
    older.resolve(success(members('one', 'two')));
    expect(await olderLoad).toBe(false);

    const state = useGroupManagementStore.getState();
    expect(state.groupMembers[group.id]).toEqual(members('one', 'two', 'new'));
    expect(state.groups[0].member_count).toBe(3);
    expect(state.currentGroup?.member_count).toBe(3);
    expect(state.stats.totalMembers).toBe(7);
  });

  it('does not decrement an already-removed member twice', async () => {
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(success(members('one', 'two', 'external')))
      .mockResolvedValueOnce(success(undefined))
      .mockResolvedValueOnce(success(members('one', 'two')))
      .mockResolvedValueOnce(success(undefined))
      .mockResolvedValueOnce(success(members('one', 'two')));

    await useGroupManagementStore.getState().loadGroupMembers(group.id);
    expect(
      await useGroupManagementStore
        .getState()
        .removeMember(group.id, 'external')
    ).toBe(true);
    expect(
      await useGroupManagementStore
        .getState()
        .removeMember(group.id, 'external')
    ).toBe(true);

    const state = useGroupManagementStore.getState();
    expect(state.groups[0].member_count).toBe(2);
    expect(state.groupMembers[group.id]).toHaveLength(2);
    expect(state.stats.totalMembers).toBe(6);
  });

  it('uses reloaded counts rather than incrementing a stale count', async () => {
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(success(members('new')[0]))
      .mockResolvedValueOnce(success(members('one', 'two', 'external', 'new')));

    expect(
      await useGroupManagementStore.getState().addMember(group.id, 'new')
    ).toBe(true);
    const state = useGroupManagementStore.getState();
    expect(state.groups[0].member_count).toBe(4);
    expect(state.stats.totalMembers).toBe(8);
  });

  it.each(['addMember', 'removeMember'] as const)(
    'reports write success with refresh failure for %s',
    async action => {
      jest
        .mocked(callInternalDataAction)
        .mockResolvedValueOnce(success(undefined))
        .mockResolvedValueOnce(failure(new Error('Read unavailable')));

      expect(
        await useGroupManagementStore.getState()[action](group.id, 'one')
      ).toBe(true);

      const state = useGroupManagementStore.getState();
      expect(state.error).toMatch(
        /Member (added|removed), but failed to refresh/
      );
      expect(state.groups[0].member_count).toBe(2);
      expect(state.stats.totalMembers).toBe(6);
      expect(state.groupMembers[group.id]).toEqual(members('one', 'two'));
      expect(state.loading.members).toBe(false);
    }
  );

  it('preserves confirmed data on a failed reload', async () => {
    jest
      .mocked(callInternalDataAction)
      .mockRejectedValueOnce(new Error('Network failure'));
    expect(
      await useGroupManagementStore.getState().loadGroupMembers(group.id)
    ).toBe(false);
    const state = useGroupManagementStore.getState();
    expect(state.groupMembers[group.id]).toEqual(members('one', 'two'));
    expect(state.stats.totalMembers).toBe(6);
    expect(state.error).toBe('Failed to load group members');
  });

  it('aligns counts when stats are refreshed before members', async () => {
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(
        success([
          { ...group, member_count: 3 },
          { ...group, id: 'other', member_count: 4 },
        ])
      )
      .mockResolvedValueOnce(success(members('one', 'two', 'external')));
    await useGroupManagementStore.getState().loadStats();
    await useGroupManagementStore.getState().loadGroupMembers(group.id);
    expect(useGroupManagementStore.getState().stats.totalMembers).toBe(7);
  });
});
