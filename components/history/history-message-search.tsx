'use client';

import {
  type HistoryMessagePage,
  searchHistoryMessages,
} from '@lib/services/client/messages-api';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export function HistoryMessageSearch({ query }: { query: string }) {
  const t = useTranslations('history.messageSearch');
  const [page, setPage] = useState<HistoryMessagePage>({
    hits: [],
    nextCursor: null,
  });
  const [request, setRequest] = useState<{ cursor?: string }>({});
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const tooLong = [...query].length > 120;

  useEffect(() => {
    if (tooLong) return;
    let active = true;
    const timer = setTimeout(
      async () => {
        const result = await searchHistoryMessages(query, request.cursor);
        if (!active) return;
        if (result.success) {
          const { hits, nextCursor } = result.data;
          setPage(previous => ({
            hits: request.cursor ? [...previous.hits, ...hits] : hits,
            nextCursor,
          }));
        } else {
          setFailed(true);
        }
        setPending(false);
      },
      request.cursor ? 0 : 250
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, request, tooLong]);

  const load = (cursor?: string) => {
    setFailed(false);
    setPending(true);
    setRequest({ cursor });
  };

  return (
    <section className="mb-4 border-b border-stone-200 pb-4 dark:border-stone-700">
      <h2 className="mb-2 text-sm font-medium">{t('title')}</h2>
      {page.hits.length > 0 && (
        <ul className="space-y-2">
          {page.hits.map(hit => (
            <li key={hit.id}>
              <Link
                className="block rounded-lg border border-stone-200 px-3 py-2 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-700"
                href={`/chat/${encodeURIComponent(hit.conversationId)}/message/${encodeURIComponent(hit.id)}`}
              >
                <span className="block truncate text-sm font-medium">
                  {hit.title || t('untitled')}
                </span>
                <span className="block text-sm wrap-anywhere text-stone-600 dark:text-stone-300">
                  {hit.snippet}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(tooLong || pending || failed || page.hits.length === 0) && (
        <p className="mt-2 text-sm" role={failed ? 'alert' : 'status'}>
          {t(
            tooLong
              ? 'tooLong'
              : pending
                ? 'loading'
                : failed
                  ? 'failed'
                  : 'empty'
          )}
        </p>
      )}
      {!tooLong && !pending && (failed || page.nextCursor) && (
        <button
          type="button"
          className="mt-2 text-sm underline"
          onClick={() =>
            load(failed ? request.cursor : (page.nextCursor ?? undefined))
          }
        >
          {t(failed ? 'retry' : 'more')}
        </button>
      )}
    </section>
  );
}
