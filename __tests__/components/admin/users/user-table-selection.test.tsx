import { UserTable } from '@components/admin/users/user-table';
import type { EnhancedUser } from '@lib/db/users';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
jest.mock('@lib/hooks/use-profile', () => ({
  useProfile: () => ({ profile: { id: 'admin-1', role: 'admin' } }),
}));
jest.mock('@lib/hooks/use-date-formatter', () => ({
  useDateFormatter: () => ({ formatDate: () => '-' }),
}));
jest.mock('@components/ui', () => ({ ConfirmDialog: () => null }));
jest.mock('@components/admin/users/user-table/user-row', () => ({
  UserTableRow: () => null,
}));

const users: EnhancedUser[] = ['user-1', 'user-2'].map(id => ({
  id,
  role: 'user',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  profile_created_at: '2026-01-01T00:00:00Z',
  profile_updated_at: '2026-01-01T00:00:00Z',
}));

describe('current page select-all', () => {
  it.each([
    { selected: ['other-1', 'other-2'], shouldSelect: true },
    { selected: ['user-1', 'other-2'], shouldSelect: true },
    { selected: ['user-1', 'user-2'], shouldSelect: false },
    { selected: ['user-1', 'user-2', 'other'], shouldSelect: false },
  ])(
    'compares IDs rather than counts: $selected',
    ({ selected, shouldSelect }) => {
      const onSelectAll = jest.fn();
      render(
        <UserTable
          users={users}
          selectedUserIds={selected}
          isLoading={false}
          onSelectUser={jest.fn()}
          onSelectAll={onSelectAll}
          onEditUser={jest.fn()}
          onViewUser={jest.fn()}
          onDeleteUser={jest.fn()}
          onChangeRole={jest.fn()}
          onChangeStatus={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole('button'));
      expect(onSelectAll).toHaveBeenCalledWith(shouldSelect);
    }
  );
});
