'use client';

import {
  type AgentInteraction,
  AgentRequestError,
  type AgentRun,
  agentRequest,
  agentRunSettled,
} from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';

import { useEffect, useRef, useState } from 'react';

interface InteractionState {
  scope: string;
  items: AgentInteraction[];
  loading: boolean;
  uncertainId?: string;
  submittingId?: string;
  error: boolean;
  exhausted: boolean;
  processing?: boolean;
  responseError?: AgentRequestError;
  notDispatched?: boolean;
}

export function useAgentInteractions(input: {
  appId: string;
  conversationId?: string;
  actorId: string;
  enabled: boolean;
  revision: string;
  onUpdated: () => Promise<unknown>;
}) {
  const actorEpoch = useLangchainDraftStore(state => state.actorEpoch);
  const scope = JSON.stringify([
    input.actorId,
    actorEpoch,
    input.appId,
    input.conversationId,
    input.enabled,
  ]);
  const [state, setState] = useState<InteractionState>({
    scope,
    items: [],
    loading: false,
    error: false,
    exhausted: false,
  });
  const [checkVersion, setCheckVersion] = useState(0);
  const generation = useRef(0);
  const activeScope = useRef(scope);
  const submitting = useRef(false);
  const uncertain = useRef<{
    scope: string;
    id: string;
    runId?: string;
  } | null>(null);
  const update = useRef(input.onUpdated);
  useEffect(() => {
    update.current = input.onUpdated;
  }, [input.onUpdated]);
  useEffect(() => {
    activeScope.current = scope;
    submitting.current = false;
    uncertain.current = null;
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [scope]);

  useEffect(() => {
    if (state.scope !== scope) return;
    const expirations = state.items
      .filter(item => item.status === 'pending' && item.expiresAt !== null)
      .map(item => Date.parse(item.expiresAt!))
      .filter(
        expiration => Number.isFinite(expiration) && expiration > Date.now()
      );
    if (!expirations.length) return;
    const timer = setTimeout(
      () => setCheckVersion(previous => previous + 1),
      Math.min(Math.min(...expirations) - Date.now(), 2147483647)
    );
    return () => clearTimeout(timer);
  }, [scope, state.scope, state.items]);

  useEffect(() => {
    if (!input.enabled || !input.conversationId) return;
    const abort = new AbortController();
    const version = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const current = () =>
      !abort.signal.aborted &&
      generation.current === version &&
      useLangchainDraftStore.getState().actorEpoch === actorEpoch;
    const check = async () => {
      try {
        const result = await agentRequest<{
          interactions: AgentInteraction[];
        }>(
          input.appId,
          `/conversations/${encodeURIComponent(input.conversationId!)}/interactions`,
          { signal: abort.signal }
        );
        if (!current()) return;
        if (!Array.isArray(result.interactions))
          throw new Error('Invalid interaction response');
        const items = result.interactions;
        if (
          uncertain.current?.scope === scope &&
          items.some(
            item =>
              item.id === uncertain.current?.id &&
              ['accepted', 'expired'].includes(item.status)
          )
        )
          uncertain.current = null;
        let running = items.some(item =>
          ['submitting', 'unknown'].includes(item.status)
        );
        const resumed = new Set(
          items.flatMap(item => (item.resumeRunId ? [item.resumeRunId] : []))
        );
        if (uncertain.current?.scope === scope && uncertain.current.runId)
          resumed.add(uncertain.current.runId);
        let completed = false;
        let notDispatched = false;
        for (const runId of resumed) {
          const run = await agentRequest<AgentRun>(
            input.appId,
            `/runs/${encodeURIComponent(runId)}`,
            { signal: abort.signal }
          );
          if (!current()) return;
          if (agentRunSettled(run)) completed = true;
          else running = true;
          if (
            run.executionStatus === 'error' &&
            run.persistenceStatus === 'saved' &&
            run.errorCode === 'AGENT_RESUME_NOT_DISPATCHED' &&
            uncertain.current?.scope === scope &&
            uncertain.current.runId === runId
          ) {
            uncertain.current = null;
            notDispatched = true;
          }
        }
        running ||= uncertain.current?.scope === scope;
        setState(previous => ({
          scope,
          items,
          loading: false,
          error: false,
          exhausted: false,
          processing: Boolean(running),
          notDispatched:
            notDispatched ||
            (previous.scope === scope && previous.notDispatched),
          ...(previous.scope === scope && previous.responseError
            ? { responseError: previous.responseError }
            : {}),
          ...(uncertain.current?.scope === scope
            ? { uncertainId: uncertain.current.id }
            : {}),
          ...(previous.scope === scope && previous.submittingId
            ? { submittingId: previous.submittingId }
            : {}),
        }));
        if (completed) await update.current();
        if (!current()) return;
        if (!running) return;
      } catch (failure) {
        if (!current()) return;
        setState(previous => ({
          ...(previous.scope === scope
            ? previous
            : { scope, items: [], exhausted: false }),
          loading: false,
          error: true,
        }));
        if (
          failure instanceof AgentRequestError &&
          [401, 403, 404].includes(failure.status)
        )
          return;
      }
      if (attempts < 3) {
        timer = setTimeout(() => void check(), [2000, 5000, 10000][attempts++]);
      } else {
        setState(previous => ({ ...previous, exhausted: true }));
      }
    };
    void Promise.resolve().then(() => {
      if (current()) {
        setState(previous => ({
          ...(previous.scope === scope
            ? previous
            : { scope, items: [], error: false, exhausted: false }),
          loading: true,
        }));
        void check();
      }
    });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [
    scope,
    actorEpoch,
    input.appId,
    input.conversationId,
    input.enabled,
    input.revision,
    checkVersion,
  ]);

  const visible: InteractionState =
    state.scope === scope
      ? state
      : {
          scope,
          items: [],
          loading: Boolean(input.enabled && input.conversationId),
          error: false,
          exhausted: false,
        };
  const respond = async (
    id: string,
    action: 'approve' | 'reject',
    comment: string
  ) => {
    if (
      !input.enabled ||
      useLangchainDraftStore.getState().actorEpoch !== actorEpoch ||
      !input.conversationId ||
      activeScope.current !== scope ||
      submitting.current ||
      visible.uncertainId ||
      visible.loading ||
      visible.error
    )
      return;
    const item = visible.items.find(candidate => candidate.id === id);
    if (
      !item ||
      item.status !== 'pending' ||
      !item.actions.includes(action) ||
      comment.length > item.commentMaxLength ||
      (item.expiresAt !== null &&
        (!Number.isFinite(Date.parse(item.expiresAt)) ||
          Date.parse(item.expiresAt) <= Date.now()))
    )
      return;
    const version = generation.current;
    submitting.current = true;
    setState(previous => ({
      ...previous,
      submittingId: id,
      error: false,
      responseError: undefined,
      notDispatched: false,
    }));
    try {
      const response = await agentRequest<{ run: AgentRun; replayed: boolean }>(
        input.appId,
        `/interactions/${encodeURIComponent(id)}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: crypto.randomUUID(),
            action,
            comment,
          }),
        }
      );
      if (
        generation.current !== version ||
        useLangchainDraftStore.getState().actorEpoch !== actorEpoch
      )
        return;
      uncertain.current = {
        scope,
        id,
        runId: response.run.id ?? response.run.runId,
      };
      setState(previous => ({ ...previous, uncertainId: id }));
    } catch (failure) {
      if (
        generation.current !== version ||
        useLangchainDraftStore.getState().actorEpoch !== actorEpoch
      )
        return;
      const rejected =
        failure instanceof AgentRequestError &&
        ([400, 401, 403, 404, 422, 429].includes(failure.status) ||
          (failure.status === 503 &&
            failure.detail?.code === 'CONTENT_MODERATION_UNAVAILABLE'));
      if (!rejected) uncertain.current = { scope, id };
      setState(previous => ({
        ...previous,
        error: true,
        responseError:
          failure instanceof AgentRequestError
            ? failure
            : new AgentRequestError(503),
        ...(rejected ? {} : { uncertainId: id }),
      }));
    } finally {
      if (
        generation.current === version &&
        useLangchainDraftStore.getState().actorEpoch === actorEpoch
      ) {
        submitting.current = false;
        setState(previous => ({ ...previous, submittingId: undefined }));
        setCheckVersion(previous => previous + 1);
      }
    }
  };
  return {
    ...visible,
    blocked:
      visible.loading ||
      visible.error ||
      visible.processing ||
      Boolean(visible.uncertainId || visible.submittingId) ||
      visible.items.some(item =>
        ['pending', 'submitting', 'unknown', 'expired'].includes(item.status)
      ),
    respond,
    check: () => setCheckVersion(previous => previous + 1),
  };
}
