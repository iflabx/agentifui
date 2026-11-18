'use client';

import { ChatInputView } from '@components/chat-input/view';
import { ChatInputBackdrop } from '@components/chat/chat-input-backdrop';
import { AssistantMessage } from '@components/chat/messages/assistant-message/assistant-message';
import { UserMessage } from '@components/chat/messages/user-message/user-message';
import { toolProcessItem } from '@components/execution-process/adapters';
import { ExecutionProcessDisclosure } from '@components/execution-process/disclosure';
import { ExecutionProcessRow } from '@components/execution-process/row';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { localizeChatModerationMessage } from '@lib/hooks/chat-interface/error-utils';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { agentRunSaved } from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { cn } from '@lib/utils';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AgentInteractionCard } from './agent-interaction-card';
import { AgentResultCard } from './agent-result-card';
import { agentTimeline } from './state';
import { useAgentChat } from './use-agent-chat';
import { useAgentInteractions } from './use-agent-interactions';

interface AgentChatProps {
  appId: string;
  conversationId: string | null;
}

export function AgentChat(props: AgentChatProps) {
  const actorEpoch = useLangchainDraftStore(state => state.actorEpoch);
  const { session, loading } = useAuthSession();
  const t = useTranslations('langchain');
  const actorId = session?.user.id ?? null;
  useLayoutEffect(() => {
    if (!loading) useLangchainDraftStore.getState().setActor(actorId);
  }, [actorId, loading]);
  if (!session)
    return loading ? (
      <p role="status">{t('loading')}</p>
    ) : (
      <a href="/login">{t('loginRequired')}</a>
    );
  return (
    <AgentChatSession
      key={JSON.stringify([session.user.id, props.appId, actorEpoch])}
      {...props}
      actorId={session.user.id}
      authLoading={loading}
    />
  );
}

function AgentChatSession({
  appId,
  conversationId,
  actorId,
  authLoading,
}: AgentChatProps & { actorId: string; authLoading: boolean }) {
  const t = useTranslations('langchain');
  const chat = useAgentChat(appId, conversationId, actorId);
  const [liveResultRunId, setLiveResultRunId] = useState<string>();
  useEffect(() => {
    if (chat.historyLoading || !chat.view.runId) setLiveResultRunId(undefined);
    else if (chat.busy) setLiveResultRunId(chat.view.runId);
  }, [chat.busy, chat.historyLoading, chat.view.runId]);
  const interactions = useAgentInteractions({
    appId,
    conversationId: chat.view.conversationId,
    actorId,
    enabled: chat.humanInput,
    revision: JSON.stringify([
      chat.busy,
      chat.view.runId,
      chat.view.run?.executionStatus,
      chat.view.run?.persistenceStatus,
    ]),
    onUpdated: chat.refresh,
  });
  const moderationT = useTranslations('errors.system.moderation');
  const activeError = chat.error || interactions.responseError;
  const uiError = activeError?.detail
    ? toUiError(activeError, t('requestFailed'), 'agent-generic')
    : null;
  const errorMessage = !activeError
    ? null
    : activeError.status === 401
      ? t('loginRequired')
      : [403, 404].includes(activeError.status)
        ? t('unavailable')
        : uiError
          ? localizeChatModerationMessage(uiError, moderationT) ||
            formatUiErrorMessage({
              ...uiError,
              message:
                activeError.detail?.code === 'AGENT_RESULT_PROFILE_DISABLED'
                  ? t('resultProfilePaused')
                  : uiError.message === uiError.code
                    ? t('requestFailed')
                    : uiError.message,
            })
          : t('requestFailed');
  const { widthClass, paddingClass } = useChatWidth();
  const actorEpoch = useLangchainDraftStore(state =>
    state.actorId === actorId ? state.actorEpoch : null
  );
  const [selection, setSelection] = useState<{
    epoch: number;
    target: string;
    scope: string;
  } | null>(null);
  const lastSelection = useRef(selection);
  const scope =
    selection?.epoch === actorEpoch && selection?.target === chat.draftScope
      ? selection.scope
      : null;
  const draft = useLangchainDraftStore(state =>
    scope ? state.drafts[scope] : undefined
  );
  const content = draft?.text || '';
  const scrollArea = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [inputHeight, setInputHeight] = useState(160);
  const disabled =
    authLoading ||
    !scope ||
    !chat.ready ||
    (chat.newConversationsEnabled === false && !chat.view.conversationId) ||
    chat.busy ||
    chat.historyLoading ||
    chat.historyFailed ||
    chat.unconfirmed ||
    (chat.humanInput && interactions.blocked) ||
    (chat.singleTask && Boolean(chat.view.conversationId));
  const run = chat.view.run;
  const lastUserIndex = chat.view.messages.findLastIndex(
    message => message.role === 'user'
  );
  const runLabel = !run
    ? null
    : run.executionStatus === 'waiting'
      ? 'confirmationWaiting'
      : agentRunSaved(run)
        ? 'saved'
        : run.executionStatus === 'success'
          ? 'saveIncomplete'
          : run.executionStatus === 'interrupted'
            ? 'interrupted'
            : run.executionStatus === 'cancelled'
              ? 'cancelled'
              : ['failed', 'error', 'timeout'].includes(run.executionStatus)
                ? 'failed'
                : run.executionStatus === 'unknown'
                  ? 'unknown'
                  : 'running';
  const renderedResultIds = new Set<string>();
  const timeline = agentTimeline(chat.view);
  const processRuns = new Map<string, typeof chat.view.tools>();
  for (const entry of timeline) {
    if (entry.type !== 'tool') continue;
    const key =
      entry.tool.runId || JSON.stringify(['unscoped', entry.tool.toolCallId]);
    processRuns.set(key, [...(processRuns.get(key) || []), entry.tool]);
  }
  const renderedProcessRuns = new Set<string>();

  useLayoutEffect(() => {
    if (actorEpoch === null || authLoading) return;
    const previous = lastSelection.current;
    if (previous?.epoch === actorEpoch && previous.target === chat.draftScope)
      return;
    const scope = useLangchainDraftStore
      .getState()
      .selectScope(
        appId,
        chat.draftScope.startsWith('new:') && conversationId
          ? conversationId
          : chat.draftScope,
        previous?.epoch === actorEpoch
      );
    if (!scope) return;
    const next = { epoch: actorEpoch, target: chat.draftScope, scope };
    lastSelection.current = next;
    setSelection(next);
  }, [actorEpoch, appId, authLoading, chat.draftScope, conversationId]);

  useLayoutEffect(() => {
    if (scope && chat.draftScope.startsWith('new:') && chat.view.conversationId)
      useLangchainDraftStore
        .getState()
        .bindConversation(scope, appId, chat.view.conversationId);
  }, [scope, appId, chat.draftScope, chat.view.conversationId]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area && following.current) area.scrollTop = area.scrollHeight;
  }, [chat.view.messages, chat.view.tools, chat.draftScope]);

  const submit = async () => {
    if (disabled || !content.trim() || !draft) return;
    const snapshot = draft;
    const accepted = await chat.send(content, snapshot);
    if (accepted) useLangchainDraftStore.getState().consumeSnapshot(snapshot);
  };

  return (
    <main className="relative flex h-full min-h-0 w-full flex-col pt-16 text-stone-800 md:pt-12 dark:text-stone-200">
      <header
        className={cn(
          'mx-auto flex w-full shrink-0 items-center justify-between gap-3 py-3',
          widthClass,
          paddingClass
        )}
      >
        <h1 className="text-sm font-medium">{chat.appName || t('title')}</h1>
        <button
          type="button"
          className="text-xs text-stone-500 disabled:opacity-50"
          disabled={
            authLoading ||
            chat.busy ||
            chat.historyLoading ||
            chat.unconfirmed ||
            (chat.humanInput && interactions.blocked) ||
            !chat.view.conversationId
          }
          onClick={() => {
            if (window.confirm(t('confirmDelete'))) void chat.remove();
          }}
        >
          {t('deleteConversation')}
        </button>
      </header>
      <div
        ref={scrollArea}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: inputHeight + 96 }}
        aria-live="polite"
        aria-busy={chat.busy || chat.historyLoading}
        onScroll={() => {
          const area = scrollArea.current;
          if (area)
            following.current =
              area.scrollHeight - area.scrollTop - area.clientHeight < 100;
        }}
      >
        <div className={cn('mx-auto w-full pt-4', widthClass, paddingClass)}>
          {chat.historyLoading && <p role="status">{t('loading')}</p>}
          {chat.textOnly && (
            <p role="note" className="mb-3 text-sm text-stone-500">
              {t('textOnlyNote')}
            </p>
          )}
          {chat.newConversationsEnabled === false &&
            !chat.view.conversationId && (
              <p role="status">{t('unavailable')}</p>
            )}
          {chat.nextCursor && (
            <button
              type="button"
              disabled={chat.loadingMore || chat.busy}
              onClick={() => void chat.loadMore()}
              className="my-2 text-sm underline"
            >
              {t(chat.loadingMore ? 'loading' : 'loadMore')}
            </button>
          )}
          {errorMessage && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {errorMessage}
            </p>
          )}
          {timeline.map(item => {
            if (item.type === 'tool') {
              const tool = item.tool;
              const runKey =
                tool.runId || JSON.stringify(['unscoped', tool.toolCallId]);
              const showProcessEntry = !renderedProcessRuns.has(runKey);
              renderedProcessRuns.add(runKey);
              const activities = processRuns.get(runKey) || [tool];
              const historicalProcess =
                chat.historyLoading ||
                !chat.busy ||
                !tool.runId ||
                tool.runId !== chat.view.runId;
              return (
                <div
                  key={JSON.stringify([tool.runId, tool.toolCallId])}
                  className="my-3"
                >
                  <ExecutionProcessRow
                    item={toolProcessItem(tool, historicalProcess)}
                  />
                  {tool.order === undefined && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {t('toolSummary')}
                    </p>
                  )}
                  {showProcessEntry && (
                    <ExecutionProcessDisclosure
                      key={JSON.stringify([
                        actorId,
                        appId,
                        conversationId,
                        chat.draftScope,
                        runKey,
                      ])}
                      items={activities.map(activity =>
                        toolProcessItem(activity, historicalProcess)
                      )}
                      historical={historicalProcess}
                      unordered={activities.some(
                        activity => activity.order === undefined
                      )}
                    />
                  )}
                </div>
              );
            }
            const { message } = item;
            const index = chat.view.messages.indexOf(message);
            return message.role === 'user' ? (
              <UserMessage
                key={message.id}
                id={message.id}
                content={message.content}
                conversationAppId={appId}
              />
            ) : message.role === 'assistant' && message.content ? (
              <Fragment key={message.id}>
                <AssistantMessage
                  id={message.id}
                  content={message.content}
                  isStreaming={
                    index > lastUserIndex &&
                    chat.busy &&
                    (!run ||
                      ['pending', 'running'].includes(run.executionStatus))
                  }
                  wasManuallyStopped={false}
                />
                {(() => {
                  const runId = message.metadata?.backend_run_id;
                  const next = chat.view.messages[index + 1];
                  if (
                    typeof runId !== 'string' ||
                    (next?.metadata?.backend_run_id === runId &&
                      next.role === 'assistant')
                  )
                    return null;
                  const results = (chat.view.resultRuns ?? []).filter(
                    resultRun => (resultRun.id || resultRun.runId) === runId
                  );
                  results.forEach(resultRun =>
                    renderedResultIds.add(resultRun.id || resultRun.runId || '')
                  );
                  return results.map(resultRun => (
                    <AgentResultCard
                      key={`result-${resultRun.id || resultRun.runId}`}
                      appId={appId}
                      run={resultRun}
                      autoQuery={
                        liveResultRunId === (resultRun.id || resultRun.runId)
                      }
                    />
                  ));
                })()}
              </Fragment>
            ) : null;
          })}
          {(chat.view.resultRuns ?? [])
            .filter(
              resultRun =>
                !renderedResultIds.has(resultRun.id || resultRun.runId || '')
            )
            .map(resultRun => (
              <AgentResultCard
                key={`result-${resultRun.id || resultRun.runId}`}
                appId={appId}
                run={resultRun}
                autoQuery={
                  liveResultRunId === (resultRun.id || resultRun.runId)
                }
              />
            ))}
          {runLabel && (
            <p role="status" className="text-sm text-stone-500">
              {t(runLabel)}
            </p>
          )}
          {interactions.items.map(interaction => (
            <AgentInteractionCard
              key={JSON.stringify([actorId, appId, interaction.id])}
              interaction={interaction}
              disabled={
                authLoading ||
                chat.busy ||
                chat.historyLoading ||
                interactions.loading ||
                interactions.error ||
                Boolean(interactions.submittingId || interactions.uncertainId)
              }
              uncertain={interactions.uncertainId === interaction.id}
              onRespond={interactions.respond}
            />
          ))}
          {interactions.notDispatched && (
            <p
              role="status"
              className="my-3 text-sm text-amber-700 dark:text-amber-300"
            >
              {t('confirmationNotDispatched')}
            </p>
          )}
          {chat.humanInput &&
            (interactions.error ||
              interactions.exhausted ||
              interactions.uncertainId ||
              interactions.processing ||
              interactions.items.some(
                item =>
                  ['submitting', 'unknown', 'expired'].includes(item.status) ||
                  (item.status === 'pending' && item.expiresAt !== null)
              )) && (
              <div className="my-3 text-sm">
                <p role="status">{t('confirmationUnknown')}</p>
                <button
                  type="button"
                  onClick={interactions.check}
                  disabled={interactions.loading}
                  className="mt-2 underline disabled:opacity-50"
                >
                  {t('retryStatus')}
                </button>
              </div>
            )}
          {chat.resultSingleBatch && (
            <p className="mt-3 text-sm text-stone-500">
              {t('resultSingleBatch')}
            </p>
          )}
          {chat.singleTask && chat.view.conversationId && (
            <p className="mt-3 text-sm text-stone-500">
              {t('confirmationSingleTask')}
            </p>
          )}
          {chat.unconfirmed && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t('noAutomaticRetry')}
            </p>
          )}
          {chat.unconfirmed && !chat.busy && (
            <div>
              {chat.statusCheckExhausted && (
                <p role="status">{t('statusCheckExhausted')}</p>
              )}
              <button
                type="button"
                onClick={chat.retryStatus}
                className="my-2 text-sm underline"
              >
                {t('retryStatus')}
              </button>
            </div>
          )}
        </div>
      </div>
      <ChatInputBackdrop />
      <ChatInputView
        key={chat.draftScope}
        value={content}
        onValueChange={text => {
          if (scope) useLangchainDraftStore.getState().setText(scope, text);
        }}
        onSubmit={submit}
        disabled={disabled}
        isProcessing={chat.busy}
        placeholder={t('placeholder')}
        sendButtonAriaLabel={t('send')}
        widthClass={widthClass}
        onHeightChange={setInputHeight}
      />
    </main>
  );
}
