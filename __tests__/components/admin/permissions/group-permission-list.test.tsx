import { GroupPermissionList } from '@components/admin/permissions/group-permission-list';
import {
  type AppWithPermissions,
  usePermissionManagementStore as store,
} from '@lib/stores/permission-management-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

jest.mock('@lib/hooks/use-theme', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${Object.values(values).join(' ')}` : key,
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), warning: jest.fn() },
}));

const application = {
  id: 'app-a',
  groupPermissions: [
    {
      group_id: 'group-a',
      group_name: 'Example',
      is_enabled: true,
      usage_quota: 10,
    },
  ],
} as unknown as AppWithPermissions;

beforeEach(() => {
  store.getState().reset();
  store.setState({
    selectedApp: application,
    groups: [
      {
        id: 'group-a',
        name: 'Example',
        description: null,
        created_by: '',
        created_at: '',
      },
    ],
    groupsLoaded: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('does not display a disabled access switch before permissions are known', () => {
  store.setState({ permissionStatus: 'loading' });
  render(<GroupPermissionList app={application} />);
  expect(screen.getByRole('status')).toHaveTextContent('loading');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it('shows a failed permission read and offers a retry without an access switch', () => {
  const retry = jest.fn();
  const spy = jest
    .spyOn(store.getState(), 'loadAppPermissions')
    .mockImplementation(retry);
  store.setState({ permissionStatus: 'error', permissionError: 'Read failed' });
  render(<GroupPermissionList app={application} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Read failed');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('retry'));
  expect(retry).toHaveBeenCalledWith(application.id);
  spy.mockRestore();
});

it('toggles known access without passing a quota change', async () => {
  const toggle = jest.fn().mockResolvedValue(false);
  const spy = jest
    .spyOn(store.getState(), 'setGroupPermission')
    .mockImplementation(toggle);
  store.setState({ permissionStatus: 'ready' });
  render(<GroupPermissionList app={application} />);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('switch'));
  expect(toggle).toHaveBeenCalledWith(application.id, 'group-a', false);
  await waitFor(() =>
    expect(screen.getByRole('switch')).toHaveAttribute('aria-busy', 'false')
  );
  spy.mockRestore();
});

function prepareManyGroups() {
  const groups = Array.from({ length: 48 }, (_, index) => ({
    id: `group-${index}`,
    name: `Team ${String(index).padStart(2, '0')}`,
    description: index === 47 ? 'Research department' : null,
    member_count: index,
    created_by: '',
    created_at: '',
  }));
  const app = {
    ...application,
    groupPermissions: groups.map((group, index) => ({
      group_id: group.id,
      group_name: group.name,
      is_enabled: index < 12,
      usage_quota: null,
    })),
  };
  store.setState({ groups, selectedApp: app, permissionStatus: 'ready' });
  return app;
}

it('shows counts and combines access filtering with name or description search', () => {
  const app = prepareManyGroups();
  render(<GroupPermissionList app={app} />);
  expect(screen.getAllByRole('switch')).toHaveLength(48);
  expect(screen.getByText(/summary 48 12/)).toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'enabled' },
  });
  expect(screen.getAllByRole('switch')).toHaveLength(12);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: ' team 01 ' },
  });
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(screen.getByRole('switch')).toHaveAccessibleName(
    'Team 01: actions.disable'
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'RESEARCH' },
  });
  expect(screen.getByText('noMatches')).toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'disabled' },
  });
  expect(screen.getByRole('switch')).toHaveAccessibleName(
    'Team 47: actions.enable'
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(screen.getAllByRole('switch')).toHaveLength(36);
});

it('keeps every row and its confirmed value while only the saved row shows progress', async () => {
  const app = prepareManyGroups();
  let complete!: (success: boolean) => void;
  const pending = new Promise<boolean>(resolve => {
    complete = resolve;
  });
  const toggle = jest
    .spyOn(store.getState(), 'setGroupPermission')
    .mockImplementation(async () => {
      store.setState({
        loading: { ...store.getState().loading, updating: true },
      });
      const success = await pending;
      store.setState({
        loading: { ...store.getState().loading, updating: false },
      });
      return success;
    });
  render(<GroupPermissionList app={app} />);
  const switches = screen.getAllByRole('switch');
  fireEvent.click(switches[0]);
  expect(screen.getByRole('status')).toHaveTextContent('saving');
  expect(screen.getAllByRole('switch')).toHaveLength(48);
  expect(switches[0]).toHaveAttribute('aria-checked', 'true');
  expect(switches[0]).toHaveAttribute('aria-busy', 'true');
  expect(switches[1]).toHaveAttribute('aria-busy', 'false');
  switches.forEach(control => expect(control).toBeDisabled());
  fireEvent.click(switches[1]);
  expect(toggle).toHaveBeenCalledTimes(1);
  await act(async () => complete(false));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getAllByRole('switch')[0]).toBe(switches[0]);
  expect(switches[0]).toBeEnabled();
  expect(switches[0]).toHaveAttribute('aria-checked', 'true');
});

it('preserves row order when access changes in the all-groups view', () => {
  const app = prepareManyGroups();
  const { rerender } = render(<GroupPermissionList app={app} />);
  const controls = screen.getAllByRole('switch');
  const updatedApp = {
    ...app,
    groupPermissions: app.groupPermissions.map(permission => ({
      ...permission,
      is_enabled: !permission.is_enabled,
    })),
  };
  rerender(<GroupPermissionList app={updatedApp} />);
  expect(screen.getAllByRole('switch')).toEqual(controls);
  expect(controls[0]).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText(/summary 48 36/)).toBeInTheDocument();
});
