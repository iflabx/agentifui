import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  AgentRequestError,
  agentRequest,
  consumeAgentStream,
} from '@lib/services/client/langchain-api';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAgentChat } from './use-agent-chat';

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
}));

jest.mock('@lib/services/client/langchain-api', () => ({
  ...jest.requireActual('@lib/services/client/langchain-api'),
  agentRequest: jest.fn(),
  consumeAgentStream: jest.fn(),
}));

describe('independent agent chat lifecycle', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('removes optimistic input on an explicitly rejected HTTP request', async () => {
    jest
      .mocked(consumeAgentStream)
      .mockRejectedValue(new AgentRequestError(429));
    const { result, unmount } = renderHook(() =>
      useAgentChat('app-uuid', null)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send('Rejected');
    });
    expect(result.current.view.messages).toEqual([]);
    expect(result.current.error).toBe(429);
    expect(result.current.unconfirmed).toBe(false);
    await act(async () => {
      await result.current.send('Rejected again');
    });
    expect(result.current.view.messages).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
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
});
