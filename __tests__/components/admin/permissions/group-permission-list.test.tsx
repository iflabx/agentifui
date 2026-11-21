import { GroupPermissionList } from '@components/admin/permissions/group-permission-list';
import {
  type AppWithPermissions,
  usePermissionManagementStore as store,
} from '@lib/stores/permission-management-store';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@lib/hooks/use-theme', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
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

it('toggles known access without passing a quota change', () => {
  const toggle = jest.fn().mockResolvedValue(false);
  const spy = jest
    .spyOn(store.getState(), 'setGroupPermission')
    .mockImplementation(toggle);
  store.setState({ permissionStatus: 'ready' });
  render(<GroupPermissionList app={application} />);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('switch'));
  expect(toggle).toHaveBeenCalledWith(application.id, 'group-a', false);
  spy.mockRestore();
});
