import { captureDifyInputSubmission } from '@components/chat-input/submission';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  bindChatInputConversation,
  registerChatInputSubmission,
  useChatInputRouteSync,
} from './use-chat-input-route-sync';

let mockPathname = '/apps/chatbot/app-A';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@lib/services/client/conversations-api', () => ({
  getConversationByExternalId: jest.fn(),
}));

describe('input route scope synchronization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/apps/chatbot/app-A';
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().clearAllMessages();
    useAttachmentStore.getState().resetAll();
  });

  it('restores separate application drafts without moving uploaded handles', () => {
    const { rerender } = renderHook(
      ({ appId }) => useChatInputRouteSync({ userId: 'actor', appId }),
      { initialProps: { appId: 'app-A' } }
    );
    act(() => {
      useChatInputStore.getState().setMessage('A text');
      useAttachmentStore.getState().addFiles([new File(['A'], 'a.txt')]);
    });
    const originalScope = useChatInputStore.getState().currentRoute;
    mockPathname = '/apps/chatbot/app-B';
    rerender({ appId: 'app-B' });
    expect(useChatInputStore.getState().message).toBe('');
    expect(useAttachmentStore.getState().files).toEqual([]);
    act(() => useChatInputStore.getState().setMessage('B text'));
    mockPathname = '/apps/chatbot/app-A';
    rerender({ appId: 'app-A' });
    expect(useChatInputStore.getState().currentRoute).toBe(originalScope);
    expect(useChatInputStore.getState().message).toBe('A text');
    expect(useAttachmentStore.getState().files).toHaveLength(1);
  });

  it('restores text and uploaded attachments on /chat/new across model A -> B -> A', () => {
    mockPathname = '/chat/new';
    const { rerender } = renderHook(
      ({ appId }) => useChatInputRouteSync({ userId: 'actor', appId }),
      { initialProps: { appId: 'app-A' } }
    );
    act(() => {
      useChatInputStore.getState().setMessage('A draft');
      useAttachmentStore.getState().addFiles([new File(['A'], 'a.txt')]);
      const attachment = useAttachmentStore.getState().files[0];
      useAttachmentStore
        .getState()
        .updateFileUploadedId(attachment.id, 'upload-A');
    });
    const scopeA = useChatInputStore.getState().currentRoute;
    const filesA = useAttachmentStore.getState().files;
    rerender({ appId: 'app-B' });
    expect(useChatInputStore.getState().message).toBe('');
    expect(useAttachmentStore.getState().files).toEqual([]);
    act(() => {
      useChatInputStore.getState().setMessage('B draft');
      useAttachmentStore.getState().addFiles([new File(['B'], 'b.txt')]);
      const attachment = useAttachmentStore.getState().files[0];
      useAttachmentStore
        .getState()
        .updateFileUploadedId(attachment.id, 'upload-B');
    });
    const scopeB = useChatInputStore.getState().currentRoute;
    const filesB = useAttachmentStore.getState().files;
    expect(scopeB).not.toBe(scopeA);
    rerender({ appId: 'app-A' });
    expect(useChatInputStore.getState().currentRoute).toBe(scopeA);
    expect(useAttachmentStore.getState().currentScope).toBe(scopeA);
    expect(useChatInputStore.getState().message).toBe('A draft');
    expect(useAttachmentStore.getState().files).toEqual(filesA);
    expect(useAttachmentStore.getState().files[0].uploadedId).toBe('upload-A');
    rerender({ appId: 'app-B' });
    expect(useChatInputStore.getState().currentRoute).toBe(scopeB);
    expect(useAttachmentStore.getState().currentScope).toBe(scopeB);
    expect(useChatInputStore.getState().message).toBe('B draft');
    expect(useAttachmentStore.getState().files).toEqual(filesB);
  });

  it('restores the selected model draft after unmounting and remounting /chat/new', () => {
    mockPathname = '/chat/new';
    const first = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    act(() => {
      useChatInputStore.getState().setMessage('Keep on remount');
      useAttachmentStore.getState().addFiles([new File(['A'], 'a.txt')]);
    });
    const scope = useChatInputStore.getState().currentRoute;
    const files = useAttachmentStore.getState().files;
    first.unmount();
    renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    expect(useChatInputStore.getState().currentRoute).toBe(scope);
    expect(useChatInputStore.getState().message).toBe('Keep on remount');
    expect(useAttachmentStore.getState().files).toEqual(files);
  });

  it('waits for an initially undefined app without allocating or consuming an empty draft', () => {
    mockPathname = '/chat/new';
    const { rerender, result } = renderHook(
      ({ appId }) => useChatInputRouteSync({ userId: 'actor', appId }),
      { initialProps: { appId: undefined as string | undefined } }
    );
    expect(result.current.ready).toBe(false);
    expect(result.current.scope).toBeNull();
    expect(useChatInputStore.getState().currentRoute).toBe('default');
    expect(useChatInputStore.getState().messagesByRoute).toEqual({});
    expect(useAttachmentStore.getState().filesByScope).toEqual({});
    rerender({ appId: 'app-A' });
    const scope = result.current.scope;
    expect(result.current.ready).toBe(true);
    act(() => {
      useChatInputStore.getState().setMessage('Resolved A draft');
      useAttachmentStore.getState().addFiles([new File(['A'], 'a.txt')]);
    });
    const snapshot = useChatInputStore.getState().snapshot();
    const files = useAttachmentStore.getState().files;
    rerender({ appId: undefined });
    expect(result.current.ready).toBe(false);
    expect(result.current.scope).toBeNull();
    rerender({ appId: 'app-A' });
    expect(result.current.scope).toBe(scope);
    expect(useChatInputStore.getState().snapshot()).toEqual(snapshot);
    expect(useAttachmentStore.getState().currentScope).toBe(scope);
    expect(useAttachmentStore.getState().files).toEqual(files);
  });

  it('allocates a fresh draft when explicitly returning to /chat/new from a conversation', async () => {
    mockPathname = '/chat/new';
    const { rerender } = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    act(() => {
      useChatInputStore.getState().setMessage('Older new draft');
      useAttachmentStore.getState().addFiles([new File(['A'], 'a.txt')]);
    });
    const oldScope = useChatInputStore.getState().currentRoute;
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'local-history', user_id: 'actor', app_id: 'app-A' },
    } as never);
    mockPathname = '/chat/history-conversation';
    rerender();
    await waitFor(() =>
      expect(useChatInputStore.getState().currentRoute).toContain(
        'conversation:local-history'
      )
    );
    mockPathname = '/chat/new';
    rerender();
    expect(useChatInputStore.getState().currentRoute).not.toBe(oldScope);
    expect(useChatInputStore.getState().message).toBe('');
    expect(useAttachmentStore.getState().files).toEqual([]);
    expect(useChatInputStore.getState().messagesByRoute[oldScope]).toBe(
      'Older new draft'
    );
  });

  it('allocates a fresh draft after a real conversation unmounts even if the app resolves later', async () => {
    mockPathname = '/chat/new';
    const draft = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    act(() => useChatInputStore.getState().setMessage('Old draft'));
    const oldScope = useChatInputStore.getState().currentRoute;
    draft.unmount();
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'local-history', user_id: 'actor', app_id: 'app-A' },
    } as never);
    mockPathname = '/chat/external-history';
    const history = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    await waitFor(() => expect(history.result.current.ready).toBe(true));
    history.unmount();
    mockPathname = '/chat/new';
    const next = renderHook(
      ({ appId }) => useChatInputRouteSync({ userId: 'actor', appId }),
      { initialProps: { appId: undefined as string | undefined } }
    );
    expect(next.result.current.ready).toBe(false);
    next.rerender({ appId: 'app-A' });
    expect(next.result.current.scope).not.toBe(oldScope);
    expect(useChatInputStore.getState().message).toBe('');
    expect(useAttachmentStore.getState().files).toEqual([]);
  });

  it('adopts the original text and attachment bucket on temp -> real without consuming newer edits', async () => {
    mockPathname = '/chat/new';
    const { rerender, result } = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    act(() => {
      useChatInputStore.getState().setMessage('Submitted');
      useAttachmentStore.getState().addFiles([new File(['sent'], 'sent.txt')]);
    });
    const snapshot = useChatInputStore.getState().snapshot();
    const sentFiles = useAttachmentStore.getState().files;
    const unregister = registerChatInputSubmission(snapshot.scope);
    mockPathname = '/chat/temp-adopt';
    rerender();
    expect(result.current.scope).toBe(snapshot.scope);
    expect(useAttachmentStore.getState().currentScope).toBe(snapshot.scope);
    act(() => {
      useChatInputStore.getState().setMessage('Unsent follow-up');
      useAttachmentStore.getState().addFiles([new File(['new'], 'new.txt')]);
    });
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'adopted-local', user_id: 'actor', app_id: 'app-A' },
    } as never);
    await act(async () => {
      mockPathname = '/chat/adopted-external';
      rerender();
      await bindChatInputConversation(
        snapshot.scope,
        'actor',
        'app-A',
        'adopted-external'
      );
    });
    await waitFor(() =>
      expect(result.current.scope).toContain('conversation:adopted-local')
    );
    act(() => {
      useChatInputStore.getState().consumeSnapshot(snapshot);
      useAttachmentStore.getState().consumeFiles(snapshot.scope, sentFiles);
    });
    expect(useChatInputStore.getState().message).toBe('Unsent follow-up');
    expect(useAttachmentStore.getState().currentScope).toBe(
      result.current.scope
    );
    expect(useAttachmentStore.getState().files.map(file => file.name)).toEqual([
      'new.txt',
    ]);
    expect(useChatInputStore.getState().resolveScope(snapshot.scope)).toBe(
      result.current.scope
    );
    unregister();
  });

  it('keeps a pending new draft on temporary navigation and binds remaining edits to its real conversation', async () => {
    mockPathname = '/chat/new';
    const { rerender } = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    const originalScope = useChatInputStore.getState().currentRoute;
    const unregister = registerChatInputSubmission(originalScope);
    act(() => useChatInputStore.getState().setMessage('unsent edit'));
    mockPathname = '/chat/temp-123';
    rerender();
    expect(useChatInputStore.getState().currentRoute).toBe(originalScope);
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'local-uuid', user_id: 'actor', app_id: 'app-A' },
    } as never);
    mockPathname = '/chat/external';
    rerender();
    await waitFor(() =>
      expect(useChatInputStore.getState().currentRoute).toContain(
        'conversation:local-uuid'
      )
    );
    await act(async () => {
      await bindChatInputConversation(
        originalScope,
        'actor',
        'app-A',
        'external'
      );
    });
    expect(useChatInputStore.getState().message).toBe('unsent edit');
    unregister();
  });

  it('preserves accepted stream ownership when the persisted route activates before the save promise resolves', async () => {
    const { rerender, result } = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    act(() => useChatInputStore.getState().setMessage('Question'));
    const source = useChatInputStore.getState().currentRoute;
    let finish!: (value: string | null) => void;
    const conversationPersistencePromise = new Promise<string | null>(
      resolve => {
        finish = resolve;
      }
    );
    const accept = captureDifyInputSubmission('Question', 'actor');
    act(() => {
      accept('app-A', {
        externalId: 'accepted-external',
        taskId: 'accepted-task',
        conversationPersistencePromise,
      });
      useChatInputStore.getState().setMessage('Next draft');
      useAttachmentStore.getState().addFiles([new File(['next'], 'next.txt')]);
    });
    let detached = false;
    const unsubscribe = useChatInputStore.subscribe(state => {
      if (state.resolveScope(source) !== state.currentRoute) detached = true;
    });
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'accepted-local', user_id: 'actor', app_id: 'app-A' },
    } as never);
    try {
      mockPathname = '/chat/accepted-external';
      rerender();
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.scope).toContain('conversation:accepted-local');
      expect(detached).toBe(false);
      expect(useChatInputStore.getState().resolveScope(source)).toBe(
        result.current.scope
      );
      expect(useChatInputStore.getState().message).toBe('Next draft');
      expect(useAttachmentStore.getState().files[0].name).toBe('next.txt');
    } finally {
      unsubscribe();
      await act(async () => {
        finish('accepted-local');
        await conversationPersistencePromise;
      });
    }
  });

  it('does not activate an earlier history lookup that resolves after another route', async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof getConversationByExternalId>>
    ) => void;
    jest.mocked(getConversationByExternalId).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    mockPathname = '/chat/old';
    const { rerender, result } = renderHook(() =>
      useChatInputRouteSync({ userId: 'actor', appId: 'app-A' })
    );
    expect(result.current.ready).toBe(false);
    mockPathname = '/apps/chatbot/app-B';
    rerender();
    const selected = useChatInputStore.getState().currentRoute;
    await act(async () => {
      resolve({
        success: true,
        data: { id: 'old-local', user_id: 'actor', app_id: 'app-A' },
      } as never);
    });
    expect(useChatInputStore.getState().currentRoute).toBe(selected);
    expect(result.current.appId).toBe('app-B');
  });

  it('preserves drafts while session loads and clears all actors when logout is confirmed', () => {
    const { rerender } = renderHook(
      ({ loading, userId }) =>
        useChatInputRouteSync({ userId, appId: 'app-A', authLoading: loading }),
      {
        initialProps: { loading: false, userId: 'actor' as string | undefined },
      }
    );
    act(() => useChatInputStore.getState().setMessage('private draft'));
    rerender({ loading: true, userId: undefined });
    expect(
      Object.values(useChatInputStore.getState().messagesByRoute)
    ).toContain('private draft');
    rerender({ loading: false, userId: undefined });
    expect(useChatInputStore.getState().messagesByRoute).toEqual({});
    expect(useAttachmentStore.getState().filesByScope).toEqual({});
  });

  it('refuses cross-application binding and a changed actor after an asynchronous lookup', async () => {
    useChatInputStore.getState().setActor('actor');
    const epoch = useChatInputStore.getState().actorEpoch;
    const scope = chatInputScope(epoch, 'actor', 'app-A', 'newdraft:one');
    useChatInputStore.getState().setCurrentRoute(scope);
    useChatInputStore.getState().setMessage('keep');
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'local-B', user_id: 'actor', app_id: 'app-B' },
    } as never);
    await bindChatInputConversation(scope, 'actor', 'app-A', 'external-B');
    expect(useChatInputStore.getState().resolveScope(scope)).toBe(scope);
    let resolve!: (
      value: Awaited<ReturnType<typeof getConversationByExternalId>>
    ) => void;
    jest.mocked(getConversationByExternalId).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const pending = bindChatInputConversation(
      scope,
      'actor',
      'app-A',
      'external-A'
    );
    useChatInputStore.getState().setActor('other-actor');
    resolve({
      success: true,
      data: { id: 'local-A', user_id: 'actor', app_id: 'app-A' },
    } as never);
    await pending;
    expect(useChatInputStore.getState().aliases).toEqual({});
  });

  it.each(['failed', 'other-actor', 'same-actor-relogin'])(
    'does not look up or migrate an accepted scope after %s persistence',
    async outcome => {
      useChatInputStore.getState().setActor('actor');
      const scope = chatInputScope(
        useChatInputStore.getState().actorEpoch,
        'actor',
        'app-A',
        'newdraft:waiting'
      );
      useChatInputStore.getState().setCurrentRoute(scope);
      let finish!: (value: string | null) => void;
      const persistence = new Promise<string | null>(resolve => {
        finish = resolve;
      });
      const pending = bindChatInputConversation(
        scope,
        'actor',
        'app-A',
        'external-waiting',
        persistence
      );
      expect(getConversationByExternalId).not.toHaveBeenCalled();
      if (outcome === 'other-actor')
        useChatInputStore.getState().setActor('other');
      if (outcome === 'same-actor-relogin') {
        useChatInputStore.getState().setActor(null);
        useChatInputStore.getState().setActor('actor');
      }
      finish(outcome === 'failed' ? null : 'local-waiting');
      await pending;
      expect(getConversationByExternalId).not.toHaveBeenCalled();
      expect(useChatInputStore.getState().aliases).toEqual({});
    }
  );

  it('notifies scope subscribers even when both drafts have identical text', () => {
    const { result } = renderHook(() => {
      const { message, currentRoute } = useChatInputStore();
      return { message, currentRoute };
    });
    act(() => {
      useChatInputStore.getState().setCurrentRoute('first');
      useChatInputStore.getState().setMessage('same');
      useChatInputStore.getState().setCurrentRoute('second');
      useChatInputStore.getState().setMessage('same');
    });
    expect(result.current).toEqual({ message: 'same', currentRoute: 'second' });
    act(() => useChatInputStore.getState().setCurrentRoute('first'));
    expect(result.current).toEqual({ message: 'same', currentRoute: 'first' });
  });
});
