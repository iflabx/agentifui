import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import type { ChatflowExecutionView } from '@lib/stores/chatflow-execution-store/types';
import { useCurrentAppStore } from '@lib/stores/current-app-store';

import { useLayoutEffect } from 'react';

function ownsInput(view: ChatflowExecutionView) {
  const input = useChatInputStore.getState();
  return (
    input.actorId === view.actorId &&
    input.actorEpoch === view.actorEpoch &&
    input.resolveScope(view.draftScope) === input.currentRoute &&
    useCurrentAppStore.getState().currentAppId === view.appId
  );
}

export function bindChatflowExecutionView(
  input: Omit<ChatflowExecutionView, 'scope' | 'paths'>,
  pathname: string
): ChatflowExecutionView {
  const previous = useChatflowExecutionStore.getState().view;
  const continuation =
    previous &&
    previous.actorId === input.actorId &&
    previous.actorEpoch === input.actorEpoch &&
    previous.appId === input.appId &&
    previous.paths.includes(pathname) &&
    ownsInput(previous);
  const view = {
    ...input,
    scope: continuation
      ? previous.scope
      : JSON.stringify([
          input.actorEpoch,
          input.actorId,
          input.appId,
          pathname,
        ]),
    paths: continuation ? previous.paths : [pathname],
  };
  useChatflowExecutionStore.setState({
    view,
    ...(!continuation && { openProcessMessageId: null }),
  });
  return view;
}

export function adoptChatflowExecutionPath(
  view: ChatflowExecutionView | null,
  pathname: string
) {
  if (
    !view ||
    useChatflowExecutionStore.getState().view !== view ||
    !ownsInput(view)
  )
    return null;
  const next = { ...view, paths: [...new Set([...view.paths, pathname])] };
  useChatflowExecutionStore.setState({ view: next });
  return next;
}

export function useChatflowExecutionView(
  actorId: string | undefined,
  pathname: string,
  authLoading: boolean
) {
  const view = useChatflowExecutionStore(state => state.view);
  const input = useChatInputStore();
  const appId = useCurrentAppStore(state => state.currentAppId);
  const current = Boolean(
    view &&
    actorId === view.actorId &&
    input.actorId === view.actorId &&
    input.actorEpoch === view.actorEpoch &&
    appId === view.appId &&
    input.resolveScope(view.draftScope) === input.currentRoute &&
    view.paths.includes(pathname)
  );
  useLayoutEffect(() => {
    if (view && !current && !(authLoading && !actorId))
      useChatflowExecutionStore.getState().resetExecution();
  }, [view, current, authLoading, actorId]);
  useLayoutEffect(() => {
    const invalidate = () => {
      const active = useChatflowExecutionStore.getState().view;
      if (active && !ownsInput(active))
        useChatflowExecutionStore.getState().resetExecution();
    };
    const unsubscribeInput = useChatInputStore.subscribe(invalidate);
    const unsubscribeApp = useCurrentAppStore.subscribe(invalidate);
    return () => {
      unsubscribeInput();
      unsubscribeApp();
      const active = useChatflowExecutionStore.getState().view;
      if (active && !active.paths.includes(window.location.pathname))
        useChatflowExecutionStore.getState().resetExecution();
    };
  }, []);
  return current ? view : null;
}
