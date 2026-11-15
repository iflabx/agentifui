import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { callInternalDataAction } from '@lib/db/internal-data-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import type { Conversation } from '@lib/types/database';
import { success } from '@lib/types/result';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAllConversations } from './use-all-conversations';
import { useCombinedConversations } from './use-combined-conversations';
import { useSidebarConversations } from './use-sidebar-conversations';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({ loading: false }),
}));
jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function conversation(id: string, userId = 'first-user'): Conversation {
  return {
    id,
    user_id: userId,
    title: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as Conversation;
}
const listResult = (items: Conversation[]) =>
  success({ conversations: items, total: items.length });

it('discards an old list when the session endpoint observes a new login of the same user', async () => {
  const user = { id: '00000000-0000-4000-8000-000000000100' };
  const session = (id: string) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ user, session: { id } }),
    }) as Response;
  jest.mocked(fetch).mockResolvedValueOnce(session('first-login'));
  await getCurrentSession({ forceRefresh: true });
  const old = deferred<ReturnType<typeof listResult>>();
  jest
    .mocked(callInternalDataAction)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(listResult([]));
  const { result } = renderHook(() => useAllConversations());
  jest.mocked(fetch).mockResolvedValueOnce(session('second-login'));
  await act(async () => {
    await getCurrentSession({ forceRefresh: true });
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () =>
    old.resolve(listResult([conversation('private old title', user.id)]))
  );
  expect(result.current.conversations).toEqual([]);
});

it('does not revive a persisted pending entry after deleting the actual conversation', async () => {
  let items = [conversation('database')];
  items[0].external_id = 'external';
  jest.mocked(callInternalDataAction).mockImplementation(async action => {
    if (action === 'conversations.deleteConversation') {
      items = [];
      return success(true);
    }
    return listResult(items);
  });
  const store = usePendingConversationStore.getState();
  store.addPending('temp');
  store.setRealIdAndStatus('temp', 'external', 'title_resolved');
  store.markAsPersistedComplete('temp', 'database');
  const { result } = renderHook(() => ({
    list: useAllConversations(),
    combined: useCombinedConversations(),
  }));
  await waitFor(() =>
    expect(result.current.combined.conversations[0]?.db_pk).toBe('database')
  );
  await act(async () => {
    expect(await result.current.list.deleteConversation('database')).toBe(true);
  });
  act(() => result.current.combined.refresh());
  await waitFor(() => expect(result.current.combined.isLoading).toBe(false));
  expect(result.current.combined.conversations).toEqual([]);
  expect(usePendingConversationStore.getState().pendingConversations.size).toBe(
    0
  );
});

beforeEach(() => {
  jest.resetAllMocks();
  syncChatDraftActor(null);
  syncChatDraftActor('first-user');
});

describe.each([
  ['sidebar', useSidebarConversations, 20],
  ['history', useAllConversations, 1000],
] as const)('%s conversation identity', (_name, useList, limit) => {
  it('immediately hides previous data on switch and accepts an empty new account', async () => {
    const next = deferred<ReturnType<typeof listResult>>();
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(listResult([conversation('private-title')]))
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useList());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(callInternalDataAction).toHaveBeenCalledWith(
      'conversations.getUserConversations',
      { userId: 'first-user', limit, offset: 0 }
    );
    act(() => syncChatDraftActor('second-user'));
    expect(result.current.conversations).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(true);
    await act(async () => next.resolve(listResult([])));
    expect(result.current.conversations).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a late old-account %s including error and loading updates',
    async completion => {
      const old = deferred<ReturnType<typeof listResult>>();
      const next = deferred<ReturnType<typeof listResult>>();
      jest
        .mocked(callInternalDataAction)
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(next.promise);
      const { result } = renderHook(() => useList());
      act(() => syncChatDraftActor('second-user'));
      await act(async () => {
        if (completion === 'resolve')
          old.resolve(listResult([conversation('old')]));
        else old.reject(new Error('Old account failure'));
      });
      expect(result.current.conversations).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(true);
      await act(async () =>
        next.resolve(listResult([conversation('new', 'second-user')]))
      );
      expect(result.current.conversations.map(item => item.id)).toEqual([
        'new',
      ]);
    }
  );

  it('rejects a late response from an earlier login of the same account', async () => {
    const old = deferred<ReturnType<typeof listResult>>();
    jest
      .mocked(callInternalDataAction)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(listResult([]));
    const { result } = renderHook(() => useList());
    act(() => {
      syncChatDraftActor(null);
      syncChatDraftActor('first-user');
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => old.resolve(listResult([conversation('old-login')])));
    expect(result.current.conversations).toEqual([]);
  });

  it('retains same-account content during refresh and applies only the latest query', async () => {
    const old = deferred<ReturnType<typeof listResult>>();
    const latest = deferred<ReturnType<typeof listResult>>();
    jest
      .mocked(callInternalDataAction)
      .mockResolvedValueOnce(listResult([conversation('initial')]))
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useList());
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    let oldRefresh!: Promise<void>;
    let newRefresh!: Promise<void>;
    act(() => {
      oldRefresh = result.current.refresh();
    });
    expect(result.current.conversations[0].id).toBe('initial');
    act(() => {
      newRefresh = result.current.refresh();
    });
    await act(async () => {
      latest.resolve(listResult([]));
      await newRefresh;
    });
    await act(async () => {
      old.resolve(listResult([conversation('stale')]));
      await oldRefresh;
    });
    expect(result.current.conversations).toEqual([]);
  });

  it.each(['delete', 'rename'] as const)(
    'does not apply a late %s to another account',
    async operation => {
      const mutation = deferred<ReturnType<typeof success<boolean>>>();
      jest
        .mocked(callInternalDataAction)
        .mockResolvedValueOnce(listResult([conversation('shared-id')]))
        .mockReturnValueOnce(mutation.promise)
        .mockResolvedValueOnce(
          listResult([conversation('shared-id', 'second-user')])
        );
      const { result } = renderHook(() => useList());
      await waitFor(() => expect(result.current.conversations).toHaveLength(1));
      const pending =
        operation === 'delete'
          ? result.current.deleteConversation('shared-id')
          : result.current.renameConversation(
              'shared-id',
              'Old account rename'
            );
      act(() => syncChatDraftActor('second-user'));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        mutation.resolve(success(true));
        expect(await pending).toBe(false);
      });
      expect(result.current.conversations[0]).toMatchObject({
        user_id: 'second-user',
        title: 'shared-id',
      });
      expect(result.current.total).toBe(1);
    }
  );
});

it('never revives cached or pending conversations after switching or deleting the last item', async () => {
  jest
    .mocked(callInternalDataAction)
    .mockResolvedValueOnce(listResult([conversation('private-title')]))
    .mockResolvedValueOnce(listResult([]))
    .mockResolvedValueOnce(listResult([conversation('new', 'second-user')]))
    .mockResolvedValueOnce(listResult([]));
  const { result } = renderHook(() => useCombinedConversations());
  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  act(() =>
    usePendingConversationStore
      .getState()
      .addPending('old-draft', 'Private draft')
  );
  expect(result.current.conversations).toHaveLength(2);
  act(() => syncChatDraftActor('second-user'));
  expect(result.current.conversations).toEqual([]);
  expect(usePendingConversationStore.getState().pendingConversations.size).toBe(
    0
  );
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.conversations).toEqual([]);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.conversations).toHaveLength(1));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.conversations).toEqual([]);
  act(() => syncChatDraftActor(null));
  expect(result.current.conversations).toEqual([]);
});
