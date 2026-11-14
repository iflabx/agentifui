'use client';

import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  AgentRequestError,
  agentPath,
  agentRequest,
  agentRunSettled,
  consumeAgentStream,
} from '@lib/services/client/langchain-api';
import type {
  AgentConversation,
  AgentMessage,
  AgentRun,
} from '@lib/services/client/langchain-api';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  agentToolsFromMessages,
  markAgentStreamInterrupted,
  reduceAgentEvent,
} from './state';
import type { AgentViewState } from './state';

const emptyView = (): AgentViewState => ({ messages: [], tools: [] });
interface Detail {
  conversation: AgentConversation;
  messages: AgentMessage[];
  runs: AgentRun[];
}

function syncConversationUrl(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set('conversationId', conversationId);
  else url.searchParams.delete('conversationId');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`
  );
}

export function useAgentChat(
  appId: string,
  initialConversationId: string | null
) {
  const [view, setView] = useState<AgentViewState>(emptyView);
  const [draftScope, setDraftScope] = useState(
    initialConversationId || 'new:0'
  );
  const draftScopes = useRef(new Map<string, string>());
  const newDraftVersion = useRef(0);
  const [appName, setAppName] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AgentRequestError | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [statusCheckVersion, setStatusCheckVersion] = useState(0);
  const [statusCheckExhausted, setStatusCheckExhausted] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const selecting = useRef(false);
  const navigationVersion = useRef(0);
  const lastRouteConversation = useRef(initialConversationId);
  const observedRouteConversation = useRef(initialConversationId);
  const controller = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const entryConversationId = useRef(initialConversationId);

  const load = useCallback(
    async (
      conversationId: string,
      signal?: AbortSignal,
      version = navigationVersion.current
    ) => {
      const detail = await agentRequest<Detail>(
        appId,
        `/conversations/${encodeURIComponent(conversationId)}`,
        { signal }
      );
      if (signal?.aborted || version !== navigationVersion.current)
        return false;
      const run = detail.runs[0];
      setView(previous => {
        const persisted = new Set(detail.messages.map(message => message.id));
        const recovery =
          run?.recoveryMessages ||
          (previous.conversationId === detail.conversation.id &&
          previous.runId === (run?.id || run?.runId)
            ? previous.messages.filter(message => message.role === 'assistant')
            : []);
        const messages =
          run && !agentRunSettled(run)
            ? [
                ...detail.messages,
                ...recovery.filter(message => !persisted.has(message.id)),
              ]
            : detail.messages;
        return {
          conversationId: detail.conversation.id,
          messages,
          tools: agentToolsFromMessages(messages),
          run,
          runId: run?.id || run?.runId,
        };
      });
      setUnconfirmed(Boolean(run && !agentRunSettled(run)));
      return true;
    },
    [appId]
  );

  useEffect(() => {
    const lifetime = new AbortController();
    generation.current += 1;
    void (async () => {
      try {
        await Promise.resolve();
        if (lifetime.signal.aborted) return;
        setReady(false);
        setError(null);
        setView(emptyView());
        setUnconfirmed(false);
        const result = await agentRequest<{ app: { name: string } }>(
          appId,
          '',
          { signal: lifetime.signal }
        );
        if (lifetime.signal.aborted) return;
        setAppName(result.app.name);
        if (entryConversationId.current) {
          setHistoryLoading(true);
          try {
            await load(entryConversationId.current, lifetime.signal);
          } catch (failure) {
            if (!lifetime.signal.aborted) {
              setHistoryFailed(true);
              setError(
                failure instanceof AgentRequestError
                  ? failure
                  : new AgentRequestError(500)
              );
            }
          } finally {
            if (!lifetime.signal.aborted) setHistoryLoading(false);
          }
        }
        if (!lifetime.signal.aborted) setReady(true);
      } catch (failure) {
        if (!lifetime.signal.aborted)
          setError(
            failure instanceof AgentRequestError
              ? failure
              : new AgentRequestError(500)
          );
      }
    })();
    return () => {
      lifetime.abort();
      controller.current?.abort();
      generation.current += 1;
      navigationVersion.current += 1;
    };
  }, [appId, load]);

  const select = useCallback(
    async (conversationId: string | null) => {
      const version = ++navigationVersion.current;
      controller.current?.abort();
      controller.current = null;
      sending.current = false;
      setBusy(false);
      setDraftScope(
        conversationId
          ? draftScopes.current.get(conversationId) || conversationId
          : `new:${++newDraftVersion.current}`
      );
      lastRouteConversation.current = conversationId;
      syncConversationUrl(conversationId);
      selecting.current = Boolean(conversationId);
      setHistoryLoading(Boolean(conversationId));
      setHistoryFailed(false);
      setError(null);
      setView(emptyView());
      setUnconfirmed(false);
      if (!conversationId) return;
      try {
        await load(conversationId, undefined, version);
      } catch (failure) {
        if (version === navigationVersion.current) {
          setHistoryFailed(true);
          setError(
            failure instanceof AgentRequestError
              ? failure
              : new AgentRequestError(500)
          );
        }
      } finally {
        if (version === navigationVersion.current) {
          selecting.current = false;
          setHistoryLoading(false);
        }
      }
    },
    [load]
  );

  useEffect(() => {
    if (!ready || initialConversationId === observedRouteConversation.current)
      return;
    observedRouteConversation.current = initialConversationId;
    if (initialConversationId === lastRouteConversation.current) return;
    void Promise.resolve().then(() => select(initialConversationId));
  }, [ready, initialConversationId, select]);

  const needsPolling = Boolean(view.run && !agentRunSettled(view.run));
  useEffect(() => {
    if (busy || !view.runId || !needsPolling) return;
    const polling = new AbortController();
    const runId = view.runId;
    const conversationId = view.conversationId;
    const version = navigationVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    void Promise.resolve().then(() => {
      if (!polling.signal.aborted) setStatusCheckExhausted(false);
    });
    const poll = async () => {
      try {
        const result = await agentRequest<AgentRun | { run: AgentRun }>(
          appId,
          `/runs/${encodeURIComponent(runId)}`,
          { signal: polling.signal }
        );
        if (polling.signal.aborted || version !== navigationVersion.current)
          return;
        const run = 'run' in result ? result.run : result;
        if (agentRunSettled(run)) {
          if (conversationId)
            await load(conversationId, polling.signal, version);
          if (polling.signal.aborted || version !== navigationVersion.current)
            return;
          setView(previous =>
            previous.runId === runId ? { ...previous, run } : previous
          );
          setUnconfirmed(false);
          conversationEvents.emit();
          return;
        }
        setView(previous =>
          previous.runId === runId
            ? {
                ...previous,
                run,
                ...(run.recoveryMessages
                  ? {
                      messages: [
                        ...previous.messages.filter(
                          message =>
                            !run.recoveryMessages!.some(
                              recovery => recovery.id === message.id
                            )
                        ),
                        ...run.recoveryMessages,
                      ],
                      tools: agentToolsFromMessages([
                        ...previous.messages,
                        ...run.recoveryMessages,
                      ]),
                    }
                  : {}),
              }
            : previous
        );
      } catch (failure) {
        if (polling.signal.aborted || version !== navigationVersion.current)
          return;
        if (
          failure instanceof AgentRequestError &&
          [401, 403, 404].includes(failure.status)
        ) {
          setError(failure);
          return;
        }
      }
      attempts += 1;
      if (attempts < 40 && !polling.signal.aborted)
        timer = setTimeout(() => void poll(), 3000);
      else if (!polling.signal.aborted) setStatusCheckExhausted(true);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      polling.abort();
      clearTimeout(timer);
    };
  }, [
    appId,
    busy,
    view.runId,
    view.conversationId,
    needsPolling,
    load,
    statusCheckVersion,
  ]);

  const send = async (content: string) => {
    if (
      !ready ||
      busy ||
      sending.current ||
      selecting.current ||
      historyLoading ||
      historyFailed ||
      unconfirmed ||
      (lastRouteConversation.current &&
        lastRouteConversation.current !== view.conversationId) ||
      !content.trim()
    )
      return;
    sending.current = true;
    const currentGeneration = generation.current;
    const version = navigationVersion.current;
    const requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(), 150000);
    controller.current = requestController;
    const ownsView = () =>
      generation.current === currentGeneration &&
      navigationVersion.current === version &&
      controller.current === requestController;
    const payload = {
      submissionId: crypto.randomUUID(),
      content: content.trim(),
    };
    setBusy(true);
    setError(null);
    setView(previous => ({
      ...previous,
      run: undefined,
      runId: undefined,
      messages: [
        ...previous.messages,
        { id: payload.submissionId, role: 'user', content: payload.content },
      ],
    }));
    let latest: AgentViewState = { ...view, run: undefined, runId: undefined };
    try {
      const response = await fetch(agentPath(appId, '/runs'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(view.conversationId
            ? { conversationId: view.conversationId }
            : {}),
        }),
        signal: requestController.signal,
      });
      await consumeAgentStream(response, event => {
        if (!ownsView()) return;
        latest = reduceAgentEvent(latest, event);
        setView(previous => reduceAgentEvent(previous, event));
        if (event.type === 'accepted') {
          draftScopes.current.set(event.conversationId, draftScope);
          if (draftScope.startsWith('new:')) newDraftVersion.current += 1;
          lastRouteConversation.current = event.conversationId;
          syncConversationUrl(event.conversationId);
          conversationEvents.emit();
        }
      });
      if (!ownsView()) return Boolean(latest.runId);
      if (!latest.run || !agentRunSettled(latest.run)) {
        setView(markAgentStreamInterrupted);
        setUnconfirmed(true);
      } else {
        if (latest.conversationId)
          await load(latest.conversationId, requestController.signal, version);
        conversationEvents.emit();
      }
    } catch (failure) {
      if (!ownsView()) return Boolean(latest.runId);
      setError(
        failure instanceof AgentRequestError
          ? failure
          : new AgentRequestError(500)
      );
      if (failure instanceof AgentRequestError && !latest.runId) {
        setView(view);
      } else {
        setView(markAgentStreamInterrupted);
        setUnconfirmed(true);
      }
    } finally {
      clearTimeout(timeout);
      if (ownsView()) {
        sending.current = false;
        controller.current = null;
        setBusy(false);
      }
    }
    return Boolean(latest.runId);
  };

  const remove = async () => {
    if (!view.conversationId || busy || selecting.current || unconfirmed)
      return;
    const version = navigationVersion.current;
    try {
      await agentRequest(
        appId,
        `/conversations/${encodeURIComponent(view.conversationId)}`,
        { method: 'DELETE' }
      );
      if (version === navigationVersion.current) await select(null);
      conversationEvents.emit();
    } catch (failure) {
      if (version === navigationVersion.current)
        setError(
          failure instanceof AgentRequestError
            ? failure
            : new AgentRequestError(500)
        );
    }
  };
  return {
    view,
    draftScope,
    appName,
    ready,
    busy,
    error,
    unconfirmed,
    statusCheckExhausted,
    retryStatus: () => setStatusCheckVersion(previous => previous + 1),
    historyLoading,
    historyFailed,
    send,
    select,
    remove,
    newConversation: () => {
      if (!busy) void select(null);
    },
  };
}
