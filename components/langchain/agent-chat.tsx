'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { agentRunSaved } from '@lib/services/client/langchain-api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { useAgentChat } from './use-agent-chat';

export function AgentChat({
  appId,
  conversationId,
}: {
  appId: string;
  conversationId: string | null;
}) {
  const t = useTranslations('langchain');
  const { session, loading } = useAuthSession();
  const chat = useAgentChat(appId, conversationId);
  const [content, setContent] = useState('');
  const disabled =
    !chat.ready ||
    chat.busy ||
    chat.historyLoading ||
    chat.historyFailed ||
    chat.unconfirmed ||
    !session;
  const buttonStyle =
    'rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-stone-600';
  const run = chat.view.run;
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

  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col p-4 font-serif text-stone-800 md:p-6 dark:text-stone-200">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
        <header className="shrink-0 border-b border-stone-200 px-4 py-3 dark:border-stone-700">
          <h1 className="text-lg font-semibold">
            {chat.appName || t('title')}
          </h1>
          <p className="text-xs text-stone-500">{t('capabilities')}</p>
        </header>
        <div
          className="flex-1 space-y-5 overflow-y-auto p-4 md:p-6"
          aria-live="polite"
          aria-busy={chat.busy || chat.historyLoading}
        >
          {loading && <p>{t('loading')}</p>}
          {chat.historyLoading && <p role="status">{t('loading')}</p>}
          {!loading && !session && (
            <a className="underline" href="/login">
              {t('loginRequired')}
            </a>
          )}
          {chat.error && (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {t(
                chat.error === 401
                  ? 'loginRequired'
                  : [403, 404].includes(chat.error)
                    ? 'unavailable'
                    : chat.error === 429
                      ? 'rateLimited'
                      : 'requestFailed'
              )}
            </p>
          )}
          {chat.view.messages.map(message => (
            <article
              key={message.id}
              className={`rounded-xl p-4 ${message.role === 'user' ? 'bg-stone-100 dark:bg-stone-800' : 'border border-stone-100 dark:border-stone-800'}`}
            >
              <p className="mb-2 text-xs font-semibold text-stone-500">
                {t(message.role === 'user' ? 'you' : 'assistant')}
              </p>
              <div className="prose prose-stone dark:prose-invert max-w-none break-words">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    img: () => null,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            </article>
          ))}
          {chat.view.tools.map(tool => (
            <div
              key={tool.toolCallId}
              className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-700"
            >
              <strong>
                {t('tool')}: {tool.name}
              </strong>
              <p>{tool.status}</p>
              {tool.summary && (
                <p className="break-words whitespace-pre-wrap text-stone-500">
                  {tool.summary}
                </p>
              )}
            </div>
          ))}
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
        </div>
        <form
          className="space-y-3 border-t border-stone-200 p-4 dark:border-stone-700"
          onSubmit={event => {
            event.preventDefault();
            if (!disabled && content.trim()) {
              const submitted = content;
              void chat.send(submitted).then(accepted => {
                if (accepted)
                  setContent(current => (current === submitted ? '' : current));
              });
            }
          }}
        >
          <label htmlFor="agent-message" className="sr-only">
            {t('message')}
          </label>
          <textarea
            id="agent-message"
            name="message"
            rows={3}
            maxLength={16000}
            value={content}
            onChange={event => setContent(event.target.value)}
            disabled={disabled}
            placeholder={t('placeholder')}
            className="w-full resize-y rounded-lg border border-stone-300 bg-transparent p-3 disabled:opacity-50 dark:border-stone-600"
          />
          <div className="flex justify-between gap-3">
            <button
              type="button"
              className={buttonStyle}
              disabled={disabled || !chat.view.conversationId}
              onClick={() => {
                if (window.confirm(t('confirmDelete'))) void chat.remove();
              }}
            >
              {t('deleteConversation')}
            </button>
            <button
              type="submit"
              className={buttonStyle}
              disabled={disabled || !content.trim()}
            >
              {t('send')}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
