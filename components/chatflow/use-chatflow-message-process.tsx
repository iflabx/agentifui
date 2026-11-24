'use client';

import { useRunProcessSelection } from '@components/chat/session/use-session-presentation';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { readChatflowExecutionMetadata } from '@lib/stores/chatflow-execution-store/history';

import { useTranslations } from 'next-intl';

import { ChatflowNodeTracker } from './chatflow-node-tracker';

export function useChatflowMessageProcess(
  messages: ChatMessage[],
  enabled: boolean,
  scope: string,
  ownsLiveView: boolean
) {
  const translate = useTranslations('executionProcess');
  const liveId = useChatflowExecutionStore(state =>
    ownsLiveView ? state.processMessageId : null
  );
  const retainedSelection = useChatflowExecutionStore(state =>
    ownsLiveView ? state.openProcessMessageId : null
  );
  const liveNodes = useChatflowExecutionStore(state => state.nodes);
  const executing = useChatflowExecutionStore(state => state.isExecuting);
  const failed = useChatflowExecutionStore(state => Boolean(state.error));
  const stopped = useChatflowExecutionStore(state => state.wasStopped);
  const saved = new Map<
    string,
    ReturnType<typeof readChatflowExecutionMetadata>
  >();
  if (enabled) {
    let userId: string | undefined;
    for (const message of messages) {
      if (message.isUser) {
        userId = message.id;
        continue;
      }
      if (message.isStreaming || message.role === 'system') continue;
      const id = userId ?? message.id;
      const snapshot = readChatflowExecutionMetadata(message.metadata);
      if (snapshot || !saved.has(id)) saved.set(id, snapshot);
    }
  }
  const selection = useRunProcessSelection(scope, id => Boolean(saved.get(id)));
  const selected =
    retainedSelection &&
    (retainedSelection === liveId || saved.get(retainedSelection))
      ? retainedSelection
      : selection.selected;
  if (!enabled) return undefined;

  return function renderMessageProcess(message: ChatMessage) {
    const id = message.id;
    const isLive = id === liveId;
    const snapshot = saved.get(id);
    if (!isLive && !snapshot) {
      return saved.has(id) ? (
        <p className="my-2 text-xs text-stone-500 dark:text-stone-400">
          {translate('empty')}
        </p>
      ) : null;
    }
    const useLive = isLive && !snapshot;
    return (
      <ChatflowNodeTracker
        key={id}
        scope={id}
        nodes={useLive ? liveNodes : snapshot!.nodes}
        status={
          useLive
            ? failed
              ? 'failed'
              : stopped
                ? 'stopped'
                : executing
                  ? 'running'
                  : 'completed'
            : snapshot!.status
        }
        historical={!isLive}
        open={selected === id}
        onOpenChange={open => {
          if (isLive && open) {
            if (selection.selected)
              selection.setOpen(selection.selected, false);
            useChatflowExecutionStore.setState({ openProcessMessageId: id });
          } else {
            if (ownsLiveView)
              useChatflowExecutionStore.setState({
                openProcessMessageId: null,
              });
            selection.setOpen(id, open);
          }
        }}
      />
    );
  };
}
