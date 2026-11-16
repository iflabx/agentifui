'use client';

import { SourceListItem } from '@components/chat/source-list';
import { PreviewShell } from '@components/file-preview/preview-shell';
import { MarkdownPreview } from '@components/file-preview/previews/markdown-preview';
import {
  type AgentDeliverableArtifact,
  type AgentRun,
  agentArtifactRequest,
} from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { Copy, Download, FileText, Loader2, Table2 } from 'lucide-react';

import { useEffect, useId, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { CSV_INPUT_BYTES, parseResultCsv } from './agent-result-csv';
import {
  type ResultNotice,
  resultNotice,
  resultNoticeCode,
  useResultManifest,
} from './agent-result-query';

export function AgentResultCard(props: {
  appId: string;
  run: AgentRun;
  autoQuery?: boolean;
}) {
  const actorEpoch = useLangchainDraftStore(state => state.actorEpoch);
  const actorId = useLangchainDraftStore(state => state.actorId);
  const pathname = usePathname();
  return (
    <ScopedResultCard
      key={JSON.stringify([
        actorId,
        actorEpoch,
        pathname,
        props.appId,
        props.run.conversationId,
        props.run.id || props.run.runId,
      ])}
      {...props}
    />
  );
}

function ScopedResultCard({
  appId,
  run,
  autoQuery = false,
}: {
  appId: string;
  run: AgentRun;
  autoQuery?: boolean;
}) {
  const t = useTranslations('langchain.results');
  const card = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const anchor = useId();
  const {
    manifest,
    notice,
    loading: querying,
    query,
  } = useResultManifest(appId, run, card, autoQuery);
  const [selected, setSelected] = useState<AgentDeliverableArtifact | null>(
    null
  );
  const [content, setContent] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileNotice, setFileNotice] = useState<ResultNotice | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const runId = run.id || run.runId || '';

  const close = () => {
    previewController.current?.abort();
    previewController.current = null;
    downloadController.current?.abort();
    downloadController.current = null;
    setSelected(null);
    setContent(null);
    setLoading(false);
    setDownloading(false);
  };

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) close();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      previewController.current?.abort();
      downloadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (manifest?.resultStatus === 'ready') setFileNotice(null);
  }, [manifest]);

  useEffect(() => {
    if (notice && notice !== 'pending' && notice !== 'saveFailed') close();
  }, [notice]);

  const load = async (
    artifact: AgentDeliverableArtifact,
    element: HTMLElement
  ) => {
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    trigger.current = element;
    setSelected(artifact);
    setContent(null);
    setFileNotice(null);
    setLoading(true);
    try {
      const response = await agentArtifactRequest(
        appId,
        runId,
        artifact.artifactId,
        controller.signal
      );
      if (controller.signal.aborted) return;
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      setContent(blob);
    } catch (error) {
      if (!controller.signal.aborted) {
        const next = resultNotice(error);
        setFileNotice(next);
        if (next === 'integrity') {
          downloadController.current?.abort();
          downloadController.current = null;
          setDownloading(false);
        }
      }
    } finally {
      if (previewController.current === controller) {
        previewController.current = null;
        setLoading(false);
      }
    }
  };

  const download = async (artifact: AgentDeliverableArtifact) => {
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setFileNotice(null);
    try {
      const response = await agentArtifactRequest(
        appId,
        runId,
        artifact.artifactId,
        controller.signal
      );
      if (controller.signal.aborted) return;
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = artifact.filename;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const next = resultNotice(error);
        setFileNotice(next);
        if (next === 'integrity') {
          previewController.current?.abort();
          previewController.current = null;
          setLoading(false);
          setContent(null);
        }
      }
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        setDownloading(false);
      }
    }
  };

  const copy = async (title: string, excerpt: string) => {
    try {
      await navigator.clipboard.writeText(`${title}\n${excerpt}`);
      setCopyNotice(t('copied'));
    } catch {
      setCopyNotice(t('copyFailed'));
    }
  };
  const status =
    notice ??
    (manifest?.resultStatus === 'pending'
      ? 'pending'
      : manifest?.resultStatus === 'unavailable'
        ? resultNoticeCode(manifest.reason)
        : null);
  const blocked = fileNotice === 'integrity' || notice === 'integrity';

  if (!runId || (!manifest && !run.deliverablesQueryAvailable)) return null;

  return (
    <section
      ref={card}
      id={anchor}
      tabIndex={-1}
      aria-label={t('title')}
      className="my-4 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-900/40"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <button
          type="button"
          className="rounded-md border border-stone-300 px-3 py-1.5 text-xs disabled:opacity-50 dark:border-stone-600"
          onClick={() => void query()}
          disabled={querying}
        >
          {querying ? t('loading') : t('find')}
        </button>
      </div>
      {status && (
        <p role="status" className="mt-2 text-sm">
          {t(status)}
        </p>
      )}
      {fileNotice && (
        <p
          role="alert"
          className="mt-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {t(fileNotice)}
        </p>
      )}
      {manifest?.resultStatus === 'ready' && (
        <>
          <p className="mt-2 text-xs text-stone-500">{t('saved')}</p>
          {run.executionStatus === 'unknown' && (
            <p role="status" className="mt-2 text-sm">
              {t('foundUnknown')}
            </p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {manifest.artifacts.map(artifact => (
              <div
                key={artifact.artifactId}
                className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
              >
                <button
                  type="button"
                  disabled={blocked}
                  aria-label={t('preview', { filename: artifact.filename })}
                  className="flex min-w-0 items-center gap-2 text-left text-sm underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={event => void load(artifact, event.currentTarget)}
                >
                  {artifact.mediaType === 'text/markdown' ? (
                    <FileText className="h-4 w-4 shrink-0" />
                  ) : (
                    <Table2 className="h-4 w-4 shrink-0" />
                  )}
                  <span className="min-w-0 truncate">
                    {artifact.filename}
                    <span className="ml-2 text-xs text-stone-500">
                      {artifact.mediaType} · {artifact.sizeBytes} B
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={blocked || downloading}
                  className="shrink-0 rounded p-1 text-stone-500 disabled:opacity-50"
                  aria-label={t('download', { filename: artifact.filename })}
                  onClick={() => void download(artifact)}
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
            {t('formulaWarning')}
          </p>
          {manifest.sources.length > 0 && (
            <div className="mt-3 text-xs text-stone-600 dark:text-stone-400">
              <h3 className="font-medium">{t('sources')}</h3>
              {manifest.sources.map(source => (
                <SourceListItem
                  key={source.sourceId}
                  className="mt-2"
                  title={source.title}
                  titleClassName="font-medium"
                  excerpt={source.excerpt}
                  excerptClassName="whitespace-pre-wrap"
                  copyAriaLabel={t('copySource', { title: source.title })}
                  copyClassName="mt-1 inline-flex items-center gap-1 underline"
                  onCopy={() => void copy(source.title, source.excerpt)}
                  copyIcon={<Copy className="h-3 w-3" />}
                  copyLabel={t('copy')}
                />
              ))}
              <p role="status">{copyNotice}</p>
            </div>
          )}
        </>
      )}
      <PreviewShell
        open={Boolean(selected)}
        title={selected?.filename || t('title')}
        onClose={close}
        returnFocusRef={trigger}
        returnLabel={t('returnToResult')}
        onReturn={() => {
          close();
          card.current?.scrollIntoView?.({ block: 'center' });
        }}
      >
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loading')}
          </p>
        )}
        {fileNotice && (
          <p
            role="alert"
            className="text-sm text-amber-700 dark:text-amber-300"
          >
            {t(fileNotice)}
          </p>
        )}
        {content &&
          selected &&
          !loading &&
          !blocked &&
          (selected.mediaType === 'text/markdown' ? (
            <MarkdownPreview
              content={content}
              filename={selected.filename}
              onDownload={() => void download(selected)}
              allowImages={false}
            />
          ) : (
            <CsvPreview content={content} />
          ))}
      </PreviewShell>
    </section>
  );
}

function CsvPreview({ content }: { content: Blob }) {
  const t = useTranslations('langchain.results');
  const [parsed, setParsed] = useState<ReturnType<
    typeof parseResultCsv
  > | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setParsed(null);
    setFailed(false);
    void content
      .slice(0, CSV_INPUT_BYTES)
      .text()
      .then(text => {
        if (active)
          setParsed(parseResultCsv(text, content.size > CSV_INPUT_BYTES));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [content]);
  if (failed) return <p role="alert">{t('unavailable')}</p>;
  if (!parsed) return <p role="status">{t('loading')}</p>;
  return (
    <div>
      {parsed.truncated && (
        <p role="status" className="mb-2 text-sm">
          {t('truncated')}
        </p>
      )}
      <div className="overflow-auto rounded-md border border-stone-200 dark:border-stone-700">
        <table
          aria-label={t('csvTable')}
          className="w-full border-collapse text-left text-xs"
        >
          <tbody>
            {parsed.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="max-w-xs min-w-24 border border-stone-200 p-2 align-top break-words whitespace-pre-wrap dark:border-stone-700"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
