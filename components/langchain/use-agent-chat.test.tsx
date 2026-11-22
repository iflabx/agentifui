import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { consumeAguiStream } from '@lib/services/client/agui-stream';
import {
  AgentRequestError,
  agentRequest,
  agentSubmissionRequest,
  consumeAgentStream,
} from '@lib/services/client/langchain-api';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TextEncoder } from 'node:util';

import { editViewPrefix, useAgentChat } from './use-agent-chat';

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
}));

jest.mock('@lib/services/client/langchain-api', () => ({
  ...jest.requireActual('@lib/services/client/langchain-api'),
  agentRequest: jest.fn(),
  consumeAgentStream: jest.fn(),
  agentSubmissionRequest: jest.fn(),
}));
jest.mock('@lib/services/client/agui-stream', () => ({
  consumeAguiStream: jest.fn(),
}));

describe('independent agent chat lifecycle', () => {
  it('projects only retained messages, tools and results while a revision is pending', () => {
    const prefix = editViewPrefix(
      {
        messages: [
          {
            id: 'first',
            role: 'user',
            content: 'first',
            metadata: { backend_run_id: 'first-run' },
          },
          {
            id: 'first-answer',
            role: 'assistant',
            content: 'answer',
            metadata: { backend_run_id: 'first-run' },
          },
          {
            id: 'source',
            role: 'user',
            content: 'old',
            metadata: { backend_run_id: 'old-run' },
          },
          {
            id: 'old-answer',
            role: 'assistant',
            content: 'old answer',
            metadata: { backend_run_id: 'old-run' },
          },
        ],
        tools: [
          { runId: 'first-run', toolCallId: 'kept' },
          { runId: 'old-run', toolCallId: 'hidden' },
        ],
        resultRuns: [{ id: 'first-run' }, { id: 'old-run' }],
        runId: 'old-run',
        run: { id: 'old-run' },
      } as never,
      'source'
    );
    expect(prefix.messages.map(message => message.id)).toEqual([
      'first',
      'first-answer',
    ]);
    expect(prefix.tools.map(tool => tool.toolCallId)).toEqual(['kept']);
    expect(prefix.resultRuns?.map(run => run.id)).toEqual(['first-run']);
    expect(prefix.run).toBeUndefined();
    expect(prefix.runId).toBeUndefined();
  });

  it('keeps an edited request uncertain on transport failure, then publishes confirmed rejection without resending', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockRejectedValueOnce(new Error('network lost'));
    jest
      .mocked(agentSubmissionRequest)
      .mockResolvedValue({ state: 'rejected', runId: null });
    const hook = renderHook(() =>
      useAgentChat('app-uuid', 'local', 'test-actor')
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.send('revision', undefined, 'user');
    });
    const submissionId = JSON.parse(
      jest.mocked(global.fetch).mock.calls[0][1]!.body as string
    ).submissionId;
    expect(outcome).toEqual({ status: 'unknown', submissionId });
    expect(hook.result.current.unconfirmed).toBe(true);
    jest.useFakeTimers();
    act(() => hook.result.current.retryStatus());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1600);
    });
    expect(hook.result.current.editRecovery).toEqual({
      submissionId,
      accepted: false,
    });
    expect(hook.result.current.unconfirmed).toBe(false);
    expect(
      hook.result.current.view.messages.map(message => message.id)
    ).toEqual(['user', 'assistant']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  const originalEncoder = globalThis.TextEncoder;
  beforeAll(() => {
    globalThis.TextEncoder = TextEncoder;
  });
  afterAll(() => {
    globalThis.TextEncoder = originalEncoder;
  });
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    useLangchainDraftStore.getState().setActor(null);
    useLangchainDraftStore.getState().setActor('test-actor');
    window.history.replaceState({}, '', '/apps/langchain/app-uuid');
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    jest.mocked(agentRequest).mockImplementation(async (_appId, suffix) => {
      if (suffix === '') return { app: { name: 'Test agent' } } as never;
      if (suffix === '/conversations') return { conversations: [] } as never;
      return {
        conversation: { id: 'local', title: 'Test' },
        messages: [
          { id: 'user', role: 'user', content: 'Hello' },
          { id: 'assistant', role: 'assistant', content: 'Reply' },
        ],
        runs: [
          { id: 'run', executionStatus: 'success', persistenceStatus: 'saved' },
        ],
      } as never;
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('sends only revised text and a source reference, replacing the visible suffix after acceptance', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockImplementationOnce(async (_response, emit) => {
        emit({
          type: 'accepted',
          conversationId: 'local',
          runId: 'new-run',
          userMessageId: 'edited-user',
        });
        emit({ type: 'text', messageId: 'new-answer', delta: 'New answer' });
      });
    const hook = renderHook(() =>
      useAgentChat('app-uuid', 'local', 'test-actor')
    );
    await waitFor(() => expect(hook.result.current.historyLoading).toBe(false));
    await waitFor(() =>
      expect(hook.result.current.view.messages).toHaveLength(2)
    );
    await act(async () => {
      await hook.result.current.send('Revised question', undefined, 'user');
    });
    const body = JSON.parse(
      jest.mocked(global.fetch).mock.calls[0][1]!.body as string
    );
    expect(body).toMatchObject({
      content: 'Revised question',
      editSourceId: 'user',
      conversationId: 'local',
    });
    expect(
      hook.result.current.view.messages.map(message => message.content)
    ).toEqual(['Revised question', 'New answer']);
    expect(
      hook.result.current.view.messages.some(
        message => message.id === 'assistant'
      )
    ).toBe(false);
    hook.unmount();
  });

  it('initializes an edited AG-UI stream with only the retained prefix and visible revised text', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation(async (appId, suffix, init) => {
        if (!suffix)
          return { app: { name: 'Agent' }, protocol: 'ag-ui/1.0' } as never;
        if (suffix.startsWith('/runs/'))
          return {
            id: 'edited-run',
            executionStatus: 'running',
            persistenceStatus: 'pending',
          } as never;
        const detail = await original(appId, suffix, init);
        return { ...(detail as object), protocol: 'ag-ui/1.0' } as never;
      });
    jest
      .mocked(consumeAguiStream)
      .mockImplementationOnce(async (_response, input) => {
        const acceptance = {
          conversationId: 'local',
          runId: 'edited-run',
          userMessageId: 'edited-user',
          submissionId: input.submissionId,
        };
        const messages =
          typeof input.history === 'function'
            ? input.history(acceptance)
            : input.history;
        expect(messages).toEqual([
          { id: 'edited-user', role: 'user', content: 'Revised' },
        ]);
        input.accept(
          {
            schemaVersion: 2,
            threadId: 'local',
            runId: 'edited-run',
            status: 'running',
            messages: messages!,
            outputMessageIds: [],
            warnings: [],
          },
          acceptance
        );
      });
    const hook = renderHook(() =>
      useAgentChat('app-uuid', 'local', 'test-actor')
    );
    await waitFor(() =>
      expect(hook.result.current.view.messages).toHaveLength(2)
    );
    await act(async () => {
      await hook.result.current.send('Revised', undefined, 'user');
    });
    expect(consumeAguiStream).toHaveBeenCalledTimes(1);
    expect(
      hook.result.current.view.messages.map(message => message.content)
    ).toEqual(['Revised']);
    hook.unmount();
  });

  it('keeps the original visible path when an edited source is rejected', async () => {
    jest.mocked(consumeAgentStream).mockImplementationOnce(async () => {
      throw new AgentRequestError(409, {
        code: 'AGENT_EDIT_SOURCE_UNAVAILABLE',
        source: 'frontend',
        severity: 'warn',
        retryable: false,
        userMessage: 'Unavailable',
        requestId: 'synthetic',
        occurredAt: '',
      });
    });
    const hook = renderHook(() =>
      useAgentChat('app-uuid', 'local', 'test-actor')
    );
    await waitFor(() =>
      expect(hook.result.current.view.messages).toHaveLength(2)
    );
    const original = hook.result.current.view.messages;
    await act(async () => {
      await hook.result.current.send('Revised question', undefined, 'user');
    });
    expect(hook.result.current.view.messages).toEqual(original);
    expect(hook.result.current.unconfirmed).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('rejects overlong correction text before creating optimistic messages or submissions', async () => {
    const hook = renderHook(() =>
      useAgentChat('app-uuid', 'local', 'test-actor')
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await waitFor(() => expect(hook.result.current.historyLoading).toBe(false));
    const original = hook.result.current.view.messages;
    await act(async () => {
      expect(await hook.result.current.send('a'.repeat(16001))).toBe(false);
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hook.result.current.view.messages).toEqual(original);
    expect(hook.result.current.error?.detail?.code).toBe(
      'AGENT_MESSAGE_TOO_LONG'
    );
    expect(useLangchainDraftStore.getState().pendingSubmissions).toEqual({});
  });

  it.each(['legacy', 'ag-ui', 'failure'])(
    'discards an old %s stream when the same account has a new login epoch',
    async mode => {
      let complete!: () => void;
      if (mode === 'ag-ui') {
        jest.mocked(agentRequest).mockResolvedValue({
          app: { name: 'Test agent' },
          protocol: 'ag-ui/1.0',
        });
        jest.mocked(consumeAguiStream).mockImplementationOnce(
          async (_response, input) =>
            new Promise<void>(resolve => {
              complete = () => {
                input.accept(
                  {
                    schemaVersion: 2,
                    threadId: 'old-conversation',
                    runId: 'old-run',
                    status: 'succeeded',
                    messages: [
                      {
                        id: 'old-answer',
                        role: 'assistant',
                        content: 'Old response',
                      },
                    ],
                    outputMessageIds: ['old-answer'],
                    warnings: [],
                  },
                  {
                    conversationId: 'old-conversation',
                    runId: 'old-run',
                    userMessageId: 'old-question',
                  }
                );
                resolve();
              };
            })
        );
      }
      jest.mocked(consumeAgentStream).mockImplementation(
        async (_response, emit) =>
          new Promise<void>((resolve, reject) => {
            complete = () => {
              if (mode === 'failure') {
                reject(new Error('Old stream failed'));
                return;
              }
              emit({
                type: 'accepted',
                conversationId: 'old-conversation',
                runId: 'old-run',
                userMessageId: 'old-question',
              });
              emit({
                type: 'text',
                messageId: 'old-answer',
                delta: 'Old response',
              });
              resolve();
            };
          })
      );
      const { result } = renderHook(() =>
        useAgentChat('app-uuid', null, 'test-actor')
      );
      await waitFor(() => expect(result.current.ready).toBe(true));
      let work!: Promise<unknown>;
      act(() => {
        work = result.current.send('Old question');
      });
      await waitFor(() => expect(complete).toBeDefined());
      const signal = jest.mocked(global.fetch).mock.calls[0][1]?.signal;
      act(() => useLangchainDraftStore.getState().setActor('test-actor', true));
      await act(async () => {
        complete();
        await work;
      });
      expect(signal?.aborted).toBe(true);
      expect(window.location.search).toBe('');
      expect(result.current.view.messages).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(conversationEvents.emit).not.toHaveBeenCalled();
    }
  );

  it('retains a streamed answer during failed persistence, bounds polling and recovers only the same saved run', async () => {
    let saved = false;
    let checks = 0;
    jest.mocked(agentRequest).mockImplementation(async (_appId, suffix) => {
      if (!suffix) return { app: { name: 'Test agent' } } as never;
      const run = {
        id: 'run',
        executionStatus: 'success',
        persistenceStatus: saved ? 'saved' : 'failed',
      };
      if (suffix.startsWith('/runs/')) {
        checks += 1;
        return run as never;
      }
      return {
        conversation: { id: 'local', title: 'Test' },
        messages: [
          { id: 'user', role: 'user', content: 'Hello' },
          ...(saved
            ? [{ id: 'answer', role: 'assistant', content: 'Known answer' }]
            : []),
        ],
        runs: [run],
      } as never;
    });
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, emit) => {
        emit({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
        emit({ type: 'text', messageId: 'answer', delta: 'Known answer' });
        emit({
          type: 'status',
          executionStatus: 'success',
          persistenceStatus: 'failed',
        });
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    jest.useFakeTimers();
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(result.current.view.messages.at(-1)?.content).toBe('Known answer');
    expect(result.current.unconfirmed).toBe(true);
    await act(async () => {
      await result.current.send('Do not regenerate');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(130000);
    });
    expect(checks).toBe(40);
    expect(result.current.statusCheckExhausted).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    saved = true;
    await act(async () => {
      result.current.retryStatus();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1501);
    });
    expect(result.current.unconfirmed).toBe(false);
    expect(
      result.current.view.messages.filter(
        message => message.content === 'Known answer'
      )
    ).toHaveLength(1);
    expect(result.current.view.run?.persistenceStatus).toBe('saved');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('restores only the authorized recovery snapshot after refresh and does not let its late poll overwrite another conversation', async () => {
    let finishPoll: (value: unknown) => void = () => undefined;
    const failedRun = {
      id: 'run',
      executionStatus: 'success',
      persistenceStatus: 'failed',
      recoveryMessages: [
        { id: 'answer', role: 'assistant', content: 'Known answer' },
      ],
    };
    jest.mocked(agentRequest).mockImplementation(async (_appId, suffix) => {
      if (!suffix) return { app: { name: 'Test agent' } } as never;
      if (suffix.startsWith('/runs/'))
        return new Promise(resolve => {
          finishPoll = resolve;
        }) as never;
      const isOther = suffix.endsWith('/other');
      return {
        conversation: { id: isOther ? 'other' : 'local', title: 'Test' },
        messages: [
          {
            id: isOther ? 'other-user' : 'user',
            role: 'user',
            content: isOther ? 'Other' : 'Hello',
          },
        ],
        runs: isOther ? [] : [failedRun],
      } as never;
    });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', 'local')
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.view.messages.at(-1)?.content).toBe('Known answer');
    expect(result.current.unconfirmed).toBe(true);
    jest.useFakeTimers();
    await act(async () => {
      result.current.retryStatus();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1501);
    });
    await act(async () => {
      await result.current.select('other');
    });
    await act(async () => {
      finishPoll({ ...failedRun, persistenceStatus: 'saved' });
    });
    expect(result.current.view.conversationId).toBe('other');
    expect(result.current.view.messages).toEqual([
      { id: 'other-user', role: 'user', content: 'Other' },
    ]);
    expect(result.current.unconfirmed).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    unmount();
  });

  it('sends exactly one run request and reads persisted messages without client saves', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, onEvent) => {
        onEvent({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
        onEvent({ type: 'text', messageId: 'assistant', delta: 'Reply' });
        onEvent({
          type: 'status',
          executionStatus: 'success',
          persistenceStatus: 'saved',
        });
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(global.fetch).mock.calls[0][0]).toBe(
      '/api/internal/apps/app-uuid/agent/runs'
    );
    expect(
      jest.mocked(agentRequest).mock.calls.every(call => !call[2]?.method)
    ).toBe(true);
    expect(result.current.view.messages).toHaveLength(2);
    expect(result.current.unconfirmed).toBe(false);
    expect(conversationEvents.emit).toHaveBeenCalled();
    expect(
      new URL(window.location.href).searchParams.get('conversationId')
    ).toBe('local');
    unmount();
  });

  it('retains the result entry when post-success history fails and lets status retry recover without regeneration', async () => {
    let failHistory = true;
    const run = {
      id: 'run',
      conversationId: 'local',
      executionStatus: 'success',
      persistenceStatus: 'saved',
      deliverablesQueryAvailable: true,
    };
    jest.mocked(agentRequest).mockImplementation(async (_appId, suffix) => {
      if (!suffix)
        return { app: { name: 'Test agent' }, protocol: 'ag-ui/1.0' } as never;
      if (suffix === '/runs/run') return run as never;
      if (failHistory) throw new AgentRequestError(503);
      return {
        conversation: { id: 'local', title: 'Test' },
        messages: [{ id: 'assistant', role: 'assistant', content: 'Reply' }],
        runs: [run],
      } as never;
    });
    jest
      .mocked(consumeAguiStream)
      .mockImplementationOnce(async (_response, input) => {
        input.accept(
          {
            schemaVersion: 2,
            threadId: 'local',
            runId: 'run',
            status: 'succeeded',
            messages: [
              { id: 'assistant', role: 'assistant', content: 'Reply' },
            ],
            outputMessageIds: ['assistant'],
            warnings: [],
          },
          { conversationId: 'local', runId: 'run', userMessageId: 'user' }
        );
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    jest.useFakeTimers();
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(result.current.view.resultRuns).toEqual([run]);
    expect(result.current.view.run).toMatchObject({
      executionStatus: 'success',
      persistenceStatus: 'saved',
    });
    expect(result.current.unconfirmed).toBe(true);
    failHistory = false;
    await act(async () => {
      result.current.retryStatus();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.unconfirmed).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.view.resultRuns).toEqual([run]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not abort an active stream when accepted updates the search parameters', async () => {
    let finishStream: () => void = () => undefined;
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, onEvent) => {
        onEvent({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
        await new Promise<void>(resolve => {
          finishStream = resolve;
        });
        onEvent({
          type: 'status',
          executionStatus: 'success',
          persistenceStatus: 'saved',
        });
      });
    const { result, rerender, unmount } = renderHook(
      ({ selected }: { selected: string | null }) =>
        useAgentChat('app-uuid', selected),
      { initialProps: { selected: null as string | null } }
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    let sending: ReturnType<typeof result.current.send>;
    await act(async () => {
      sending = result.current.send('Hello');
    });
    rerender({ selected: 'local' });
    const signal = jest.mocked(global.fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      finishStream();
      await sending;
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.view.run?.persistenceStatus).toBe('saved');
    unmount();
  });

  it('blocks new generation after unconfirmed EOF without resending', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, onEvent) => {
        onEvent({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
        onEvent({ type: 'text', messageId: 'assistant', delta: 'Partial' });
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(result.current.unconfirmed).toBe(true);
    expect(result.current.view.run?.executionStatus).toBe('unknown');
    expect(
      result.current.view.messages.some(
        message => message.role === 'user' && message.content === 'Hello'
      )
    ).toBe(true);
    await act(async () => {
      await result.current.send('Do not rerun');
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps the latest history selection when earlier requests resolve late and blocks sends during selection', async () => {
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const first = new Promise(resolve => {
      resolveFirst = resolve;
    });
    const second = new Promise(resolve => {
      resolveSecond = resolve;
    });
    jest.mocked(agentRequest).mockImplementation((appId, suffix, init) => {
      if (suffix === '/conversations/A') return first as never;
      if (suffix === '/conversations/B') return second as never;
      return original(appId, suffix, init) as never;
    });
    let selectingFirst: Promise<void>;
    let selectingSecond: Promise<void>;
    act(() => {
      selectingFirst = result.current.select('A');
      selectingSecond = result.current.select('B');
      void result.current.send('Must not target the previous conversation');
    });
    expect(result.current.historyLoading).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      resolveSecond({ conversation: { id: 'B' }, messages: [], runs: [] });
      await selectingSecond;
    });
    expect(result.current.view.conversationId).toBe('B');
    expect(result.current.historyLoading).toBe(false);
    await act(async () => {
      resolveFirst({ conversation: { id: 'A' }, messages: [], runs: [] });
      await selectingFirst;
    });
    expect(result.current.view.conversationId).toBe('B');
    expect(
      new URL(window.location.href).searchParams.get('conversationId')
    ).toBe('B');
    unmount();
  });

  it('clears the selected history when the route query becomes empty', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ selected }: { selected: string | null }) =>
        useAgentChat('app-uuid', selected),
      { initialProps: { selected: 'local' as string | null } }
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.view.conversationId).toBe('local');
    rerender({ selected: null });
    await waitFor(() =>
      expect(result.current.view.conversationId).toBeUndefined()
    );
    expect(result.current.view.messages).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    unmount();
  });

  it('removes rejected optimistic input while preserving structured policy errors', async () => {
    const failure = new AgentRequestError(429, {
      code: 'AGENT_QUOTA_EXCEEDED',
      source: 'fastify-api',
      severity: 'warn',
      retryable: false,
      userMessage: 'The application usage allowance has been exhausted.',
      requestId: 'synthetic-request',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    jest.mocked(consumeAgentStream).mockRejectedValue(failure);
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Rejected');
    });
    expect(result.current.view.messages).toEqual([]);
    expect(result.current.error).toBe(failure);
    expect(result.current.unconfirmed).toBe(false);
    await act(async () => {
      await result.current.send('Rejected again');
    });
    expect(result.current.view.messages).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    unmount();
  });

  it.each([null, 'local'])(
    'treats a paused-profile rejection as not accepted, keeps the draft, and permits an explicit retry for %s',
    async conversationId => {
      const original = jest.mocked(agentRequest).getMockImplementation()!;
      jest.mocked(agentRequest).mockImplementation((appId, suffix, init) => {
        if (!suffix)
          return Promise.resolve({
            app: { name: 'Test agent' },
            protocol: 'ag-ui/1.0',
          }) as never;
        return original(appId, suffix, init);
      });
      const failure = new AgentRequestError(409, {
        code: 'AGENT_RESULT_PROFILE_DISABLED',
        source: 'fastify-api',
        severity: 'warn',
        retryable: false,
        userMessage: 'New result tasks are paused.',
        requestId: 'synthetic-request',
        occurredAt: '2026-01-01T00:00:00.000Z',
      });
      jest.mocked(consumeAguiStream).mockRejectedValue(failure);
      const { result, unmount } = renderHook(() =>
        useAgentChat('app-uuid', conversationId, 'test-actor')
      );
      await waitFor(() => expect(result.current.ready).toBe(true));
      const previousMessages = result.current.view.messages;
      const store = useLangchainDraftStore.getState();
      const scope = store.selectScope(
        'app-uuid',
        result.current.draftScope,
        false
      )!;
      act(() => store.setText(scope, 'Report request'));
      const snapshot = useLangchainDraftStore.getState().drafts[scope];
      let accepted: unknown;
      await act(async () => {
        accepted = await result.current.send(snapshot.text, snapshot);
      });
      expect(accepted).toBe(false);
      expect(result.current.view.messages).toEqual(previousMessages);
      expect(result.current.error).toBe(failure);
      expect(result.current.unconfirmed).toBe(false);
      expect(useLangchainDraftStore.getState().pendingSubmissions).toEqual({});
      expect(useLangchainDraftStore.getState().drafts[scope]).toEqual(snapshot);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(agentSubmissionRequest).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.send(snapshot.text, snapshot);
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.current.unconfirmed).toBe(false);
      unmount();
    }
  );

  it('keeps other AG-UI conflicts uncertain rather than treating them as a paused-profile rejection', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest.mocked(agentRequest).mockImplementation((appId, suffix, init) => {
      if (!suffix)
        return Promise.resolve({
          app: { name: 'Test agent' },
          protocol: 'ag-ui/1.0',
        }) as never;
      return original(appId, suffix, init);
    });
    jest.mocked(consumeAguiStream).mockRejectedValue(
      new AgentRequestError(409, {
        code: 'AGENT_SUBMISSION_CONFLICT',
        source: 'fastify-api',
        severity: 'warn',
        retryable: false,
        userMessage: 'Submission needs verification.',
        requestId: 'synthetic-request',
        occurredAt: '2026-01-01T00:00:00.000Z',
      })
    );
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null, 'test-actor')
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Report request');
    });
    expect(result.current.unconfirmed).toBe(true);
    expect(
      Object.values(useLangchainDraftStore.getState().pendingSubmissions)
    ).toHaveLength(1);
    await act(async () => {
      await result.current.send('Do not resend');
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('allows read-only navigation away from an unknown run and emits global refresh on delete', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, event) => {
        event({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(result.current.unconfirmed).toBe(true);
    await act(async () => {
      await result.current.select('local');
    });
    expect(result.current.unconfirmed).toBe(false);
    jest.mocked(conversationEvents.emit).mockClear();
    await act(async () => {
      await result.current.remove();
    });
    expect(conversationEvents.emit).toHaveBeenCalled();
    expect(
      new URL(window.location.href).searchParams.has('conversationId')
    ).toBe(false);
    expect(result.current.view.messages).toEqual([]);
    unmount();
  });

  it('ignores late stream events and completion after navigation without unlocking a newer request', async () => {
    let firstEvent: Parameters<typeof consumeAgentStream>[1] = () => undefined;
    let finishFirst: () => void = () => undefined;
    let finishSecond: () => void = () => undefined;
    jest
      .mocked(consumeAgentStream)
      .mockImplementationOnce(async (_response, event) => {
        firstEvent = event;
        await new Promise<void>(resolve => {
          finishFirst = resolve;
        });
      })
      .mockImplementationOnce(async (_response, event) => {
        event({
          type: 'accepted',
          conversationId: 'B',
          runId: 'run-B',
          userMessageId: 'u-B',
        });
        await new Promise<void>(resolve => {
          finishSecond = resolve;
        });
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    let first: ReturnType<typeof result.current.send>;
    let second: ReturnType<typeof result.current.send>;
    await act(async () => {
      first = result.current.send('A');
    });
    await act(async () => {
      await result.current.select(null);
    });
    await act(async () => {
      second = result.current.send('B');
    });
    await act(async () => {
      firstEvent({
        type: 'accepted',
        conversationId: 'A',
        runId: 'run-A',
        userMessageId: 'u-A',
      });
      firstEvent({
        type: 'text',
        messageId: 'late',
        delta: 'Wrong conversation',
      });
      finishFirst();
      await first;
    });
    expect(result.current.view.conversationId).toBe('B');
    expect(
      result.current.view.messages.some(message => message.id === 'late')
    ).toBe(false);
    expect(result.current.busy).toBe(true);
    expect(
      new URL(window.location.href).searchParams.get('conversationId')
    ).toBe('B');
    await act(async () => {
      await result.current.send('Blocked duplicate');
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      finishSecond();
      await second;
    });
    unmount();
  });

  it('preserves the new draft scope on accepted route adoption and assigns a fresh next draft', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockImplementation(async (_response, event) => {
        event({
          type: 'accepted',
          conversationId: 'local',
          runId: 'run',
          userMessageId: 'user',
        });
        event({
          type: 'status',
          executionStatus: 'success',
          persistenceStatus: 'saved',
        });
      });
    const { result, rerender, unmount } = renderHook(
      ({ selected }: { selected: string | null }) =>
        useAgentChat('app-uuid', selected),
      { initialProps: { selected: null as string | null } }
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    const originalScope = result.current.draftScope;
    await act(async () => {
      await result.current.send('Hello');
    });
    rerender({ selected: 'local' });
    expect(result.current.draftScope).toBe(originalScope);
    await act(async () => {
      await result.current.select(null);
    });
    expect(result.current.draftScope).not.toBe(originalScope);
    await act(async () => {
      await result.current.select('local');
    });
    expect(result.current.draftScope).toBe(originalScope);
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.some(call => call[1] === '/conversations')
    ).toBe(false);
    unmount();
  });

  it('keeps a failed initial history read-only but allows navigating to a clean new draft', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation((appId, suffix, init) =>
        suffix === '/conversations/missing'
          ? Promise.reject(new AgentRequestError(404))
          : (original(appId, suffix, init) as never)
      );
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', 'missing')
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.historyFailed).toBe(true);
    await act(async () => {
      await result.current.send('Do not create a replacement');
    });
    expect(global.fetch).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.select(null);
    });
    expect(result.current.historyFailed).toBe(false);
    const scope = result.current.draftScope;
    await act(async () => {
      await result.current.select(null);
    });
    expect(result.current.draftScope).not.toBe(scope);
    unmount();
  });

  it('recovers a lost first frame after leaving and returning without dispatching again', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation(async (appId, suffix, init) => {
        if (!suffix)
          return {
            app: { name: 'Public agent' },
            protocol: 'ag-ui/1.0',
          } as never;
        if (suffix.startsWith('/runs/'))
          return {
            id: 'run',
            conversationId: 'local',
            executionStatus: 'success',
            persistenceStatus: 'saved',
          } as never;
        return original(appId, suffix, init) as never;
      });
    const store = useLangchainDraftStore.getState();
    const scope = store.selectScope('app-uuid', 'new:0', false)!;
    store.setText(scope, 'Hello');
    const snapshot = useLangchainDraftStore.getState().drafts[scope];
    jest
      .mocked(consumeAguiStream)
      .mockRejectedValue(new TypeError('Connection lost'));
    jest
      .mocked(agentSubmissionRequest)
      .mockResolvedValue({ state: 'accepted', runId: 'run' });
    const first = renderHook(() =>
      useAgentChat('app-uuid', null, 'test-actor')
    );
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      await first.result.current.send('Hello', snapshot);
    });
    expect(first.result.current.unconfirmed).toBe(true);
    first.unmount();
    const second = renderHook(() =>
      useAgentChat('app-uuid', null, 'test-actor')
    );
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.unconfirmed).toBe(true);
    jest.useFakeTimers();
    await act(async () => {
      await second.result.current.send('Hello');
      second.result.current.retryStatus();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1600);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(second.result.current.view.conversationId).toBe('local');
    expect(useLangchainDraftStore.getState().drafts[scope].text).toBe('');
    expect(useLangchainDraftStore.getState().pendingSubmissions).toEqual({});
    second.unmount();
  });

  it('canonicalizes history entry URLs after deletion and creating a replacement', async () => {
    window.history.replaceState({}, '', '/chat/local');
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', 'local')
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.remove();
    });
    expect(window.location.pathname).toBe('/apps/agent-chat/app-uuid');
    expect(window.location.search).toBe('');
    unmount();
  });

  it('negotiates AG-UI once and reconciles the saved answer without invoking the legacy consumer', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation(async (appId, suffix, init) => {
        if (!suffix)
          return {
            app: { name: 'Public agent' },
            protocol: 'ag-ui/1.0',
          } as never;
        if (suffix.startsWith('/runs/'))
          return {
            id: 'run',
            conversationId: 'local',
            executionStatus: 'success',
            persistenceStatus: 'saved',
          } as never;
        return original(appId, suffix, init) as never;
      });
    jest
      .mocked(consumeAguiStream)
      .mockImplementation(async (_response, input) => {
        expect(
          input.history({
            conversationId: 'local',
            runId: 'run',
            userMessageId: 'user',
          })
        ).toEqual([{ id: 'user', role: 'user', content: 'Hello' }]);
        input.accept(
          {
            schemaVersion: 2,
            threadId: 'local',
            runId: 'run',
            status: 'succeeded',
            messages: [
              { id: 'user', role: 'user', content: 'Hello' },
              { id: 'assistant', role: 'assistant', content: 'Reply' },
            ],
            outputMessageIds: ['assistant'],
            warnings: [],
          },
          { conversationId: 'local', runId: 'run', userMessageId: 'user' }
        );
      });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(consumeAguiStream).toHaveBeenCalledTimes(1);
    expect(consumeAgentStream).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(global.fetch).mock.calls[0]?.[1]?.headers).toMatchObject(
      { 'X-AgentifUI-Protocol': 'ag-ui/1.0' }
    );
    expect(result.current.view.messages.map(message => message.id)).toEqual([
      'user',
      'assistant',
    ]);
    expect(result.current.unconfirmed).toBe(false);
    unmount();
  });

  it('selects legacy tools before submission, without attempting AG-UI and falling back after execution', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation(async (appId, suffix, init) => {
        if (!suffix)
          return {
            app: { name: 'Public agent' },
            protocol: 'ag-ui/1.0',
          } as never;
        const detail = await original(appId, suffix, init);
        return { ...(detail as object), protocol: 'agentifui/legacy' } as never;
      });
    jest.mocked(consumeAgentStream).mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', 'local')
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Continue old tools');
    });
    expect(consumeAgentStream).toHaveBeenCalledTimes(1);
    expect(consumeAguiStream).not.toHaveBeenCalled();
    expect(
      jest.mocked(global.fetch).mock.calls[0]?.[1]?.headers
    ).not.toHaveProperty('X-AgentifUI-Protocol');
    unmount();
  });

  it('recovers a response lost before RUN_STARTED by querying the retained submission, never by resubmitting', async () => {
    const original = jest.mocked(agentRequest).getMockImplementation()!;
    jest
      .mocked(agentRequest)
      .mockImplementation(async (appId, suffix, init) => {
        if (!suffix)
          return {
            app: { name: 'Public agent' },
            protocol: 'ag-ui/1.0',
          } as never;
        if (suffix.startsWith('/runs/'))
          return {
            id: 'run',
            conversationId: 'local',
            executionStatus: 'success',
            persistenceStatus: 'saved',
          } as never;
        return original(appId, suffix, init) as never;
      });
    jest
      .mocked(consumeAguiStream)
      .mockRejectedValue(new Error('Connection lost'));
    jest
      .mocked(agentSubmissionRequest)
      .mockResolvedValue({ runId: 'run', state: 'finished' });
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    jest.useFakeTimers();
    await act(async () => {
      await result.current.send('Hello');
    });
    expect(result.current.unconfirmed).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1501);
    });
    expect(agentSubmissionRequest).toHaveBeenCalledTimes(1);
    expect(result.current.view.conversationId).toBe('local');
    expect(result.current.unconfirmed).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();
  });
});
