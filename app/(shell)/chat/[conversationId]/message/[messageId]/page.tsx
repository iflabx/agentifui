'use client';

import { ChatSessionView } from '@components/chat/session/chat-session-view';
import { agentConversationPath } from '@components/langchain/routing';
import {
  type HistoryMessageMatch,
  getHistoryMessageMatch,
} from '@lib/services/client/messages-api';
import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function HistoryMessagePage() {
  const { conversationId, messageId } = useParams<{
    conversationId: string;
    messageId: string;
  }>();
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  return (
    <HistoryMessage
      key={JSON.stringify([actorEpoch, conversationId, messageId])}
      conversationId={conversationId}
      messageId={messageId}
    />
  );
}

function HistoryMessage({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const t = useTranslations('history.messageSearch');
  const [result, setResult] = useState<HistoryMessageMatch | null>();
  const target = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    void getHistoryMessageMatch(conversationId, messageId).then(response => {
      if (active) setResult(response.success ? response.data : null);
    });
    return () => {
      active = false;
    };
  }, [conversationId, messageId]);

  useEffect(() => {
    if (result) target.current?.focus();
  }, [result]);

  const conversationHref = result
    ? (agentConversationPath({
        id: result.conversationId,
        app_id: result.appId,
        interaction_protocol: result.agent ? 'ag-ui/1.0' : null,
      }) ??
      `/chat/${encodeURIComponent(result.externalId || result.conversationId)}`)
    : null;

  return (
    <ChatSessionView
      as="main"
      appLayout
      composer={null}
      jumpToBottom={false}
      backdrop={false}
    >
      <div className="mx-auto w-full max-w-3xl px-4 pb-8">
        <nav className="mb-4 flex flex-wrap gap-4 text-sm">
          <Link className="underline" href="/chat/history">
            {t('back')}
          </Link>
          {conversationHref && (
            <Link className="underline" href={conversationHref}>
              {t('openConversation')}
            </Link>
          )}
        </nav>
        <h1 className="mb-4 text-xl font-semibold break-words">
          {result?.title || t('savedMessage')}
        </h1>
        {result === undefined ? (
          <p role="status">{t('loading')}</p>
        ) : result === null ? (
          <p role="alert">{t('unavailable')}</p>
        ) : (
          <article
            ref={target}
            tabIndex={-1}
            className="rounded-xl border border-stone-200 bg-white p-4 focus-visible:ring-2 dark:border-stone-600 dark:bg-stone-900"
            aria-label={t(result.role)}
          >
            <h2 className="mb-2 text-sm font-medium">{t(result.role)}</h2>
            <p className="wrap-anywhere whitespace-pre-wrap">
              {result.content}
            </p>
          </article>
        )}
      </div>
    </ChatSessionView>
  );
}
