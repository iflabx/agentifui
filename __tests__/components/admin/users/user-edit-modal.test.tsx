import { UserEditModal } from '@components/admin/users/user-edit-modal';
import type { EnhancedUser } from '@lib/db/users';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const baseUser: EnhancedUser = {
  id: 'user-1',
  email: 'user@example.com',
  full_name: 'Before',
  role: 'user',
  status: 'active',
  auth_source: 'better-auth',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  profile_created_at: '2026-01-01T00:00:00Z',
  profile_updated_at: '2026-01-01T00:00:00Z',
};

function modalProps(user: EnhancedUser = baseUser) {
  return {
    isOpen: true,
    user,
    isLoading: false,
    isSubmitting: false,
    canEditRoleStatus: true,
    currentUserId: 'admin-1',
    onClose: jest.fn(),
    onSave: jest.fn().mockResolvedValue(true),
  };
}

describe('user profile editing and read-only details', () => {
  it('renders details without any editable controls or submit action', () => {
    const props = modalProps();
    render(<UserEditModal {...props} readOnly />);
    expect(screen.getByText('actions.viewUser')).toBeInTheDocument();
    for (const input of screen.getAllByRole('textbox'))
      expect(input).toBeDisabled();
    for (const select of screen.getAllByRole('combobox'))
      expect(select).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'actions.save' })
    ).not.toBeInTheDocument();
    fireEvent.submit(screen.getByDisplayValue('Before').closest('form')!);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it.each(['better-auth', 'github'])(
    'keeps %s email read-only and excludes it even from stale editable field metadata',
    async authSource => {
      const props = modalProps({
        ...baseUser,
        auth_source: authSource,
        editable_fields: ['full_name', 'email'],
      });
      render(<UserEditModal {...props} />);
      const email = screen.getByDisplayValue(baseUser.email!);
      expect(email).toBeDisabled();
      expect(screen.getByText('readonly.emailHint')).toBeInTheDocument();
      fireEvent.change(email, { target: { value: 'unverified@example.com' } });
      fireEvent.change(screen.getByDisplayValue('Before'), {
        target: { value: 'After' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith({ full_name: 'After' })
      );
    }
  );

  it('respects an explicitly empty editable field list', () => {
    const props = modalProps({ ...baseUser, editable_fields: [] });
    render(<UserEditModal {...props} />);
    expect(screen.getByDisplayValue('Before')).toBeDisabled();
  });

  it('blocks own role changes and non-active statuses, but allows ordinary profile saves', async () => {
    const props = modalProps({ ...baseUser, id: 'admin-1', role: 'admin' });
    render(<UserEditModal {...props} />);
    expect(
      screen.getByRole('combobox', { name: 'fields.role' })
    ).toBeDisabled();
    expect(
      screen.getByRole('option', { name: 'options.status.suspended' })
    ).toBeDisabled();
    expect(
      screen.getByRole('option', { name: 'options.status.pending' })
    ).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue('Before'), {
      target: { value: 'After' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith({ full_name: 'After' })
    );
  });

  it('keeps another administrator role protected without blocking status or profile editing', () => {
    render(
      <UserEditModal
        {...modalProps({ ...baseUser, id: 'admin-2', role: 'admin' })}
      />
    );
    expect(
      screen.getByRole('combobox', { name: 'fields.role' })
    ).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: 'fields.status' })
    ).not.toBeDisabled();
    expect(screen.getByDisplayValue('Before')).not.toBeDisabled();
  });

  it('allows an unchanged self-admin form to close without sending a forbidden role update', () => {
    const props = modalProps({ ...baseUser, id: 'admin-1', role: 'admin' });
    render(<UserEditModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close after an unsuccessful save', async () => {
    const props = modalProps();
    props.onSave.mockResolvedValue(false);
    render(<UserEditModal {...props} />);
    fireEvent.change(screen.getByDisplayValue('Before'), {
      target: { value: 'After' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
