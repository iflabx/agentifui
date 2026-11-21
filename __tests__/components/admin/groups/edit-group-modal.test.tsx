import { EditGroupModal } from '@components/admin/groups/edit-group-modal';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@lib/hooks/use-theme', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const group = {
  id: 'group',
  name: 'Group name',
  description: 'Old description',
  created_by: 'admin',
  created_at: '2026-11-20T00:00:00Z',
};

beforeEach(() => {
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
});

afterEach(() => {
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
});

it.each([
  ['', ''],
  ['   ', ''],
  ['  New description  ', 'New description'],
])('submits description %j explicitly as %j', async (input, expected) => {
  const updateGroup = jest.fn().mockResolvedValue(true);
  const onClose = jest.fn();
  useGroupManagementStore.setState({ updateGroup });
  const { container } = render(
    <EditGroupModal group={group} isOpen onClose={onClose} />
  );
  fireEvent.change(
    screen.getByPlaceholderText(
      'pages.admin.groups.editModal.descriptionPlaceholder'
    ),
    { target: { value: input } }
  );
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(updateGroup).toHaveBeenCalledWith(group.id, {
    name: group.name,
    description: expected,
  });
  expect(
    JSON.parse(JSON.stringify(updateGroup.mock.calls[0][1]))
  ).toHaveProperty('description', expected);
});
