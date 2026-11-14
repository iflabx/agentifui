'use client';

import { ChatInputView } from '@components/chat-input/view';
import { ChatInputBackdrop } from '@components/chat/chat-input-backdrop';
import { AssistantMessage } from '@components/chat/messages/assistant-message/assistant-message';
import { UserMessage } from '@components/chat/messages/user-message/user-message';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { formatUiErrorMessage, toUiError } from '@lib/errors/ui-error';
import { localizeChatModerationMessage } from '@lib/hooks/chat-interface/error-utils';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { agentRunSaved } from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { cn } from '@lib/utils';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { agentTimeline } from './state';
import { useAgentChat } from './use-agent-chat';

interface AgentChatProps {
  appId: string;
  conversationId: string | null;
}

export function AgentChat(props: AgentChatProps) {
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
      key={JSON.stringify([session.user.id, props.appId])}
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
  const chat = useAgentChat(appId, conversationId);
  const moderationT = useTranslations('errors.system.moderation');
  const uiError = chat.error?.detail
    ? toUiError(chat.error, t('requestFailed'), 'agent-generic')
    : null;
  const errorMessage = !chat.error
    ? null
    : chat.error.status === 401
      ? t('loginRequired')
      : [403, 404].includes(chat.error.status)
        ? t('unavailable')
        : uiError
          ? localizeChatModerationMessage(uiError, moderationT) ||
            formatUiErrorMessage({
              ...uiError,
              message:
                uiError.message === uiError.code
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
    chat.busy ||
    chat.historyLoading ||
    chat.historyFailed ||
    chat.unconfirmed;
  const run = chat.view.run;
  const lastUserIndex = chat.view.messages.findLastIndex(
    message => message.role === 'user'
  );
  const runLabel = !run
    ? null
    : agentRunSaved(run)
      ? 'saved'
      : run.executionStatus === 'success'
        ? 'saveIncomplete'
        : ['failed', 'error', 'timeout', 'interrupted', 'cancelled'].includes(
              run.executionStatus
            )
          ? 'failed'
          : run.executionStatus === 'unknown'
            ? 'unknown'
            : 'running';

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
    const accepted = await chat.send(content);
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
          disabled={disabled || !chat.view.conversationId}
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
          {errorMessage && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {errorMessage}
            </p>
          )}
          {agentTimeline(chat.view).map(item => {
            if (item.type === 'tool') {
              const tool = item.tool;
              return (
                <div
                  key={JSON.stringify([tool.runId, tool.toolCallId])}
                  className="my-3 rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-700"
                >
                  <strong>
                    {t(tool.order === undefined ? 'toolSummary' : 'tool')}:{' '}
                    {tool.name}
                  </strong>
                  <p>{tool.status}</p>
                  {tool.summary && (
                    <p className="break-words whitespace-pre-wrap text-stone-500">
                      {tool.summary}
                    </p>
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
              <AssistantMessage
                key={message.id}
                id={message.id}
                content={message.content}
                isStreaming={
                  index > lastUserIndex &&
                  chat.busy &&
                  (!run || ['pending', 'running'].includes(run.executionStatus))
                }
                wasManuallyStopped={false}
              />
            ) : null;
          })}
          {runLabel && (
            <p role="status" className="text-sm text-stone-500">
              {t(runLabel)}
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
