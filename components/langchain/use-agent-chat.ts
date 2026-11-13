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
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [appName, setAppName] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
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
  const submission = useRef<{ submissionId: string; content: string } | null>(
    null
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const result = await agentRequest<{ conversations: AgentConversation[] }>(
        appId,
        '/conversations',
        { signal }
      );
      setConversations(result.conversations);
    },
    [appId]
  );

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
      setView({
        conversationId: detail.conversation.id,
        messages: detail.messages,
        tools: agentToolsFromMessages(detail.messages),
        run,
        runId: run?.id || run?.runId,
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
        await refresh(lifetime.signal);
        if (entryConversationId.current)
          await load(entryConversationId.current, lifetime.signal);
        if (!lifetime.signal.aborted) setReady(true);
      } catch (failure) {
        if (!lifetime.signal.aborted)
          setError(failure instanceof AgentRequestError ? failure.status : 500);
      }
    })();
    return () => {
      lifetime.abort();
      controller.current?.abort();
      generation.current += 1;
      navigationVersion.current += 1;
    };
  }, [appId, load, refresh]);

  const select = useCallback(
    async (conversationId: string | null) => {
      if (sending.current) return;
      const version = ++navigationVersion.current;
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
          setError(failure instanceof AgentRequestError ? failure.status : 500);
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
    if (
      !ready ||
      busy ||
      initialConversationId === observedRouteConversation.current
    )
      return;
    observedRouteConversation.current = initialConversationId;
    if (initialConversationId === lastRouteConversation.current) return;
    void Promise.resolve().then(() => select(initialConversationId));
  }, [ready, busy, initialConversationId, select]);

  const needsPolling = Boolean(view.run && !agentRunSettled(view.run));
  useEffect(() => {
    if (busy || !view.runId || !needsPolling) return;
    const polling = new AbortController();
    const runId = view.runId;
    const conversationId = view.conversationId;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const result = await agentRequest<AgentRun | { run: AgentRun }>(
          appId,
          `/runs/${encodeURIComponent(runId)}`,
          { signal: polling.signal }
        );
        if (polling.signal.aborted) return;
        const run = 'run' in result ? result.run : result;
        if (agentRunSettled(run)) {
          await refresh(polling.signal);
          if (conversationId) await load(conversationId, polling.signal);
          if (polling.signal.aborted) return;
          setView(previous =>
            previous.runId === runId ? { ...previous, run } : previous
          );
          setUnconfirmed(false);
          conversationEvents.emit();
          return;
        }
        setView(previous =>
          previous.runId === runId ? { ...previous, run } : previous
        );
      } catch (failure) {
        if (polling.signal.aborted) return;
        if (
          failure instanceof AgentRequestError &&
          [401, 403, 404].includes(failure.status)
        ) {
          setError(failure.status);
          return;
        }
      }
      attempts += 1;
      if (attempts < 40 && !polling.signal.aborted)
        timer = setTimeout(() => void poll(), 3000);
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
    refresh,
  ]);

  const send = async (content: string) => {
    if (
      !ready ||
      busy ||
      sending.current ||
      selecting.current ||
      historyLoading ||
      unconfirmed ||
      (lastRouteConversation.current &&
        lastRouteConversation.current !== view.conversationId) ||
      !content.trim()
    )
      return;
    sending.current = true;
    const currentGeneration = generation.current;
    const requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(), 150000);
    controller.current = requestController;
    const payload = {
      submissionId: crypto.randomUUID(),
      content: content.trim(),
    };
    submission.current = payload;
    setBusy(true);
    setError(null);
    setView(previous => ({
      ...previous,
      tools: [],
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
        if (generation.current !== currentGeneration) return;
        latest = reduceAgentEvent(latest, event);
        setView(previous => reduceAgentEvent(previous, event));
        if (event.type === 'accepted') {
          lastRouteConversation.current = event.conversationId;
          syncConversationUrl(event.conversationId);
          conversationEvents.emit();
        }
      });
      if (generation.current !== currentGeneration) return;
      if (!latest.run || !agentRunSettled(latest.run)) {
        setView(markAgentStreamInterrupted);
        setUnconfirmed(true);
      } else {
        submission.current = null;
        if (latest.conversationId)
          await load(latest.conversationId, requestController.signal);
        conversationEvents.emit();
      }
      await refresh(requestController.signal);
    } catch (failure) {
      if (generation.current !== currentGeneration) return;
      setError(failure instanceof AgentRequestError ? failure.status : 500);
      if (failure instanceof AgentRequestError && !latest.runId) {
        submission.current = null;
        setView(view);
      } else {
        setView(markAgentStreamInterrupted);
        setUnconfirmed(true);
      }
    } finally {
      clearTimeout(timeout);
      sending.current = false;
      if (generation.current === currentGeneration) setBusy(false);
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
      await refresh();
      conversationEvents.emit();
    } catch (failure) {
      setError(failure instanceof AgentRequestError ? failure.status : 500);
    }
  };
  return {
    view,
    conversations,
    appName,
    ready,
    busy,
    error,
    unconfirmed,
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
