'use client';

import { AppIntroduction } from '@components/chat-input/app-introduction';
import { useEditResend } from '@components/chat-input/edit-resend';
import { SingleTurnEnd } from '@components/chat-input/single-turn-end';
import { ChatInputView } from '@components/chat-input/view';
import { ChatMessage } from '@components/chat/session/chat-message';
import { ChatSessionHeader } from '@components/chat/session/chat-session-header';
import { ChatSessionView } from '@components/chat/session/chat-session-view';
import {
  useFollowChatOutput,
  useRunProcessSelection,
} from '@components/chat/session/use-session-presentation';
import { toolProcessItem } from '@components/execution-process/adapters';
import { ExecutionProcessDisclosure } from '@components/execution-process/disclosure';
import { ExecutionProcessRow } from '@components/execution-process/row';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { localizeChatModerationMessage } from '@lib/hooks/chat-interface/error-utils';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import {
  agentInputFiles,
  agentRunSaved,
  agentRunSettled,
} from '@lib/services/client/langchain-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { cn } from '@lib/utils';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AgentInteractionCard } from './agent-interaction-card';
import { AgentResultCard } from './agent-result-card';
import { agentTimeline } from './state';
import { editViewPrefix, useAgentChat } from './use-agent-chat';
import { useAgentComposerInput } from './use-agent-composer-input';
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
    if (!loading) syncChatDraftActor(actorId);
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
  const editT = useTranslations('components.chat.editResend');
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
    : activeError.detail?.code === 'AGENT_MESSAGE_TOO_LONG'
      ? editT('tooLong')
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
  const processScope = JSON.stringify([
    actorId,
    actorEpoch,
    appId,
    conversationId,
    chat.draftScope,
  ]);
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
  const [inputHeight, setInputHeight] = useState(160);
  const singleTurnFinished =
    chat.singleTask &&
    Boolean(chat.view.conversationId) &&
    !authLoading &&
    !chat.busy &&
    !chat.historyLoading &&
    !chat.historyFailed &&
    !chat.unconfirmed &&
    (!chat.view.run ||
      (agentRunSettled(chat.view.run) &&
        chat.view.run.executionStatus !== 'waiting')) &&
    !(chat.humanInput && interactions.blocked);
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
  const composerInput = useAgentComposerInput({
    appId,
    actorId,
    scope,
    enabled: chat.acceptsInputCapabilities === true,
    disabled,
    content,
    submissionError: chat.error,
  });
  const edit = useEditResend({
    sourceIds: chat.view.messages.map(message => message.id),
    scope:
      scope && chat.view.conversationId
        ? JSON.stringify([
            actorId,
            actorEpoch,
            appId,
            scope,
            chat.view.conversationId,
          ])
        : null,
    blocked: disabled,
    recovery: chat.editRecovery,
    restore: chat.pendingEdit?.editSourceId
      ? {
          sourceId: chat.pendingEdit.editSourceId,
          text: chat.pendingEdit.content,
          submissionId: chat.pendingEdit.submissionId,
        }
      : undefined,
    onSubmit: async (text, source) =>
      (await chat.send(text, undefined, source.id)) ?? false,
  });
  const pendingSource =
    edit.controls.pending &&
    chat.view.messages.find(
      message => message.id === edit.controls.pending!.sourceId
    );
  const presentation = pendingSource
    ? {
        ...editViewPrefix(chat.view, pendingSource.id),
        messages: [
          ...editViewPrefix(chat.view, pendingSource.id).messages,
          pendingSource,
        ],
      }
    : chat.view;
  const run = presentation.run;
  const lastUserIndex = presentation.messages.findLastIndex(
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
  const timeline = agentTimeline(presentation);
  const processRuns = new Map<string, typeof chat.view.tools>();
  for (const entry of timeline) {
    if (entry.type !== 'tool') continue;
    const key =
      entry.tool.runId || JSON.stringify(['unscoped', entry.tool.toolCallId]);
    processRuns.set(key, [...(processRuns.get(key) || []), entry.tool]);
  }
  const renderedProcessRuns = new Set<string>();
  const process = useRunProcessSelection(processScope, key =>
    processRuns.has(key)
  );

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

  const scroll = useFollowChatOutput({
    scope: chat.draftScope,
    messages: chat.view.messages,
    activity: chat.view.tools,
    paused: Boolean(edit.controls.pending),
  });

  const submit = async () => {
    if (disabled || edit.active || !composerInput.canSubmit) return;
    const text = composerInput.textDisabled ? '' : content;
    const configured = composerInput.configuredInput();
    const accepted = configured
      ? await chat.send(text, draft, undefined, configured)
      : await chat.send(text, draft);
    if (accepted === true && draft)
      useLangchainDraftStore.getState().consumeSnapshot(draft);
  };

  return (
    <ChatSessionView
      as="main"
      className="pt-16 md:pt-12"
      contentClassName=""
      jumpToBottom={false}
      filePreview
      header={
        <ChatSessionHeader title={chat.appName || t('title')}>
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
        </ChatSessionHeader>
      }
      scrollProps={{
        ...scroll,
        style: { paddingBottom: inputHeight + 96 },
        'aria-live': 'polite',
        'aria-busy': chat.busy || chat.historyLoading,
      }}
      composer={
        singleTurnFinished ? (
          <SingleTurnEnd
            href={`/apps/agent-chat/${encodeURIComponent(appId)}`}
            widthClass={widthClass}
            onHeightChange={setInputHeight}
          />
        ) : (
          <ChatInputView
            key={chat.draftScope}
            value={content}
            onValueChange={text => {
              if (scope) useLangchainDraftStore.getState().setText(scope, text);
            }}
            onSubmit={submit}
            disabled={disabled || edit.active}
            textDisabled={composerInput.textDisabled}
            canSubmit={composerInput.canSubmit}
            isProcessing={chat.busy}
            placeholder=""
            scrollableWelcome
            isWelcomeScreen={
              chat.ready &&
              !conversationId &&
              !chat.view.conversationId &&
              chat.view.messages.length === 0 &&
              !chat.busy
            }
            beforeInput={
              <div className="max-h-[40dvh] overflow-y-auto">
                {chat.ready && !conversationId && !chat.view.conversationId && (
                  <AppIntroduction
                    name={chat.appName}
                    description={chat.appDescription}
                  />
                )}
                {composerInput.parameters}
              </div>
            }
            attachmentAction={composerInput.action}
            attachmentPreview={composerInput.preview}
            editNotice={composerInput.notice}
            sendButtonAriaLabel={t('send')}
            widthClass={widthClass}
            onHeightChange={setInputHeight}
          />
        )
      }
    >
      <div className={cn('mx-auto w-full pt-4', widthClass, paddingClass)}>
        {chat.historyLoading && <p role="status">{t('loading')}</p>}
        {chat.textOnly && (
          <p role="note" className="mb-3 text-sm text-stone-500">
            {t('textOnlyNote')}
          </p>
        )}
        {chat.newConversationsEnabled === false &&
          !chat.view.conversationId && <p role="status">{t('unavailable')}</p>}
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
                    placement="panel"
                    open={process.selected === runKey}
                    onOpenChange={open => process.setOpen(runKey, open)}
                    title={tool.name}
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
          const index = presentation.messages.indexOf(message);
          const files = agentInputFiles(message);
          return message.role === 'user' ? (
            <ChatMessage
              role="user"
              key={message.id}
              id={message.id}
              content={message.content}
              conversationAppId={appId}
              attachments={files.map(file => ({
                ...file,
                upload_file_id: file.id,
                app_id: appId,
                source: 'agent-input',
              }))}
              onEdit={
                chat.view.conversationId &&
                !chat.singleTask &&
                !files.length &&
                message.content.trim()
                  ? () =>
                      edit.controls.start({
                        id: message.id,
                        text: message.content,
                      })
                  : undefined
              }
              editDisabled={edit.controls.disabled}
              editor={
                edit.controls.sourceId === message.id
                  ? edit.controls.editor
                  : undefined
              }
            />
          ) : message.role === 'assistant' && message.content ? (
            <Fragment key={message.id}>
              <ChatMessage
                role="assistant"
                id={message.id}
                content={message.content}
                isStreaming={
                  index > lastUserIndex &&
                  chat.busy &&
                  (!run || ['pending', 'running'].includes(run.executionStatus))
                }
                wasManuallyStopped={false}
              />
              {(() => {
                const runId = message.metadata?.backend_run_id;
                const next = presentation.messages[index + 1];
                if (
                  typeof runId !== 'string' ||
                  (next?.metadata?.backend_run_id === runId &&
                    next.role === 'assistant')
                )
                  return null;
                const results = (presentation.resultRuns ?? []).filter(
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
        {(presentation.resultRuns ?? [])
          .filter(
            resultRun =>
              !renderedResultIds.has(resultRun.id || resultRun.runId || '')
          )
          .map(resultRun => (
            <AgentResultCard
              key={`result-${resultRun.id || resultRun.runId}`}
              appId={appId}
              run={resultRun}
              autoQuery={liveResultRunId === (resultRun.id || resultRun.runId)}
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
    </ChatSessionView>
  );
}
