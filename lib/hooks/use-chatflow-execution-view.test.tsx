import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { act, renderHook } from '@testing-library/react';

import {
  adoptChatflowExecutionPath,
  bindChatflowExecutionView,
  useChatflowExecutionView,
} from './use-chatflow-execution-view';

function bind(pathname = '/chat/temp-one') {
  const input = useChatInputStore.getState();
  return bindChatflowExecutionView(
    {
      actorId: 'actor',
      actorEpoch: input.actorEpoch,
      appId: 'app',
      draftScope: input.currentRoute,
    },
    pathname
  );
}

beforeEach(() => {
  useChatflowExecutionStore.setState(
    useChatflowExecutionStore.getInitialState()
  );
  useChatInputStore.getState().setActor('actor');
  const input = useChatInputStore.getState();
  input.setCurrentRoute(
    chatInputScope(input.actorEpoch, 'actor', 'app', 'draft')
  );
  useCurrentAppStore.setState({ currentAppId: 'app' });
});

it('retains the same view and completed nodes through precise route and draft promotion', () => {
  const initial = bind();
  const store = useChatflowExecutionStore.getState();
  store.addNode({ id: 'node', title: 'Summary', status: 'completed' });
  const { result, rerender } = renderHook(
    ({ path }) => useChatflowExecutionView('actor', path, false),
    { initialProps: { path: '/chat/temp-one' } }
  );
  act(() => {
    adoptChatflowExecutionPath(initial, '/chat/real-one');
    const input = useChatInputStore.getState();
    input.migrateScope(initial.draftScope, 'persisted-draft');
  });
  rerender({ path: '/chat/real-one' });
  expect(result.current?.scope).toBe(initial.scope);
  expect(useChatflowExecutionStore.getState().nodes).toHaveLength(1);
  let next!: ReturnType<typeof bind>;
  act(() => {
    next = bind('/chat/real-one');
  });
  expect(next.scope).toBe(initial.scope);
});

it('does not carry execution state into an unrelated conversation or restore it on return', () => {
  bind();
  const { result, rerender } = renderHook(
    ({ path }) => useChatflowExecutionView('actor', path, false),
    { initialProps: { path: '/chat/temp-one' } }
  );
  rerender({ path: '/chat/other' });
  expect(result.current).toBeNull();
  expect(useChatflowExecutionStore.getState().view).toBeNull();
  rerender({ path: '/chat/temp-one' });
  expect(result.current).toBeNull();
});

it.each(['actor', 'session', 'app', 'draft'])(
  'invalidates immediately on %s changes, even if switched back before render',
  kind => {
    const view = bind();
    const { result } = renderHook(() =>
      useChatflowExecutionView('actor', '/chat/temp-one', false)
    );
    act(() => {
      const input = useChatInputStore.getState();
      if (kind === 'actor') {
        input.setActor('other');
        input.setActor('actor');
      } else if (kind === 'session') {
        input.setActor('actor', 'old-session');
        input.setActor('actor', 'new-session');
      } else if (kind === 'app') {
        useCurrentAppStore.setState({ currentAppId: 'other' });
        useCurrentAppStore.setState({ currentAppId: 'app' });
      } else {
        input.setCurrentRoute('other');
        input.setCurrentRoute(view.draftScope);
      }
    });
    expect(result.current).toBeNull();
    expect(adoptChatflowExecutionPath(view, '/chat/late')).toBeNull();
  }
);

it('waits for initial authentication without destroying the owned view', () => {
  const view = bind();
  const { result, rerender } = renderHook(
    ({ actor, loading }: { actor?: string; loading: boolean }) =>
      useChatflowExecutionView(actor, '/chat/temp-one', loading),
    { initialProps: { actor: undefined as string | undefined, loading: true } }
  );
  expect(result.current).toBeNull();
  expect(useChatflowExecutionStore.getState().view).toBe(view);
  rerender({ actor: 'actor', loading: false });
  expect(result.current).toBe(view);
});

it('does not preserve a prior view after a confirmed sign-out', () => {
  bind();
  renderHook(() =>
    useChatflowExecutionView(undefined, '/chat/temp-one', false)
  );
  expect(useChatflowExecutionStore.getState().view).toBeNull();
});

it('invalidates on a real departure, so returning does not masquerade as a live conversation', () => {
  bind();
  window.history.replaceState({}, '', '/chat/temp-one');
  const { unmount } = renderHook(() =>
    useChatflowExecutionView('actor', '/chat/temp-one', false)
  );
  window.history.replaceState({}, '', '/apps');
  unmount();
  expect(useChatflowExecutionStore.getState().view).toBeNull();
  const { result } = renderHook(() =>
    useChatflowExecutionView('actor', '/chat/temp-one', false)
  );
  expect(result.current).toBeNull();
});

it('does not invalidate an adopted route during a page remount', () => {
  const view = bind('/apps/chatflow/app');
  const adopted = adoptChatflowExecutionPath(view, '/chat/temp-one');
  window.history.replaceState({}, '', '/chat/temp-one');
  const { unmount } = renderHook(() =>
    useChatflowExecutionView('actor', '/chat/temp-one', false)
  );
  unmount();
  expect(useChatflowExecutionStore.getState().view).toBe(adopted);
});
