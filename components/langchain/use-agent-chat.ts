'use client';

import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { consumeAguiStream } from '@lib/services/client/agui-stream';
import {
  AgentRequestError,
  agentInputRequirementsChanged,
  agentMessageFitsRequest,
  agentPath,
  agentRequest,
  agentRunSettled,
  agentSubmissionRequest,
  consumeAgentStream,
} from '@lib/services/client/langchain-api';
import type {
  AgentConversation,
  AgentInputFile,
  AgentMessage,
  AgentRun,
  AgentTurnInputs,
} from '@lib/services/client/langchain-api';
import {
  type LangchainDraftSnapshot,
  type PendingAgentSubmission,
  useLangchainDraftStore,
} from '@lib/stores/langchain-draft-store';
import type {
  EditRecoveryReceipt,
  EditSubmissionResult,
} from '@lib/types/message-edit';

import { useCallback, useEffect, useRef, useState } from 'react';

import { replaceMessagePath } from '../../packages/shared/src/message-edit';
import {
  agentDisplayHistory,
  projectAgentView,
  recoverAgentRun,
  restoreAgentView,
} from './agui-state';
import {
  markAgentStreamInterrupted,
  mergeResultRuns,
  reduceAgentEvent,
} from './state';
import type { AgentViewState } from './state';

const emptyView = (): AgentViewState => ({ messages: [], tools: [] });
export function editViewPrefix(
  view: AgentViewState,
  sourceId: string
): AgentViewState {
  const messages = replaceMessagePath(view.messages, sourceId);
  const runIds = new Set(
    messages.map(message => message.metadata?.backend_run_id)
  );
  return {
    ...view,
    run: undefined,
    runId: undefined,
    messages,
    tools: view.tools.filter(tool => runIds.has(tool.runId)),
    resultRuns: view.resultRuns?.filter(run => runIds.has(run.id || run.runId)),
  };
}
interface Detail {
  conversation: AgentConversation;
  messages: AgentMessage[];
  runs: AgentRun[];
  protocol?: 'ag-ui/1.0' | 'agentifui/legacy';
  nextCursor?: string | null;
}

function syncConversationUrl(appId: string, conversationId: string | null) {
  const url = new URL(window.location.href);
  if (
    url.pathname.startsWith('/chat/') ||
    url.pathname.startsWith('/apps/chatbot/')
  )
    url.pathname = `/apps/agent-chat/${encodeURIComponent(appId)}`;
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
  initialConversationId: string | null,
  actorId?: string
) {
  const actorEpoch = useLangchainDraftStore(state => state.actorEpoch);
  const [view, setView] = useState<AgentViewState>(emptyView);
  const [draftScope, setDraftScope] = useState(
    initialConversationId || 'new:0'
  );
  const draftScopes = useRef(new Map<string, string>());
  const newDraftVersion = useRef(0);
  const [appName, setAppName] = useState('');
  const [appDescription, setAppDescription] = useState<string | null>(null);
  const [textOnly, setTextOnly] = useState(false);
  const [acceptsInputCapabilities, setAcceptsInputCapabilities] =
    useState(false);
  const [humanInput, setHumanInput] = useState(false);
  const [singleTask, setSingleTask] = useState(false);
  const [resultSingleBatch, setResultSingleBatch] = useState(false);
  const [newConversationsEnabled, setNewConversationsEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AgentRequestError | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [editRecovery, setEditRecovery] = useState<EditRecoveryReceipt | null>(
    null
  );
  const [statusCheckVersion, setStatusCheckVersion] = useState(0);
  const [statusCheckExhausted, setStatusCheckExhausted] = useState(false);
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(
    null
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selecting = useRef(false);
  const navigationVersion = useRef(0);
  const lastRouteConversation = useRef(initialConversationId);
  const observedRouteConversation = useRef(initialConversationId);
  const controller = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const entryConversationId = useRef(initialConversationId);
  const defaultProtocol = useRef('agentifui/legacy');
  const protocol = useRef('agentifui/legacy');

  const restorePending = useCallback(
    (conversationId: string | null) => {
      if (!actorId) return false;
      const pending = useLangchainDraftStore
        .getState()
        .findSubmission(actorId, appId, conversationId || 'new');
      if (!pending) return false;
      setPendingSubmissionId(pending.submissionId);
      setUnconfirmed(true);
      setView(previous => ({
        ...previous,
        messages: [
          ...previous.messages.filter(
            message => message.id !== pending.submissionId
          ),
          {
            id: pending.submissionId,
            role: 'user',
            content: pending.content,
            ...(pending.inputFiles?.length
              ? { metadata: { input_attachments: pending.inputFiles } }
              : {}),
          },
        ],
      }));
      return true;
    },
    [actorId, appId]
  );

  const forgetPending = useCallback(
    (submissionId: string, accepted = false) => {
      if (actorId)
        useLangchainDraftStore
          .getState()
          .forgetSubmission(actorId, submissionId, accepted);
    },
    [actorId]
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
      if (
        signal?.aborted ||
        version !== navigationVersion.current ||
        useLangchainDraftStore.getState().actorEpoch !== actorEpoch
      )
        return false;
      protocol.current = detail.protocol ?? defaultProtocol.current;
      setNextCursor(detail.nextCursor ?? null);
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
        return restoreAgentView({
          conversationId: detail.conversation.id,
          messages,
          runs: detail.runs,
        });
      });
      setUnconfirmed(Boolean(run && !agentRunSettled(run)));
      setError(null);
      return true;
    },
    [appId, actorEpoch]
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
        setPendingSubmissionId(null);
        const result = await agentRequest<{
          app: { name: string; description?: string | null };
          protocol?: string;
          interactionMode?: string;
          acceptsInputCapabilities?: boolean;
          capabilities?: {
            humanInput?: boolean;
            resultArtifacts?: { batchesPerThread?: number };
          };
          singleTask?: boolean;
          newConversationsEnabled?: boolean;
        }>(appId, '', { signal: lifetime.signal });
        if (lifetime.signal.aborted) return;
        setAppName(result.app.name);
        setAppDescription(result.app.description ?? null);
        setTextOnly(result.interactionMode === 'text-only');
        setAcceptsInputCapabilities(result.acceptsInputCapabilities === true);
        setHumanInput(result.capabilities?.humanInput === true);
        setSingleTask(result.singleTask === true);
        setResultSingleBatch(
          result.capabilities?.resultArtifacts?.batchesPerThread === 1
        );
        setNewConversationsEnabled(result.newConversationsEnabled !== false);
        defaultProtocol.current =
          result.protocol === 'ag-ui/1.0'
            ? result.protocol
            : 'agentifui/legacy';
        protocol.current = defaultProtocol.current;
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
        if (!lifetime.signal.aborted) {
          restorePending(entryConversationId.current);
          setReady(true);
        }
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
  }, [appId, load, restorePending]);

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
      syncConversationUrl(appId, conversationId);
      selecting.current = Boolean(conversationId);
      setHistoryLoading(Boolean(conversationId));
      setHistoryFailed(false);
      setNextCursor(null);
      setLoadingMore(false);
      setError(null);
      setView(emptyView());
      setUnconfirmed(false);
      setPendingSubmissionId(null);
      if (!conversationId) {
        protocol.current = defaultProtocol.current;
        restorePending(null);
        return;
      }
      try {
        await load(conversationId, undefined, version);
        if (version === navigationVersion.current)
          restorePending(conversationId);
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
    [appId, load, restorePending]
  );

  useEffect(() => {
    if (!ready || initialConversationId === observedRouteConversation.current)
      return;
    observedRouteConversation.current = initialConversationId;
    if (initialConversationId === lastRouteConversation.current) return;
    void Promise.resolve().then(() => select(initialConversationId));
  }, [ready, initialConversationId, select]);

  const needsPolling = Boolean(
    view.run && (!agentRunSettled(view.run) || unconfirmed)
  );
  useEffect(() => {
    if (busy || (!pendingSubmissionId && (!view.runId || !needsPolling)))
      return;
    const polling = new AbortController();
    let runId = pendingSubmissionId ? undefined : view.runId;
    let conversationId = view.conversationId;
    const version = navigationVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    void Promise.resolve().then(() => {
      if (!polling.signal.aborted) setStatusCheckExhausted(false);
    });
    const poll = async () => {
      try {
        if (!runId && pendingSubmissionId) {
          const submission = await agentSubmissionRequest(
            appId,
            pendingSubmissionId,
            polling.signal
          );
          if (polling.signal.aborted || version !== navigationVersion.current)
            return;
          if (submission.state === 'rejected' && !submission.runId) {
            setEditRecovery({
              submissionId: pendingSubmissionId,
              accepted: false,
            });
            forgetPending(pendingSubmissionId);
            setPendingSubmissionId(null);
            setUnconfirmed(false);
            setView(previous => ({
              ...previous,
              messages: previous.messages.filter(
                message => message.id !== pendingSubmissionId
              ),
            }));
            return;
          }
          runId = submission.runId ?? undefined;
          if (!runId) throw new Error('Agent submission awaiting registration');
        }
        if (!runId) throw new Error('Agent run unavailable');
        const result = await agentRequest<AgentRun | { run: AgentRun }>(
          appId,
          `/runs/${encodeURIComponent(runId)}`,
          { signal: polling.signal }
        );
        if (polling.signal.aborted || version !== navigationVersion.current)
          return;
        const run = 'run' in result ? result.run : result;
        if (pendingSubmissionId && run.conversationId) {
          conversationId = run.conversationId;
          lastRouteConversation.current = conversationId;
          syncConversationUrl(appId, conversationId);
          await load(conversationId, polling.signal, version);
          if (polling.signal.aborted || version !== navigationVersion.current)
            return;
          forgetPending(pendingSubmissionId, true);
          setEditRecovery({
            submissionId: pendingSubmissionId,
            accepted: true,
          });
          setPendingSubmissionId(null);
          conversationEvents.emit();
        }
        if (agentRunSettled(run)) {
          setView(previous =>
            previous.runId === runId
              ? {
                  ...previous,
                  run,
                  resultRuns: mergeResultRuns(previous.resultRuns, [run]),
                }
              : previous
          );
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
          previous.runId === runId ? recoverAgentRun(previous, run) : previous
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
    pendingSubmissionId,
    forgetPending,
  ]);

  const send = async (
    content: string,
    draftSnapshot?: LangchainDraftSnapshot,
    editSourceId?: string,
    configuredInput?: {
      inputs: AgentTurnInputs;
      fileDrafts: PendingAgentSubmission['fileDrafts'];
      files: AgentInputFile[];
    }
  ) => {
    if (
      !ready ||
      (singleTask && Boolean(view.conversationId)) ||
      (!view.conversationId && !newConversationsEnabled) ||
      busy ||
      sending.current ||
      selecting.current ||
      historyLoading ||
      historyFailed ||
      unconfirmed ||
      (lastRouteConversation.current &&
        lastRouteConversation.current !== view.conversationId) ||
      (!content.trim() && (!acceptsInputCapabilities || !configuredInput))
    )
      return;
    if (
      !agentMessageFitsRequest(
        content,
        view.conversationId,
        configuredInput?.inputs
      )
    ) {
      setError(
        new AgentRequestError(413, {
          code: 'AGENT_MESSAGE_TOO_LONG',
          source: 'frontend',
          severity: 'warn',
          retryable: false,
          userMessage: 'AGENT_MESSAGE_TOO_LONG',
          requestId: '',
          occurredAt: new Date().toISOString(),
        })
      );
      return false;
    }
    sending.current = true;
    const currentGeneration = generation.current;
    const version = navigationVersion.current;
    const requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(), 150000);
    controller.current = requestController;
    const ownsView = () =>
      useLangchainDraftStore.getState().actorEpoch === actorEpoch &&
      generation.current === currentGeneration &&
      navigationVersion.current === version &&
      controller.current === requestController;
    const payload = {
      submissionId: crypto.randomUUID(),
      content: content.trim(),
      ...(editSourceId ? { editSourceId } : {}),
      ...configuredInput?.inputs,
    };
    const pendingMessage: AgentMessage = {
      id: payload.submissionId,
      role: 'user',
      content: payload.content,
      ...(configuredInput?.files.length
        ? { metadata: { input_attachments: configuredInput.files } }
        : {}),
    };
    if (actorId)
      useLangchainDraftStore.getState().rememberSubmission(actorId, {
        appId,
        target: view.conversationId || 'new',
        ...payload,
        snapshot: draftSnapshot,
        fileDrafts: configuredInput?.fileDrafts,
        inputFiles: configuredInput?.files,
      });
    setBusy(true);
    setError(null);
    setPendingSubmissionId(payload.submissionId);
    setView(previous => ({
      ...previous,
      run: undefined,
      runId: undefined,
      messages: [...previous.messages, pendingMessage],
    }));
    let latest: AgentViewState = { ...view, run: undefined, runId: undefined };
    let editResult: EditSubmissionResult = {
      status: 'unknown',
      submissionId: payload.submissionId,
    };
    try {
      const response = await fetch(agentPath(appId, '/runs'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(protocol.current === 'ag-ui/1.0'
            ? { 'X-AgentifUI-Protocol': 'ag-ui/1.0' }
            : {}),
        },
        body: JSON.stringify({
          ...payload,
          ...(view.conversationId
            ? { conversationId: view.conversationId }
            : {}),
        }),
        signal: requestController.signal,
      });
      if (protocol.current === 'ag-ui/1.0') {
        let accepted = false;
        await consumeAguiStream(response, {
          submissionId: payload.submissionId,
          conversationId: view.conversationId,
          history: acceptance =>
            agentDisplayHistory([
              ...replaceMessagePath(view.messages, editSourceId),
              {
                id: acceptance.userMessageId,
                role: 'user',
                content: payload.content,
              },
            ]),
          accept: (snapshot, acceptance) => {
            if (!ownsView()) return;
            editResult = true;
            setPendingSubmissionId(null);
            if (editSourceId && !accepted)
              latest = editViewPrefix(latest, editSourceId);
            if (!accepted && pendingMessage.metadata)
              latest = {
                ...latest,
                messages: [
                  ...latest.messages,
                  { ...pendingMessage, id: acceptance.userMessageId },
                ],
              };
            latest = projectAgentView(latest, snapshot);
            setView(latest);
            if (!accepted) {
              accepted = true;
              forgetPending(payload.submissionId, true);
              draftScopes.current.set(acceptance.conversationId, draftScope);
              if (draftScope.startsWith('new:')) newDraftVersion.current += 1;
              lastRouteConversation.current = acceptance.conversationId;
              syncConversationUrl(appId, acceptance.conversationId);
              conversationEvents.emit();
            }
          },
        });
        if (ownsView() && latest.runId) {
          const result = await agentRequest<AgentRun>(
            appId,
            `/runs/${encodeURIComponent(latest.runId)}`,
            { signal: requestController.signal }
          );
          if (ownsView()) {
            latest = {
              ...latest,
              run: result,
              resultRuns: mergeResultRuns(latest.resultRuns, [result]),
            };
            setView(latest);
          }
        }
      } else
        await consumeAgentStream(response, event => {
          if (!ownsView()) return;
          if (event.type === 'accepted' && editSourceId) {
            latest = {
              ...editViewPrefix(latest, editSourceId),
              messages: [
                ...replaceMessagePath(view.messages, editSourceId),
                {
                  id: payload.submissionId,
                  role: 'user',
                  content: payload.content,
                },
              ],
            };
          }
          latest = reduceAgentEvent(latest, event);
          setView(previous =>
            editSourceId ? latest : reduceAgentEvent(previous, event)
          );
          if (event.type === 'accepted') {
            editResult = true;
            setPendingSubmissionId(null);
            forgetPending(payload.submissionId, true);
            draftScopes.current.set(event.conversationId, draftScope);
            if (draftScope.startsWith('new:')) newDraftVersion.current += 1;
            lastRouteConversation.current = event.conversationId;
            syncConversationUrl(appId, event.conversationId);
            conversationEvents.emit();
          }
        });
      if (!ownsView()) return editSourceId ? editResult : Boolean(latest.runId);
      if (!latest.run || !agentRunSettled(latest.run)) {
        setView(markAgentStreamInterrupted);
        setUnconfirmed(true);
      } else {
        if (latest.conversationId)
          await load(latest.conversationId, requestController.signal, version);
        if (ownsView()) conversationEvents.emit();
      }
    } catch (failure) {
      if (!ownsView()) return editSourceId ? editResult : Boolean(latest.runId);
      setError(
        failure instanceof AgentRequestError
          ? failure
          : new AgentRequestError(500)
      );
      if (failure instanceof AgentRequestError && !latest.runId) {
        if (
          agentInputRequirementsChanged(failure.detail?.code) ||
          (failure.status >= 400 &&
            failure.status < 500 &&
            failure.status !== 408 &&
            (failure.status !== 409 ||
              [
                'AGENT_RESULT_PROFILE_DISABLED',
                'AGENT_EDIT_SOURCE_UNAVAILABLE',
                'AGENT_EDIT_ATTACHMENTS_UNSUPPORTED',
                'INPUT_FILE_CHANGED',
                'INPUT_PROFILE_UNSUPPORTED',
                'INPUT_CAPABILITIES_UNSUPPORTED',
                'DIFY_MODE_UNSUPPORTED',
              ].includes(failure.detail?.code ?? '')))
        ) {
          editResult = false;
          setView(view);
          setPendingSubmissionId(null);
          forgetPending(payload.submissionId);
          setUnconfirmed(false);
        } else {
          setUnconfirmed(true);
        }
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
    return editSourceId ? editResult : Boolean(latest.runId);
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
      if (version === navigationVersion.current) {
        await select(null);
        if (useLangchainDraftStore.getState().actorEpoch === actorEpoch)
          conversationEvents.emit();
      }
    } catch (failure) {
      if (version === navigationVersion.current)
        setError(
          failure instanceof AgentRequestError
            ? failure
            : new AgentRequestError(500)
        );
    }
  };
  const loadMore = async () => {
    if (!nextCursor || loadingMore || busy || !view.conversationId) return;
    const version = navigationVersion.current;
    const conversationId = view.conversationId;
    setLoadingMore(true);
    try {
      const detail = await agentRequest<Detail>(
        appId,
        `/conversations/${encodeURIComponent(conversationId)}?before=${encodeURIComponent(nextCursor)}`
      );
      if (version !== navigationVersion.current) return;
      const older = restoreAgentView({
        conversationId,
        messages: detail.messages,
        runs: detail.runs,
      });
      setView(previous => {
        const ids = new Set(previous.messages.map(message => message.id));
        const toolIds = new Set(
          previous.tools.map(tool =>
            JSON.stringify([tool.runId, tool.toolCallId])
          )
        );
        return {
          ...previous,
          messages: [
            ...older.messages.filter(message => !ids.has(message.id)),
            ...previous.messages,
          ],
          tools: [
            ...older.tools.filter(
              tool =>
                !toolIds.has(JSON.stringify([tool.runId, tool.toolCallId]))
            ),
            ...previous.tools,
          ],
          resultRuns: mergeResultRuns(
            previous.resultRuns,
            older.resultRuns ?? []
          ),
        };
      });
      setNextCursor(detail.nextCursor ?? null);
    } catch (failure) {
      if (version === navigationVersion.current)
        setError(
          failure instanceof AgentRequestError
            ? failure
            : new AgentRequestError(500)
        );
    } finally {
      if (version === navigationVersion.current) setLoadingMore(false);
    }
  };
  const refresh = useCallback(async () => {
    if (lastRouteConversation.current)
      await load(lastRouteConversation.current);
  }, [load]);
  return {
    view,
    draftScope,
    appName,
    appDescription,
    textOnly,
    acceptsInputCapabilities,
    humanInput,
    singleTask,
    resultSingleBatch,
    newConversationsEnabled,
    ready,
    busy,
    error,
    unconfirmed,
    editRecovery,
    pendingEdit:
      actorId && pendingSubmissionId
        ? useLangchainDraftStore
            .getState()
            .findSubmission(
              actorId,
              appId,
              view.conversationId || lastRouteConversation.current || 'new'
            )
        : undefined,
    statusCheckExhausted,
    retryStatus: () => setStatusCheckVersion(previous => previous + 1),
    historyLoading,
    historyFailed,
    nextCursor,
    loadingMore,
    loadMore,
    refresh,
    send,
    select,
    remove,
    newConversation: () => {
      if (!busy) void select(null);
    },
  };
}
