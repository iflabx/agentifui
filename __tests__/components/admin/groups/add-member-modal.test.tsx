import { AddMemberModal } from '@components/admin/groups/group-members-modal/add-member-modal';
import { useGroupManagementStore } from '@lib/stores/group-management-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { toast } from 'sonner';

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
  name: 'Test group',
  description: null,
  created_by: 'admin',
  created_at: '2026-11-20T00:00:00Z',
};
const namespace = 'pages.admin.groups.addMembersModal';

function user(id: string) {
  return { id, username: id, full_name: null, email: null, role: 'user' };
}

function membership(userId: string) {
  return {
    id: `membership-${userId}`,
    group_id: group.id,
    user_id: userId,
    created_at: group.created_at,
  };
}

function response(ids: string[], page = 1, total = ids.length): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      users: ids.map(user),
      page,
      pageSize: 10,
      total,
      totalPages: Math.ceil(total / 10),
    }),
  } as Response;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function search(value: string) {
  fireEvent.change(
    screen.getByPlaceholderText(`${namespace}.searchPlaceholder`),
    { target: { value } }
  );
}

function submittedBody() {
  const calls = jest.mocked(fetch).mock.calls;
  return JSON.parse(calls[calls.length - 1][1]!.body as string);
}

beforeEach(() => {
  jest.mocked(fetch).mockReset();
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
  useGroupManagementStore.setState({
    groupMembers: { [group.id]: [membership('existing')] },
    loadGroupMembers: jest.fn().mockResolvedValue(true),
    addMember: jest.fn().mockResolvedValue(true),
  });
});

afterEach(() => {
  useGroupManagementStore.setState(
    useGroupManagementStore.getInitialState(),
    true
  );
});

describe('current-page member selection', () => {
  it('clears page selection and only submits current-page IDs', async () => {
    const first = Array.from({ length: 10 }, (_, index) => `first-${index}`);
    const second = Array.from({ length: 10 }, (_, index) => `second-${index}`);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response(first, 1, 20))
      .mockResolvedValueOnce(response(second, 2, 20))
      .mockResolvedValueOnce(response(second.slice(1), 2, 9))
      .mockResolvedValueOnce(response(second.slice(1), 1, 9));
    const addMember = jest.fn().mockResolvedValue(true);
    useGroupManagementStore.setState({ addMember });
    render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${namespace}.selectAll` })
    );
    expect(
      screen.getByRole('button', { name: `${namespace}.deselectAll` })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.pagination.next` })
    );

    expect(
      await screen.findByRole('button', { name: 'second-0' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: `${namespace}.selectAll` })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.queryByRole('button', { name: `${namespace}.addSelected` })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.selectAll` })
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.deselectAll` })
    );
    expect(screen.getByRole('button', { name: 'second-0' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'second-0' }));
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.addSelected` })
    );
    await waitFor(() => expect(addMember).toHaveBeenCalledTimes(1));
    expect(addMember).toHaveBeenCalledWith(group.id, 'second-0');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'second-1' })).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: 'second-0' })
      ).not.toBeInTheDocument();
    });
    expect(submittedBody().page).toBe(1);
  });

  it('clears selection on search and resets the request to page one', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response(['alice'], 1, 11))
      .mockResolvedValueOnce(response(['bob'], 2, 11))
      .mockResolvedValueOnce(response(['searched']));
    render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
    await screen.findByRole('button', { name: 'alice' });
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.pagination.next` })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'bob' }));
    search('searched');
    expect(
      screen.queryByRole('button', { name: `${namespace}.addSelected` })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'searched' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(submittedBody()).toMatchObject({ page: 1, search: 'searched' });
  });
});

describe('candidate request ownership', () => {
  it.each(['success', 'failure'])(
    'ignores an older %s after the latest search succeeds',
    async outcome => {
      const oldRequest = deferred<Response>();
      const latestRequest = deferred<Response>();
      jest
        .mocked(fetch)
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(latestRequest.promise);
      render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
      search('latest');
      await act(async () => latestRequest.resolve(response(['latest'], 1, 21)));
      await act(async () => {
        if (outcome === 'success') oldRequest.resolve(response(['obsolete']));
        else oldRequest.reject(new Error('Obsolete failure'));
      });
      expect(
        screen.getByRole('button', { name: 'latest' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'obsolete' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `${namespace}.pagination.next` })
      ).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it.each(['success', 'failure'])(
    'keeps the latest request loading after an obsolete %s',
    async outcome => {
      const oldRequest = deferred<Response>();
      const latestRequest = deferred<Response>();
      jest
        .mocked(fetch)
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(latestRequest.promise);
      render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
      search('latest');
      await act(async () => {
        if (outcome === 'success') oldRequest.resolve(response(['obsolete']));
        else oldRequest.reject(new Error('Old request failed'));
      });
      expect(screen.getByText(`${namespace}.loading`)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => latestRequest.resolve(response(['latest'])));
      expect(
        screen.getByRole('button', { name: 'latest' })
      ).toBeInTheDocument();
    }
  );

  it('does not let an old success hide the latest failure', async () => {
    const oldRequest = deferred<Response>();
    const latestRequest = deferred<Response>();
    jest
      .mocked(fetch)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(latestRequest.promise);
    render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
    search('latest');
    await act(async () => {
      latestRequest.reject(new Error('Latest request failed'));
    });
    await act(async () => oldRequest.resolve(response(['obsolete'])));
    expect(screen.getByRole('alert')).toHaveTextContent(
      `${namespace}.loadError`
    );
    expect(screen.queryByText(`${namespace}.noUsers`)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'obsolete' })
    ).not.toBeInTheDocument();
  });

  it('invalidates requests on close and reopen', async () => {
    const oldRequest = deferred<Response>();
    const reopenedRequest = deferred<Response>();
    jest
      .mocked(fetch)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(reopenedRequest.promise);
    const onClose = jest.fn();
    const { rerender } = render(
      <AddMemberModal group={group} isOpen onClose={onClose} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'common.ui.dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<AddMemberModal group={group} isOpen={false} onClose={onClose} />);
    rerender(<AddMemberModal group={group} isOpen onClose={onClose} />);
    await act(async () => oldRequest.resolve(response(['obsolete'])));
    expect(screen.getByText(`${namespace}.loading`)).toBeInTheDocument();
    await act(async () => reopenedRequest.resolve(response(['reopened'])));
    expect(
      screen.getByRole('button', { name: 'reopened' })
    ).toBeInTheDocument();
  });

  it('invalidates requests when switching the target group', async () => {
    const oldRequest = deferred<Response>();
    const nextRequest = deferred<Response>();
    jest
      .mocked(fetch)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(nextRequest.promise);
    const { rerender } = render(
      <AddMemberModal group={group} isOpen onClose={jest.fn()} />
    );
    rerender(
      <AddMemberModal
        group={{ ...group, id: 'other' }}
        isOpen
        onClose={jest.fn()}
      />
    );
    await act(async () => nextRequest.resolve(response(['other-group-user'])));
    await act(async () => oldRequest.resolve(response(['obsolete'])));
    expect(
      screen.getByRole('button', { name: 'other-group-user' })
    ).toBeInTheDocument();
    expect(submittedBody().excludeUserIds).toEqual([]);
  });
});

describe('post-add refresh', () => {
  it('uses fresh exclusions across partial success and two batches', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response(['alice', 'bob']))
      .mockResolvedValueOnce(response(['bob']))
      .mockResolvedValueOnce(response([]));
    let bobAttempts = 0;
    const addMember = jest.fn(async (_groupId: string, userId: string) => {
      if (userId === 'bob' && bobAttempts++ === 0) return false;
      const current = useGroupManagementStore.getState().groupMembers[group.id];
      useGroupManagementStore.setState({
        groupMembers: { [group.id]: [...current, membership(userId)] },
      });
      return true;
    });
    useGroupManagementStore.setState({ addMember });
    render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
    fireEvent.click(
      await screen.findByRole('button', { name: `${namespace}.selectAll` })
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.addSelected` })
    );
    await screen.findByRole('button', { name: 'bob' });
    await waitFor(() => {
      expect(submittedBody().excludeUserIds).toEqual(['existing', 'alice']);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'alice' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'bob' })).toBeEnabled();
    });
    expect(toast.error).toHaveBeenCalledWith(`${namespace}.addPartialSuccess`);

    fireEvent.click(screen.getByRole('button', { name: 'bob' }));
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.addSelected` })
    );
    await screen.findByText(`${namespace}.noUsers`);
    expect(submittedBody().excludeUserIds).toEqual([
      'existing',
      'alice',
      'bob',
    ]);
    expect(addMember.mock.calls).toEqual([
      [group.id, 'alice'],
      [group.id, 'bob'],
      [group.id, 'bob'],
    ]);
  });

  it.each(['members', 'candidates'])(
    'shows a retryable error after a failed %s refresh',
    async failureStage => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(response(['alice']))
        .mockResolvedValueOnce({ ok: false } as Response)
        .mockResolvedValueOnce(response([]));
      const reload = jest.fn().mockResolvedValue(true);
      if (failureStage === 'members') reload.mockResolvedValueOnce(false);
      const addMember = jest.fn(async () => {
        useGroupManagementStore.setState({
          groupMembers: {
            [group.id]: [membership('existing'), membership('alice')],
          },
        });
        return true;
      });
      useGroupManagementStore.setState({ addMember, loadGroupMembers: reload });
      render(<AddMemberModal group={group} isOpen onClose={jest.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'alice' }));
      fireEvent.click(
        screen.getByRole('button', { name: `${namespace}.addSelected` })
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `${namespace}.refreshError`
      );
      expect(
        screen.queryByText(`${namespace}.noUsers`)
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `${namespace}.addSelected` })
      ).not.toBeInTheDocument();
      if (failureStage === 'members') {
        expect(fetch).toHaveBeenCalledTimes(1);
        jest.mocked(fetch).mockReset().mockResolvedValueOnce(response([]));
      }
      fireEvent.click(screen.getByRole('button', { name: 'common.ui.retry' }));
      await screen.findByText(`${namespace}.noUsers`);
      expect(addMember).toHaveBeenCalledTimes(1);
      expect(submittedBody().excludeUserIds).toEqual(['existing', 'alice']);
    }
  );

  it('stops a batch when closed during an add', async () => {
    const writing = deferred<boolean>();
    const addMember = jest.fn().mockReturnValue(writing.promise);
    useGroupManagementStore.setState({ addMember });
    jest.mocked(fetch).mockResolvedValueOnce(response(['alice', 'bob']));
    const onClose = jest.fn();
    const { unmount } = render(
      <AddMemberModal group={group} isOpen onClose={onClose} />
    );
    fireEvent.click(
      await screen.findByRole('button', { name: `${namespace}.selectAll` })
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${namespace}.addSelected` })
    );
    fireEvent.click(screen.getByRole('button', { name: 'common.ui.dismiss' }));
    unmount();
    await act(async () => writing.resolve(true));
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
