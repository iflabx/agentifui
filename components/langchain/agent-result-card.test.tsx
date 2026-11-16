import type { AppErrorDetail } from '@lib/errors/app-error';
import {
  type AgentDeliverables,
  AgentRequestError,
  type AgentRun,
  agentArtifactRequest,
  agentDeliverablesRequest,
} from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import messages from '../../messages/en-US.json';
import { AgentResultCard } from './agent-result-card';
import { resultNotice } from './agent-result-query';

jest.mock('@lib/services/client/langchain-api', () => ({
  ...jest.requireActual('@lib/services/client/langchain-api'),
  agentArtifactRequest: jest.fn(),
  agentDeliverablesRequest: jest.fn(),
}));
jest.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, values: Record<string, string> = {}) => {
      const catalog = namespace
        .split('.')
        .reduce<unknown>(
          (value, part) => (value as Record<string, unknown>)[part],
          messages
        );
      return Object.entries(values).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, replacement),
        (catalog as Record<string, string>)[key]
      );
    },
}));
jest.mock('@components/file-preview/previews/markdown-preview', () => ({
  MarkdownPreview: ({
    onDownload,
    allowImages,
  }: {
    onDownload: () => void;
    allowImages: boolean;
  }) => (
    <div data-testid="markdown" data-images={String(allowImages)}>
      <button onClick={onDownload}>Download preview</button>
    </div>
  ),
}));

const request = jest.mocked(agentDeliverablesRequest);
const artifactRequest = jest.mocked(agentArtifactRequest);
const visibleCallbacks: Array<
  (entries: Array<{ isIntersecting: boolean }>) => void
> = [];
const ready: AgentDeliverables = {
  schemaVersion: 1,
  executionStatus: 'success',
  resultStatus: 'ready',
  reason: null,
  artifacts: [
    {
      artifactId: 'report',
      filename: 'report.md',
      mediaType: 'text/markdown',
      sizeBytes: 20,
      sha256: 'hash',
    },
    {
      artifactId: 'data',
      filename: 'data.csv',
      mediaType: 'text/csv',
      sizeBytes: 20,
      sha256: 'hash',
    },
  ],
  sources: [
    { sourceId: 'source', title: 'Evidence', excerpt: 'Source excerpt' },
  ],
};
const pending: AgentDeliverables = {
  ...ready,
  resultStatus: 'pending',
  artifacts: [],
  sources: [],
};
const baseRun: AgentRun = {
  id: 'run-a',
  conversationId: 'conversation-a',
  executionStatus: 'running',
  persistenceStatus: 'saved',
  deliverablesQueryAvailable: true,
};
const response = (deliverables: AgentDeliverables) => ({
  runId: 'run-a',
  conversationId: 'conversation-a',
  deliverables,
});
const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const blob = (text = 'a,b\n1,2') =>
  ({
    size: text.length,
    text: jest.fn().mockResolvedValue(text),
    slice: jest
      .fn()
      .mockReturnValue({ text: jest.fn().mockResolvedValue(text) }),
  }) as unknown as Blob;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};
const queryButton = () => screen.getByRole('button', { name: 'Query result' });
const error = (code: string) =>
  new AgentRequestError(409, { code } as AppErrorDetail);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  });
  window.matchMedia = jest.fn().mockImplementation(media => ({
    media,
    matches: window.innerWidth < 768,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  jest.useFakeTimers();
  request.mockReset();
  artifactRequest.mockReset();
  visibleCallbacks.length = 0;
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  global.IntersectionObserver = jest.fn(
    (callback: IntersectionObserverCallback) => {
      const notify = (entries: Array<{ isIntersecting: boolean }>) =>
        callback(
          entries as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      visibleCallbacks.push(notify);
      return {
        observe: () => notify([{ isIntersecting: true }]),
        disconnect: jest.fn(),
        unobserve: jest.fn(),
      };
    }
  ) as unknown as typeof IntersectionObserver;
  useLangchainDraftStore.setState({ actorId: 'actor', actorEpoch: 1 });
  URL.createObjectURL = jest.fn().mockReturnValue('blob:test');
  URL.revokeObjectURL = jest.fn();
  jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('result discovery', () => {
  it('does not fetch historical terminal cards automatically when they enter view', async () => {
    request.mockResolvedValue(response(pending));
    render(
      <>
        <AgentResultCard
          appId="app"
          run={{ ...baseRun, executionStatus: 'success' }}
        />
        <AgentResultCard
          appId="app"
          run={{ ...baseRun, id: 'history-b', executionStatus: 'failed' }}
        />
      </>
    );
    await flush();
    act(() =>
      visibleCallbacks.forEach(notify => notify([{ isIntersecting: false }]))
    );
    act(() =>
      visibleCallbacks.forEach(notify => notify([{ isIntersecting: true }]))
    );
    await tick(60_000);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Query result' })[0]);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    await tick(3000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('automatically queries once on a visible terminal card without opening a preview', async () => {
    request.mockResolvedValue(response(ready));
    render(
      <AgentResultCard
        autoQuery
        appId="app"
        run={{ ...baseRun, executionStatus: 'success' }}
      />
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Preview report.md' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not query a running card until it settles', async () => {
    request.mockResolvedValue(response(ready));
    const view = render(
      <AgentResultCard autoQuery appId="app" run={baseRun} />
    );
    await flush();
    expect(request).not.toHaveBeenCalled();
    view.rerender(
      <AgentResultCard
        autoQuery
        appId="app"
        run={{ ...baseRun, executionStatus: 'success' }}
      />
    );
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses queried ready data rather than a stale pending prop', async () => {
    request.mockResolvedValue(response(ready));
    const run = { ...baseRun, deliverables: pending };
    const view = render(<AgentResultCard appId="app" run={run} />);
    fireEvent.click(queryButton());
    await flush();
    view.rerender(
      <AgentResultCard
        appId="app"
        run={{ ...run, deliverables: { ...pending } }}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Preview data.csv' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(messages.langchain.results.pending)
    ).not.toBeInTheDocument();
  });

  it('polls pending no faster than three seconds and stops at sixty seconds', async () => {
    request.mockResolvedValue(response(pending));
    render(<AgentResultCard appId="app" run={baseRun} />);
    fireEvent.click(queryButton());
    await flush();
    await tick(2999);
    expect(request).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(request).toHaveBeenCalledTimes(2);
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(21);
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(21);
    expect(queryButton()).toBeEnabled();
  });

  it('does not overlap requests or extend the polling window for a slow response', async () => {
    const slow = deferred<ReturnType<typeof response>>();
    request.mockReturnValue(slow.promise);
    render(<AgentResultCard appId="app" run={baseRun} />);
    fireEvent.click(queryButton());
    await tick(61_000);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => slow.resolve(response(pending)));
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops hidden-page polling without silently restarting on visibility', async () => {
    request.mockResolvedValue(response(pending));
    render(<AgentResultCard appId="app" run={baseRun} />);
    fireEvent.click(queryButton());
    await flush();
    Object.defineProperty(document, 'hidden', { value: true });
    fireEvent(document, new Event('visibilitychange'));
    await tick(5000);
    Object.defineProperty(document, 'hidden', { value: false });
    fireEvent(document, new Event('visibilitychange'));
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(queryButton());
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stops when the card leaves view and does not resume when it reappears', async () => {
    request.mockResolvedValue(response(pending));
    render(<AgentResultCard appId="app" run={baseRun} />);
    fireEvent.click(queryButton());
    await flush();
    act(() => visibleCallbacks[0]([{ isIntersecting: false }]));
    await tick(5000);
    act(() => visibleCallbacks[0]([{ isIntersecting: true }]));
    await tick(5000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('polls only the most recently selected visible run', async () => {
    request.mockResolvedValue(response(pending));
    render(
      <>
        <AgentResultCard appId="app" run={baseRun} />
        <AgentResultCard appId="app" run={{ ...baseRun, id: 'run-b' }} />
      </>
    );
    const cards = screen.getAllByRole('region');
    fireEvent.click(
      within(cards[0]).getByRole('button', { name: 'Query result' })
    );
    await flush();
    fireEvent.click(
      within(cards[1]).getByRole('button', { name: 'Query result' })
    );
    await flush();
    await tick(3000);
    expect(request.mock.calls.map(call => call[1])).toEqual([
      'run-a',
      'run-b',
      'run-b',
    ]);
  });

  it('keeps an unknown execution status distinct when results are recovered', async () => {
    request.mockResolvedValue(response(ready));
    const run = { ...baseRun, executionStatus: 'unknown' };
    render(<AgentResultCard appId="app" run={run} />);
    fireEvent.click(queryButton());
    await flush();
    expect(
      screen.getByText(messages.langchain.results.foundUnknown)
    ).toBeInTheDocument();
    expect(run.executionStatus).toBe('unknown');
  });

  it.each([
    ['AGENT_RESULT_PENDING', 'pending'],
    ['AGENT_RESULT_SAVE_FAILED', 'saveFailed'],
    ['AGENT_RESULT_NOT_PUBLISHED', 'notPublished'],
    ['AGENT_ARTIFACT_NOT_FOUND', 'notFound'],
    ['AGENT_ARTIFACT_INTEGRITY_FAILED', 'integrity'],
    ['AGENT_UPSTREAM_UNAVAILABLE', 'unavailable'],
  ] as const)('uses canonical detail.code for %s', async (code, key) => {
    request.mockRejectedValue(error(code));
    render(<AgentResultCard appId="app" run={baseRun} />);
    fireEvent.click(queryButton());
    await flush();
    expect(
      screen.getByText(messages.langchain.results[key])
    ).toBeInTheDocument();
    expect(resultNotice(error(code))).toBe(key);
  });

  it('does not display an untrusted manifest reason as UI text', () => {
    render(
      <AgentResultCard
        appId="app"
        run={{
          ...baseRun,
          deliverables: {
            ...pending,
            resultStatus: 'unavailable',
            reason: '<script>private upstream text</script>',
          },
        }}
      />
    );
    expect(
      screen.getByText(messages.langchain.results.unavailable)
    ).toBeInTheDocument();
    expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  });

  it('hides the feature for runs without a binding or result capability', () => {
    const view = render(
      <AgentResultCard
        appId="app"
        run={{ ...baseRun, deliverablesQueryAvailable: false }}
      />
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.rerender(
      <AgentResultCard appId="app" run={{ ...baseRun, id: undefined }} />
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('preview, download and source lifecycle', () => {
  const show = () =>
    render(
      <AgentResultCard appId="app" run={{ ...baseRun, deliverables: ready }} />
    );

  it.each([1024, 390])(
    'uses the shared shell and restores trigger focus with Escape at width %i',
    async width => {
      window.innerWidth = width;
      artifactRequest.mockResolvedValue({
        blob: async () => blob(),
      } as Response);
      show();
      const trigger = screen.getByRole('button', { name: 'Preview report.md' });
      trigger.focus();
      fireEvent.click(trigger);
      await flush();
      expect(screen.getByRole('dialog')).toHaveClass('w-full', 'md:w-[60%]');
      expect(screen.getByTestId('markdown')).toHaveAttribute(
        'data-images',
        'false'
      );
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await tick(250);
      await tick(0);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      );
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  );

  it('returns to the owning card and releases pending preview content after blob await', async () => {
    const slow = deferred<Blob>();
    artifactRequest.mockResolvedValue({ blob: () => slow.promise } as Response);
    show();
    const scrollIntoView = jest.fn();
    screen.getByRole('region').scrollIntoView = scrollIntoView;
    const trigger = screen.getByRole('button', { name: 'Preview report.md' });
    fireEvent.click(trigger);
    await flush();
    const signal = artifactRequest.mock.calls[0][3]!;
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to result card' })
    );
    await tick(250);
    await tick(0);
    expect(signal.aborted).toBe(true);
    await act(async () => slow.resolve(blob()));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
  });

  it.each(['app', 'conversation', 'run', 'actor'] as const)(
    'aborts old requests on %s scope change',
    async scope => {
      const slow = deferred<Blob>();
      artifactRequest.mockResolvedValue({
        blob: () => slow.promise,
      } as Response);
      const view = show();
      fireEvent.click(
        screen.getByRole('button', { name: 'Preview report.md' })
      );
      await flush();
      const signal = artifactRequest.mock.calls[0][3]!;
      if (scope === 'actor')
        act(() =>
          useLangchainDraftStore.setState({ actorEpoch: 2, actorId: 'another' })
        );
      else
        view.rerender(
          <AgentResultCard
            appId={scope === 'app' ? 'new-app' : 'app'}
            run={{
              ...baseRun,
              deliverables: ready,
              ...(scope === 'conversation'
                ? { conversationId: 'other' }
                : scope === 'run'
                  ? { id: 'other' }
                  : {}),
            }}
          />
        );
      expect(signal.aborted).toBe(true);
      await act(async () => slow.resolve(blob()));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  );

  it('does not download a blob completed after unmount', async () => {
    const slow = deferred<Blob>();
    artifactRequest.mockResolvedValue({ blob: () => slow.promise } as Response);
    const view = show();
    fireEvent.click(screen.getByRole('button', { name: 'Download data.csv' }));
    await flush();
    const signal = artifactRequest.mock.calls[0][3]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => slow.resolve(blob()));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps preview loading independent from downloads and revokes the download URL', async () => {
    const slow = deferred<Blob>();
    artifactRequest
      .mockResolvedValueOnce({ blob: () => slow.promise } as Response)
      .mockResolvedValueOnce({ blob: async () => blob() } as Response);
    show();
    const download = screen.getByRole('button', { name: 'Download data.csv' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }));
    await flush();
    fireEvent.click(download);
    await flush();
    expect(
      within(screen.getByRole('dialog')).getByRole('status')
    ).toHaveTextContent('Loading result');
    await act(async () => slow.resolve(blob()));
    expect(
      within(screen.getByRole('dialog')).queryByRole('status')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('renders CSV as text cells with a truncation notice and formula warning', async () => {
    const content = blob(`"a,b","say ""hello"""\n=1+1,"${'x'.repeat(2001)}"`);
    artifactRequest.mockResolvedValue({
      blob: async () => content,
    } as Response);
    show();
    expect(
      screen.getByText(messages.langchain.results.formulaWarning)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview data.csv' }));
    await flush();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'a,b' })).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'say "hello"' })
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '=1+1' })).toBeInTheDocument();
    expect(
      screen.getByText(messages.langchain.results.truncated)
    ).toBeInTheDocument();
    expect(content.slice).toHaveBeenCalledWith(0, 128 * 1024);
  });

  it('blocks inconsistent reads after integrity failure and allows query-only recovery', async () => {
    artifactRequest.mockRejectedValue(error('AGENT_ARTIFACT_INTEGRITY_FAILED'));
    request.mockResolvedValue(response({ ...ready }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Preview report.md' }));
    await flush();
    expect(
      within(screen.getByRole('dialog')).getByRole('alert')
    ).toHaveTextContent(messages.langchain.results.integrity);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await tick(250);
    expect(
      screen.getByRole('button', { name: 'Download report.md' })
    ).toBeDisabled();
    fireEvent.click(queryButton());
    await flush();
    expect(
      screen.getByRole('button', { name: 'Download report.md' })
    ).toBeEnabled();
  });

  it('copies the source title and excerpt without inventing a link', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    show();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('Source excerpt')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy source: Evidence' })
    );
    await flush();
    expect(writeText).toHaveBeenCalledWith('Evidence\nSource excerpt');
    expect(screen.getByText('Source copied.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Knowledge Base|Page|%/)).not.toBeInTheDocument();
  });

  it('reports source copy failure without claiming success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) },
    });
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy source: Evidence' })
    );
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.langchain.results.copyFailed
    );
    expect(screen.queryByText('Source copied.')).not.toBeInTheDocument();
  });
});
