/** @jest-environment node */
import { callInternalDataAction } from '@lib/db/internal-data-api';
import { useUserManagementStore } from '@lib/stores/user-management-store';
import type {
  EnhancedUser,
  UserListPayload,
} from '@lib/stores/user-management-store/types';

jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));

const mockAction = jest.mocked(callInternalDataAction);
const baseUser: EnhancedUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  profile_created_at: '2026-01-01T00:00:00Z',
  profile_updated_at: '2026-01-01T00:00:00Z',
};

function deferred<Response>() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function listPayload(
  users: EnhancedUser[],
  overrides: Partial<UserListPayload> = {}
): UserListPayload {
  return {
    users,
    total: users.length,
    page: 1,
    pageSize: 20,
    totalPages: users.length ? 1 : 0,
    ...overrides,
  };
}

const store = () => useUserManagementStore.getState();

beforeEach(() => {
  store().resetStore();
  mockAction.mockReset();
});

describe('user list request ordering', () => {
  it('keeps the latest search results when responses arrive in reverse order', async () => {
    const older =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    const newer =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const oldRequest = store().loadUsers();
    useUserManagementStore.setState({ filters: { search: 'new', page: 1 } });
    const newRequest = store().loadUsers();
    const newUser = { ...baseUser, id: 'new' };
    newer.resolve({ success: true, data: listPayload([newUser]) });
    await newRequest;
    older.resolve({ success: true, data: listPayload([baseUser]) });
    await oldRequest;
    expect(store().users).toEqual([newUser]);
    expect(store().filters.search).toBe('new');
    expect(store().loading.users).toBe(false);
  });

  it.each(['failure', 'throw'] as const)(
    'ignores an old %s without clearing the pending request loading state',
    async failureMode => {
      const older =
        deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
      const newer =
        deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
      mockAction
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const oldRequest = store().loadUsers();
      const newRequest = store().loadUsers();
      if (failureMode === 'throw') older.reject(new Error('old failure'));
      else older.resolve({ success: false, error: new Error('old failure') });
      await oldRequest;
      expect(store().loading.users).toBe(true);
      expect(store().error).toBeNull();
      newer.resolve({ success: true, data: listPayload([baseUser]) });
      await newRequest;
      expect(store().loading.users).toBe(false);
    }
  );

  it('does not let an old success erase the latest failure', async () => {
    const older =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction.mockReturnValueOnce(older.promise).mockResolvedValueOnce({
      success: false,
      error: new Error('latest failure'),
    });
    const oldRequest = store().loadUsers();
    await store().loadUsers();
    older.resolve({ success: true, data: listPayload([baseUser]) });
    await oldRequest;
    expect(store().error).toBe('latest failure');
    expect(store().users).toEqual([]);
  });

  it('tracks statistics loading and ignores superseded errors', async () => {
    const older =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    const newer =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const oldRequest = store().loadStats();
    const newRequest = store().loadStats();
    older.reject(new Error('old statistics failure'));
    await oldRequest;
    expect(store().loading.stats).toBe(true);
    expect(store().error).toBeNull();
    newer.resolve({ success: true, data: { totalUsers: 2 } });
    await newRequest;
    expect(store().stats?.totalUsers).toBe(2);
    expect(store().loading.stats).toBe(false);
  });
});

describe('current page selection', () => {
  it.each(['page', 'pageSize', 'filters'] as const)(
    'clears selection on %s changes before the response arrives',
    async change => {
      const pending =
        deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
      mockAction.mockReturnValueOnce(pending.promise);
      useUserManagementStore.setState({
        users: [baseUser],
        selectedUserIds: [baseUser.id],
      });
      if (change === 'page') store().setPage(2);
      if (change === 'pageSize') store().setPageSize(10);
      if (change === 'filters') store().updateFilters({ search: 'other' });
      expect(store().selectedUserIds).toEqual([]);
      store().selectUsers([baseUser.id, 'off-page']);
      store().toggleUserSelection(baseUser.id);
      expect(store().selectedUserIds).toEqual([]);
      pending.resolve({ success: true, data: listPayload([]) });
      await pending.promise;
    }
  );

  it('accepts only unique visible IDs and clears selection on refresh', async () => {
    useUserManagementStore.setState({ users: [baseUser] });
    store().selectUsers([baseUser.id, baseUser.id, 'off-page']);
    expect(store().selectedUserIds).toEqual([baseUser.id]);
    mockAction.mockResolvedValueOnce({ success: true, data: listPayload([]) });
    await store().loadUsers();
    expect(store().selectedUserIds).toEqual([]);
  });
});

describe('detail lifecycle', () => {
  it('does not show a previous target while loading or accept its late response', async () => {
    const older =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    const newer =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    useUserManagementStore.setState({ selectedUser: baseUser });
    const oldRequest = store().loadUserDetail(baseUser.id);
    expect(store().selectedUser).toBeNull();
    const newRequest = store().loadUserDetail('new');
    older.resolve({ success: true, data: baseUser });
    expect(await oldRequest).toBe(false);
    expect(store().loading.userDetail).toBe(true);
    const newUser = { ...baseUser, id: 'new' };
    newer.resolve({ success: true, data: newUser });
    expect(await newRequest).toBe(true);
    expect(store().selectedUser).toEqual(newUser);
  });

  it('invalidates closed details even when reopened for the same ID', async () => {
    const older =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    const newer =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const oldRequest = store().loadUserDetail(baseUser.id);
    store().hideUserDetailModal();
    const newRequest = store().loadUserDetail(baseUser.id);
    older.resolve({ success: false, error: new Error('closed request') });
    await oldRequest;
    expect(store().showUserDetail).toBe(true);
    expect(store().loading.userDetail).toBe(true);
    expect(store().error).toBeNull();
    newer.resolve({ success: true, data: baseUser });
    await newRequest;
    expect(store().selectedUser).toEqual(baseUser);
  });

  it.each([null, 'failure'] as const)(
    'returns false and closes details for %s',
    async response => {
      mockAction.mockResolvedValueOnce(
        response === null
          ? { success: true, data: null }
          : { success: false, error: new Error('detail failed') }
      );
      expect(await store().loadUserDetail(baseUser.id)).toBe(false);
      expect(store().selectedUser).toBeNull();
      expect(store().showUserDetail).toBe(false);
      expect(store().loading.userDetail).toBe(false);
      expect(store().error).toBeTruthy();
    }
  );

  it('does not reopen a closed modal when its request succeeds late', async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction.mockReturnValueOnce(pending.promise);
    const request = store().loadUserDetail(baseUser.id);
    store().hideUserDetailModal();
    pending.resolve({ success: true, data: baseUser });
    expect(await request).toBe(false);
    expect(store().selectedUser).toBeNull();
    expect(store().showUserDetail).toBe(false);
    expect(store().loading.userDetail).toBe(false);
  });

  it('rejects a response belonging to a different detail target', async () => {
    mockAction.mockResolvedValueOnce({
      success: true,
      data: { ...baseUser, id: 'other' },
    });
    expect(await store().loadUserDetail(baseUser.id)).toBe(false);
    expect(store().selectedUser).toBeNull();
    expect(store().showUserDetail).toBe(false);
  });

  it('invalidates all pending reads on reset', async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof callInternalDataAction>>>();
    mockAction.mockReturnValue(pending.promise);
    const requests = [
      store().loadUsers(),
      store().loadStats(),
      store().loadUserDetail(baseUser.id),
    ];
    store().resetStore();
    pending.resolve({ success: true, data: baseUser });
    await Promise.all(requests);
    expect(store().users).toEqual([]);
    expect(store().stats).toBeNull();
    expect(store().selectedUser).toBeNull();
    expect(store().showUserDetail).toBe(false);
  });
});

describe('authoritative refresh after mutations', () => {
  beforeEach(() => {
    mockAction.mockImplementation(async action => {
      if (action === 'users.getUserList')
        return { success: true, data: listPayload([]) };
      if (action === 'users.getUserStats')
        return { success: true, data: { totalUsers: 0 } };
      return { success: true, data: { ...baseUser, status: 'suspended' } };
    });
    useUserManagementStore.setState({
      users: [baseUser],
      selectedUserIds: [baseUser.id],
    });
  });

  it.each(['profile', 'role', 'status', 'batchRole', 'batchStatus'] as const)(
    'reloads the current filters after a successful %s write',
    async operation => {
      useUserManagementStore.setState({
        filters: { status: 'active', sortBy: 'full_name', page: 1 },
      });
      mockAction.mockClear();
      let success: boolean;
      if (operation === 'profile')
        success = await store().updateUser(baseUser.id, { full_name: 'New' });
      else if (operation === 'role')
        success = await store().changeUserRole(baseUser.id, 'manager');
      else if (operation === 'status')
        success = await store().changeUserStatus(baseUser.id, 'suspended');
      else if (operation === 'batchRole')
        success = await store().batchChangeRole('manager');
      else success = await store().batchChangeStatus('suspended');
      expect(success).toBe(true);
      expect(mockAction).toHaveBeenCalledWith('users.getUserList', {
        filters: expect.objectContaining({
          status: 'active',
          sortBy: 'full_name',
        }),
      });
      expect(store().users).toEqual([]);
      expect(store().pagination.total).toBe(0);
      expect(store().selectedUserIds).toEqual([]);
    }
  );

  it('reloads the last valid page after deleting its only row', async () => {
    useUserManagementStore.setState({ filters: { page: 2, pageSize: 20 } });
    mockAction
      .mockResolvedValueOnce({ success: true, data: undefined })
      .mockResolvedValueOnce({
        success: true,
        data: listPayload([], { total: 20, page: 2, totalPages: 1 }),
      })
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({
        success: true,
        data: listPayload([baseUser], { total: 20 }),
      });
    expect(await store().removeUser('deleted')).toBe(true);
    expect(store().filters.page).toBe(1);
    expect(store().pagination.page).toBe(1);
    expect(store().users).toEqual([baseUser]);
  });

  it('returns to page one when deleting the final user leaves no pages', async () => {
    useUserManagementStore.setState({ filters: { page: 2, pageSize: 20 } });
    mockAction
      .mockResolvedValueOnce({ success: true, data: undefined })
      .mockResolvedValueOnce({
        success: true,
        data: listPayload([], { page: 2 }),
      })
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ success: true, data: listPayload([]) });
    expect(await store().removeUser(baseUser.id)).toBe(true);
    expect(store().filters.page).toBe(1);
    expect(store().pagination).toMatchObject({
      page: 1,
      total: 0,
      totalPages: 0,
    });
  });

  it('does not send selected IDs that do not belong to the current page', async () => {
    useUserManagementStore.setState({
      selectedUserIds: [baseUser.id, 'off-page'],
    });
    expect(await store().batchChangeRole('manager')).toBe(true);
    expect(mockAction).toHaveBeenCalledWith('users.batchUpdateUserRole', {
      userIds: [baseUser.id],
      role: 'manager',
    });
  });

  it('does not send email even if a caller includes it in profile updates', async () => {
    await store().updateUser(baseUser.id, {
      email: 'new@example.com',
      full_name: 'New',
    });
    expect(mockAction).toHaveBeenCalledWith('users.updateUserProfile', {
      userId: baseUser.id,
      updates: { full_name: 'New' },
    });
  });

  it('keeps write success distinct from a failed refresh, without retrying the write', async () => {
    mockAction.mockImplementation(async action =>
      action === 'users.getUserList'
        ? { success: false, error: new Error('refresh failed') }
        : { success: true, data: baseUser }
    );
    expect(await store().updateUser(baseUser.id, { full_name: 'New' })).toBe(
      true
    );
    expect(store().error).toBe('refresh failed');
    expect(
      mockAction.mock.calls.filter(
        ([action]) => action === 'users.updateUserProfile'
      )
    ).toHaveLength(1);
    expect(store().loading.updating).toBe(false);
  });

  it('does not report success or refresh after a failed write', async () => {
    mockAction.mockResolvedValueOnce({
      success: false,
      error: new Error('write failed'),
    });
    expect(await store().removeUser(baseUser.id)).toBe(false);
    expect(mockAction).toHaveBeenCalledTimes(1);
    expect(store().users).toEqual([baseUser]);
  });
});
