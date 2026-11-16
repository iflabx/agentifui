'use client';

import {
  type AgentDeliverables,
  AgentRequestError,
  type AgentRun,
  agentDeliverablesRequest,
} from '@lib/services/client/langchain-api';

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export type ResultNotice =
  | 'pending'
  | 'saveFailed'
  | 'notPublished'
  | 'notFound'
  | 'integrity'
  | 'unavailable';

export function resultNotice(error: unknown): ResultNotice {
  return resultNoticeCode(
    error instanceof AgentRequestError ? error.detail?.code : undefined
  );
}

export function resultNoticeCode(value?: string | null): ResultNotice {
  const code = value?.toLowerCase();
  if (code?.includes('pending')) return 'pending';
  if (code && /save_failed|save_failure|persistence_failed/.test(code))
    return 'saveFailed';
  if (code && /not_published|unpublished/.test(code)) return 'notPublished';
  if (code && /not_found|removed/.test(code)) return 'notFound';
  if (
    code &&
    /integrity|hash|checksum|mime|size_mismatch|length_mismatch/.test(code)
  )
    return 'integrity';
  return 'unavailable';
}

let stopSelectedPolling: (() => void) | undefined;

export function useResultManifest(
  appId: string,
  run: AgentRun,
  card: RefObject<HTMLElement | null>,
  autoQuery = false
) {
  const runId = run.id || run.runId || '';
  const [queried, setQueried] = useState<AgentDeliverables>();
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const manifest =
    run.deliverables?.resultStatus === 'ready' &&
    queried?.resultStatus !== 'ready'
      ? run.deliverables
      : (queried ?? run.deliverables);
  const eligible = Boolean(
    runId && (run.deliverablesQueryAvailable || manifest)
  );
  const current = useRef({ visible, eligible });
  useEffect(() => {
    current.current = { visible, eligible };
  }, [visible, eligible]);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const terminalQueried = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    deadline.current = 0;
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
  }, []);

  const query = useCallback(
    async function request(start = true): Promise<void> {
      if (
        !current.current.eligible ||
        !current.current.visible ||
        document.hidden ||
        controller.current
      )
        return;
      if (start) {
        stopSelectedPolling?.();
        stopSelectedPolling = stop;
        deadline.current = Date.now() + 60_000;
      }
      const requestController = new AbortController();
      controller.current = requestController;
      setLoading(true);
      setNotice(null);
      let pending = false;
      try {
        const result = await agentDeliverablesRequest(
          appId,
          runId,
          requestController.signal
        );
        if (requestController.signal.aborted) return;
        setQueried(result.deliverables);
        pending = result.deliverables.resultStatus === 'pending';
        if (result.deliverables.resultStatus === 'unavailable')
          setNotice(resultNoticeCode(result.deliverables.reason));
      } catch (error) {
        if (requestController.signal.aborted) return;
        const nextNotice = resultNotice(error);
        setNotice(nextNotice);
        pending = nextNotice === 'pending';
      } finally {
        if (controller.current === requestController) {
          controller.current = null;
          setLoading(false);
        }
        if (
          !requestController.signal.aborted &&
          pending &&
          stopSelectedPolling === stop &&
          Date.now() + 3000 <= deadline.current
        ) {
          timer.current = setTimeout(() => {
            timer.current = null;
            if (Date.now() <= deadline.current && stopSelectedPolling === stop)
              void request(false);
          }, 3000);
        }
      }
    },
    [appId, runId, stop]
  );

  useEffect(() => {
    const element = card.current;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    });
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [card, eligible]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
      if (stopSelectedPolling === stop) stopSelectedPolling = undefined;
    };
  }, [stop]);

  useEffect(() => {
    if (!visible || !eligible) stop();
    if (
      autoQuery &&
      visible &&
      eligible &&
      !document.hidden &&
      !terminalQueried.current &&
      [
        'success',
        'failed',
        'error',
        'timeout',
        'interrupted',
        'cancelled',
      ].includes(run.executionStatus) &&
      manifest?.resultStatus !== 'ready'
    ) {
      terminalQueried.current = true;
      void query();
    }
  }, [
    autoQuery,
    visible,
    eligible,
    run.executionStatus,
    manifest?.resultStatus,
    query,
    stop,
  ]);

  return { manifest, notice, loading, query: () => query() };
}
