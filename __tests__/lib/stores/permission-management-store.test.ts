import { callInternalDataAction } from '@lib/db/internal-data-api';
import {
  type AppWithPermissions,
  usePermissionManagementStore as store,
} from '@lib/stores/permission-management-store';

jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));
const call = jest.mocked(callInternalDataAction);
const originalFetch = global.fetch;
const application = {
  id: 'app-a',
  instance_id: 'synthetic',
  visibility: 'group_only',
  groupPermissions: [],
} as unknown as AppWithPermissions;
const group = {
  id: 'group-a',
  name: 'Synthetic',
  description: null,
  created_by: '',
  created_at: '',
};
const grant = {
  service_instance_id: application.id,
  is_enabled: true,
  usage_quota: 0,
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  store.getState().reset();
  store.setState({ apps: [application] });
});

afterEach(() => {
  global.fetch = originalFetch;
});

it('reloads a selected application when groups arrive later and preserves zero quota', async () => {
  const pending = deferred<{ success: true; data: (typeof group)[] }>();
  call.mockImplementation(async action =>
    action === 'groups.getGroups'
      ? pending.promise
      : { success: true, data: [grant] }
  );
  const loading = store.getState().loadGroups();
  store.getState().selectApp(application);
  expect(store.getState().permissionStatus).toBe('loading');
  pending.resolve({ success: true, data: [group] });
  await loading;
  expect(store.getState().permissionStatus).toBe('ready');
  expect(store.getState().selectedApp?.groupPermissions[0]).toMatchObject({
    is_enabled: true,
    usage_quota: 0,
  });
});

it('does not translate failed reads into disabled grants, and allows retry', async () => {
  store.setState({
    groups: [group],
    groupsLoaded: true,
    selectedApp: {
      ...application,
      groupPermissions: [
        {
          group_id: group.id,
          group_name: group.name,
          is_enabled: true,
          usage_quota: 10,
        },
      ],
    },
  });
  call.mockResolvedValueOnce({
    success: false,
    error: new Error('Read failed'),
  });
  await store.getState().loadAppPermissions(application.id);
  expect(store.getState().permissionStatus).toBe('error');
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    true
  );
  expect(
    await store.getState().setGroupPermission(application.id, group.id, false)
  ).toBe(false);
  call.mockResolvedValueOnce({ success: true, data: [grant] });
  await store.getState().loadAppPermissions(application.id);
  expect(store.getState().permissionStatus).toBe('ready');
});

it('ignores an old read after a successful grant update', async () => {
  store.setState({
    groups: [group],
    groupsLoaded: true,
    selectedApp: application,
  });
  const pending = deferred<{ success: true; data: (typeof grant)[] }>();
  call.mockReturnValueOnce(pending.promise);
  const older = store.getState().loadAppPermissions(application.id);
  call.mockResolvedValueOnce({ success: true, data: [grant] });
  await store.getState().loadAppPermissions(application.id);
  call.mockResolvedValueOnce({
    success: true,
    data: { ...grant, is_enabled: false },
  });
  call.mockResolvedValueOnce({
    success: true,
    data: [{ ...grant, is_enabled: false }],
  });
  expect(
    await store.getState().setGroupPermission(application.id, group.id, false)
  ).toBe(true);
  expect(call.mock.calls[2][1]).toEqual({
    groupId: group.id,
    serviceInstanceId: application.id,
    data: { is_enabled: false },
  });
  pending.resolve({ success: true, data: [grant] });
  await older;
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    false
  );
});

it('retains configured grants when changing visibility without calling cleanup', async () => {
  store.setState({
    selectedApp: application,
    groups: [group],
    groupsLoaded: true,
  });
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  call.mockResolvedValue({ success: true, data: [grant] });
  for (const visibility of ['private', 'public', 'group_only'] as const) {
    expect(
      await store.getState().updateAppVisibility(application.id, visibility)
    ).toBe(true);
    expect(store.getState().selectedApp?.visibility).toBe(visibility);
    expect(store.getState().selectedApp?.groupPermissions[0].usage_quota).toBe(
      0
    );
  }
  expect(
    call.mock.calls.every(
      ([action]) => action !== 'groups.removeAllGroupAppPermissions'
    )
  ).toBe(true);
});

it('keeps a successful visibility write when an older app-list read returns later', async () => {
  const pendingPatch = deferred<{
    ok: true;
    json: () => Promise<{ success: true }>;
  }>();
  const pendingApps = deferred<{
    ok: true;
    json: () => Promise<{
      success: true;
      apps: Array<{
        id: string;
        instance_id: string;
        visibility: 'public';
      }>;
    }>;
  }>();
  store.setState({
    apps: [application],
    selectedApp: application,
    groupsLoaded: true,
    permissionStatus: 'ready',
  });
  global.fetch = jest.fn((_input, init) =>
    init?.method === 'PATCH' ? pendingPatch.promise : pendingApps.promise
  ) as unknown as typeof fetch;

  const write = store.getState().updateAppVisibility(application.id, 'private');
  const olderRead = store.getState().loadApps();

  pendingPatch.resolve({
    ok: true,
    json: async () => ({ success: true }),
  });
  expect(await write).toBe(true);
  expect(store.getState().selectedApp?.visibility).toBe('private');

  pendingApps.resolve({
    ok: true,
    json: async () => ({
      success: true,
      apps: [
        {
          id: application.id,
          instance_id: application.instance_id,
          visibility: 'public',
        },
      ],
    }),
  });
  await olderRead;

  expect(store.getState().apps[0].visibility).toBe('private');
  expect(store.getState().selectedApp?.visibility).toBe('private');
});

it('keeps write success distinct from refresh failure', async () => {
  store.setState({
    selectedApp: application,
    groups: [group],
    groupsLoaded: true,
    permissionStatus: 'ready',
  });
  call.mockResolvedValueOnce({ success: true, data: grant });
  call.mockResolvedValueOnce({
    success: false,
    error: new Error('Refresh failed'),
  });
  expect(
    await store.getState().setGroupPermission(application.id, group.id, true)
  ).toBe(true);
  expect(store.getState().permissionStatus).toBe('error');
  expect(store.getState().permissionError).toBe('Refresh failed');
});

it('invalidates permission responses when the page resets', async () => {
  store.setState({
    selectedApp: application,
    groups: [group],
    groupsLoaded: true,
  });
  const pending = deferred<{ success: true; data: (typeof grant)[] }>();
  call.mockReturnValueOnce(pending.promise);
  const loading = store.getState().loadAppPermissions(application.id);
  store.getState().reset();
  pending.resolve({ success: true, data: [grant] });
  await loading;
  expect(store.getState().selectedApp).toBeNull();
  expect(store.getState().permissionStatus).toBe('idle');
});

it.each([true, false])(
  'does not let a former application write (%s) change the newly selected panel',
  async success => {
    const otherApplication = { ...application, id: 'app-b' };
    const pendingWrite = deferred<
      { success: true; data: typeof grant } | { success: false; error: Error }
    >();
    const pendingRead = deferred<{ success: true; data: (typeof grant)[] }>();
    store.setState({
      apps: [application, otherApplication],
      selectedApp: application,
      groups: [group],
      groupsLoaded: true,
      permissionStatus: 'ready',
    });
    call.mockReturnValueOnce(pendingWrite.promise);
    const writing = store
      .getState()
      .setGroupPermission(application.id, group.id, true);
    call.mockReturnValueOnce(pendingRead.promise);
    store.getState().selectApp(otherApplication);
    pendingWrite.resolve(
      success
        ? { success: true, data: grant }
        : {
            success: false,
            error: new Error('Former application write failed'),
          }
    );
    expect(await writing).toBe(success);
    expect(store.getState().permissionStatus).toBe('loading');
    expect(store.getState().loading.updating).toBe(false);
    pendingRead.resolve({
      success: true,
      data: [{ ...grant, service_instance_id: otherApplication.id }],
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().selectedApp?.id).toBe(otherApplication.id);
    expect(store.getState().permissionStatus).toBe('ready');
    expect(store.getState().permissionError).toBeNull();
  }
);

it('retains the group-load error when selecting an application and recovers on retry', async () => {
  call.mockResolvedValueOnce({
    success: false,
    error: new Error('Groups unavailable'),
  });
  await store.getState().loadGroups();
  store.getState().selectApp(application);
  expect(store.getState().permissionStatus).toBe('error');
  expect(store.getState().permissionError).toBe('Groups unavailable');
  call.mockResolvedValueOnce({ success: true, data: [group] });
  call.mockResolvedValueOnce({ success: true, data: [grant] });
  await store.getState().loadGroups();
  expect(store.getState().permissionStatus).toBe('ready');
});

it('refreshes a successful write after switching away and back to its application', async () => {
  const pendingWrite = deferred<{ success: true; data: typeof grant }>();
  const otherApplication = { ...application, id: 'app-b' };
  store.setState({
    selectedApp: application,
    groups: [group],
    groupsLoaded: true,
    permissionStatus: 'ready',
  });
  call.mockReturnValueOnce(pendingWrite.promise);
  const writing = store
    .getState()
    .setGroupPermission(application.id, group.id, false);
  call.mockResolvedValue({ success: true, data: [grant] });
  store.getState().selectApp(otherApplication);
  store.getState().selectApp(application);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    true
  );
  call.mockResolvedValueOnce({
    success: true,
    data: [{ ...grant, is_enabled: false }],
  });
  pendingWrite.resolve({
    success: true,
    data: { ...grant, is_enabled: false },
  });
  expect(await writing).toBe(true);
  expect(store.getState().permissionStatus).toBe('ready');
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    false
  );
});

it('does not let a pre-reset write release a new pending write or overwrite its state', async () => {
  const oldWrite = deferred<{ success: false; error: Error }>();
  const newWrite = deferred<{ success: true; data: typeof grant }>();
  const readyState = {
    selectedApp: application,
    groups: [group],
    groupsLoaded: true,
    permissionStatus: 'ready' as const,
  };
  store.setState(readyState);
  call.mockReturnValueOnce(oldWrite.promise);
  const oldOperation = store
    .getState()
    .setGroupPermission(application.id, group.id, false);
  store.getState().reset();
  store.setState(readyState);
  call.mockReturnValueOnce(newWrite.promise);
  const newOperation = store
    .getState()
    .setGroupPermission(application.id, group.id, true);
  oldWrite.resolve({ success: false, error: new Error('Old request failed') });
  expect(await oldOperation).toBe(false);
  expect(store.getState().loading.updating).toBe(true);
  expect(store.getState().permissionStatus).toBe('ready');
  call.mockResolvedValueOnce({ success: true, data: [grant] });
  newWrite.resolve({ success: true, data: grant });
  expect(await newOperation).toBe(true);
  expect(store.getState().permissionStatus).toBe('ready');
  expect(store.getState().loading.updating).toBe(false);
});

it('retains confirmed grants during a write and its refresh, while blocking duplicate writes', async () => {
  const confirmedApp = {
    ...application,
    groupPermissions: [
      {
        group_id: group.id,
        group_name: group.name,
        is_enabled: true,
        usage_quota: 10,
      },
    ],
  };
  const write = deferred<{ success: true; data: typeof grant }>();
  const refresh = deferred<{ success: true; data: (typeof grant)[] }>();
  store.setState({
    apps: [confirmedApp],
    selectedApp: confirmedApp,
    groups: [group],
    groupsLoaded: true,
    permissionStatus: 'ready',
  });
  call.mockReturnValueOnce(write.promise).mockReturnValueOnce(refresh.promise);
  const operation = store
    .getState()
    .setGroupPermission(application.id, group.id, false);
  expect(store.getState().permissionStatus).toBe('ready');
  expect(store.getState().selectedApp?.groupPermissions).toBe(
    confirmedApp.groupPermissions
  );
  expect(
    await store.getState().setGroupPermission(application.id, group.id, false)
  ).toBe(false);
  expect(call).toHaveBeenCalledTimes(1);

  write.resolve({ success: true, data: { ...grant, is_enabled: false } });
  await Promise.resolve();
  await Promise.resolve();
  expect(call).toHaveBeenCalledTimes(2);
  expect(store.getState().permissionStatus).toBe('ready');
  expect(store.getState().loading.updating).toBe(true);
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    true
  );
  refresh.resolve({ success: true, data: [{ ...grant, is_enabled: false }] });
  expect(await operation).toBe(true);
  expect(store.getState().selectedApp?.groupPermissions[0].is_enabled).toBe(
    false
  );
  expect(store.getState().loading.updating).toBe(false);
});

it('retains confirmed grants and offers retry when a write fails', async () => {
  const confirmedApp = {
    ...application,
    groupPermissions: [
      {
        group_id: group.id,
        group_name: group.name,
        is_enabled: true,
        usage_quota: 10,
      },
    ],
  };
  store.setState({
    selectedApp: confirmedApp,
    groups: [group],
    groupsLoaded: true,
    permissionStatus: 'ready',
  });
  call.mockResolvedValueOnce({
    success: false,
    error: new Error('Write failed'),
  });
  expect(
    await store.getState().setGroupPermission(application.id, group.id, false)
  ).toBe(false);
  expect(store.getState().permissionStatus).toBe('error');
  expect(store.getState().permissionError).toBe('Write failed');
  expect(store.getState().selectedApp?.groupPermissions).toBe(
    confirmedApp.groupPermissions
  );
  expect(store.getState().loading.updating).toBe(false);
  call.mockResolvedValueOnce({ success: true, data: [grant] });
  await store.getState().loadAppPermissions(application.id);
  expect(store.getState().permissionStatus).toBe('ready');
});
