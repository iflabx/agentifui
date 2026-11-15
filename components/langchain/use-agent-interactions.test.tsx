import {
  type AgentInteraction,
  AgentRequestError,
  agentRequest,
} from '@lib/services/client/langchain-api';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAgentInteractions } from './use-agent-interactions';

jest.mock('@lib/services/client/langchain-api', () => ({
  ...jest.requireActual('@lib/services/client/langchain-api'),
  agentRequest: jest.fn(),
}));

const pending: AgentInteraction = {
  id: 'local-interaction',
  originRunId: 'local-run',
  status: 'pending',
  title: 'Confirmation',
  description: 'Synthetic operation only',
  actions: ['approve', 'reject'],
  commentMaxLength: 500,
  expiresAt: null,
};

describe('shared agent interactions', () => {
  const updated = jest.fn().mockResolvedValue(undefined);
  const options = {
    appId: 'app',
    actorId: 'actor',
    conversationId: 'conversation',
    enabled: true,
    revision: 'stable',
    onUpdated: updated,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(agentRequest).mockResolvedValue({ interactions: [pending] });
  });
  afterEach(() => jest.useRealTimers());

  it('restores pending forms from the authorized local conversation endpoint', async () => {
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toEqual([pending]));
    expect(result.current.blocked).toBe(true);
    expect(agentRequest).toHaveBeenCalledWith(
      'app',
      '/conversations/conversation/interactions',
      expect.any(Object)
    );
    expect(updated).not.toHaveBeenCalled();
  });

  it('does not request interactions for an unsupported backend', async () => {
    renderHook(() => useAgentInteractions({ ...options, enabled: false }));
    await act(async () => {});
    expect(agentRequest).not.toHaveBeenCalled();
  });

  it('claims a button once and sends only local ID, action, comment and submission', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(agentRequest).mockImplementation(async (_app, path, init) => {
      if (init?.method === 'POST')
        return new Promise(resolve => {
          finish = resolve;
        }) as never;
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let first!: Promise<void>;
    act(() => {
      first = result.current.respond(pending.id, 'approve', 'yes');
      void result.current.respond(pending.id, 'reject', 'no');
    });
    const posts = jest
      .mocked(agentRequest)
      .mock.calls.filter(call => call[2]?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toBe('/interactions/local-interaction/respond');
    expect(JSON.parse(posts[0][2]!.body as string)).toEqual({
      submissionId: expect.any(String),
      action: 'approve',
      comment: 'yes',
    });
    await act(async () => {
      finish({ run: {}, replayed: false });
      await first;
    });
  });

  it('reconciles accepted resume state and refreshes shared history without resending', async () => {
    let accepted = false;
    jest.mocked(agentRequest).mockImplementation(async (_app, path, init) => {
      if (init?.method === 'POST') {
        accepted = true;
        return { run: { id: 'resume' }, replayed: false } as never;
      }
      if (path === '/runs/resume')
        return {
          executionStatus: 'success',
          persistenceStatus: 'saved',
        } as never;
      return {
        interactions: [
          {
            ...pending,
            ...(accepted
              ? {
                  status: 'accepted',
                  resumeRunId: 'resume',
                  decision: { action: 'approve', comment: '' },
                }
              : {}),
          },
        ],
      } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.respond(pending.id, 'approve', '');
    });
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(result.current.uncertainId).toBeUndefined();
    expect(result.current.items[0].status).toBe('accepted');
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(1);
  });

  it('never retries an unknown answer and allows status checks only', async () => {
    jest.mocked(agentRequest).mockImplementation(async (_app, _path, init) => {
      if (init?.method === 'POST') throw new AgentRequestError(503);
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.respond(pending.id, 'approve', '');
    });
    await waitFor(() => expect(result.current.uncertainId).toBe(pending.id));
    await act(async () => {
      await result.current.respond(pending.id, 'approve', '');
    });
    act(() => result.current.check());
    await act(async () => {});
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(1);
    expect(result.current.blocked).toBe(true);
  });

  it('does not submit expired or oversized answers', async () => {
    jest.mocked(agentRequest).mockResolvedValue({
      interactions: [{ ...pending, expiresAt: '2000-01-01T00:00:00Z' }],
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.respond(pending.id, 'approve', 'a'.repeat(501));
    });
    await act(async () => {
      await result.current.respond(pending.id, 'approve', '');
    });
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(0);
  });

  it('rejects malformed expiration before sending an answer', async () => {
    jest.mocked(agentRequest).mockResolvedValue({
      interactions: [{ ...pending, expiresAt: 'not-a-date' }],
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(0);
  });

  it('bounds checks for a locally uncertain answer even if the server still reports pending', async () => {
    jest.useFakeTimers();
    jest.mocked(agentRequest).mockImplementation(async (_app, _path, init) => {
      if (init?.method === 'POST') throw new AgentRequestError(503);
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await act(async () => {});
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    for (const delay of [2000, 5000, 10000])
      await act(async () => jest.advanceTimersByTimeAsync(delay));
    expect(result.current.exhausted).toBe(true);
    expect(result.current.uncertainId).toBe(pending.id);
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(1);
  });

  it('discards an old actor or conversation response after navigation', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(agentRequest).mockImplementation(async (_app, path) => {
      if (path.includes('/conversation/'))
        return new Promise(resolve => {
          finish = resolve;
        }) as never;
      return { interactions: [] } as never;
    });
    const { result, rerender } = renderHook(
      ({ conversationId }) =>
        useAgentInteractions({ ...options, conversationId }),
      { initialProps: { conversationId: 'conversation' } }
    );
    await waitFor(() => expect(finish).toBeDefined());
    rerender({ conversationId: 'other' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      finish({ interactions: [pending] });
    });
    expect(result.current.items).toEqual([]);
  });

  it('bounds processing queries and does not treat accepted as completed', async () => {
    jest.useFakeTimers();
    jest.mocked(agentRequest).mockImplementation(async (_app, path) => {
      if (path.startsWith('/runs/'))
        return {
          executionStatus: 'unknown',
          persistenceStatus: 'pending',
        } as never;
      return {
        interactions: [
          { ...pending, status: 'unknown', resumeRunId: 'resume' },
        ],
      } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await act(async () => {});
    for (const delay of [2000, 5000, 10000])
      await act(async () => {
        await jest.advanceTimersByTimeAsync(delay);
      });
    expect(result.current.exhausted).toBe(true);
    expect(result.current.blocked).toBe(true);
    expect(updated).not.toHaveBeenCalled();
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[1].includes('/interactions'))
    ).toHaveLength(4);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60000);
    });
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[1].includes('/interactions'))
    ).toHaveLength(4);
  });

  it('keeps an accepted but still executing resume blocked until its result is saved', async () => {
    jest.mocked(agentRequest).mockImplementation(async (_app, path) => {
      if (path.startsWith('/runs/'))
        return {
          executionStatus: 'running',
          persistenceStatus: 'pending',
        } as never;
      return {
        interactions: [
          { ...pending, status: 'accepted', resumeRunId: 'resume' },
        ],
      } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.processing).toBe(true);
    expect(result.current.blocked).toBe(true);
    expect(updated).not.toHaveBeenCalled();
  });

  it('retains a rejected answer policy error after a successful read-only refresh', async () => {
    const error = new AgentRequestError(429, {
      code: 'AGENT_CONCURRENCY_LIMIT',
      retryable: true,
      source: 'fastify-api',
      severity: 'warn',
      userMessage: 'Another task is active',
      requestId: 'synthetic',
      occurredAt: '2026-01-01T00:00:00Z',
    });
    jest.mocked(agentRequest).mockImplementation(async (_app, _path, init) => {
      if (init?.method === 'POST') throw error;
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.responseError).toBe(error);
    expect(result.current.uncertainId).toBeUndefined();
    expect(result.current.items[0].status).toBe('pending');
  });

  it('allows a new explicit answer after a confirmed pre-claim moderation outage but never retries automatically', async () => {
    const outage = new AgentRequestError(503, {
      code: 'CONTENT_MODERATION_UNAVAILABLE',
      retryable: true,
      source: 'fastify-api',
      severity: 'warn',
      userMessage: 'Moderation unavailable',
      requestId: 'synthetic',
      occurredAt: '2026-01-01T00:00:00Z',
    });
    jest.mocked(agentRequest).mockImplementation(async (_app, _path, init) => {
      if (init?.method === 'POST') throw outage;
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.responseError).toBe(outage);
    expect(result.current.uncertainId).toBeUndefined();
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(1);
    await act(async () => result.current.respond(pending.id, 'reject', ''));
    expect(
      jest
        .mocked(agentRequest)
        .mock.calls.filter(call => call[2]?.method === 'POST')
    ).toHaveLength(2);
  });

  it('queries a known rejected preparation run after its claim is released and requires an explicit new answer', async () => {
    let posts = 0;
    jest.mocked(agentRequest).mockImplementation(async (_app, path, init) => {
      if (init?.method === 'POST') {
        posts++;
        return { run: { id: 'undispatched' }, replayed: false } as never;
      }
      if (path === '/runs/undispatched')
        return {
          executionStatus: 'error',
          persistenceStatus: 'saved',
          errorCode: 'AGENT_RESUME_NOT_DISPATCHED',
        } as never;
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    await waitFor(() => expect(result.current.notDispatched).toBe(true));
    expect(result.current.uncertainId).toBeUndefined();
    expect(result.current.processing).toBe(false);
    expect(posts).toBe(1);
    expect(result.current.items[0].status).toBe('pending');
    expect(updated).toHaveBeenCalled();
    act(() => result.current.check());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(posts).toBe(1);
    await act(async () => result.current.respond(pending.id, 'reject', ''));
    expect(posts).toBe(2);
    const bodies = jest
      .mocked(agentRequest)
      .mock.calls.filter(call => call[2]?.method === 'POST')
      .map(call => JSON.parse(call[2]!.body as string));
    expect(bodies[0].submissionId).not.toBe(bodies[1].submissionId);
  });

  it.each([
    {
      label: 'running',
      executionStatus: 'running',
      persistenceStatus: 'pending',
      errorCode: undefined,
    },
    {
      label: 'not saved',
      executionStatus: 'error',
      persistenceStatus: 'failed',
      errorCode: 'AGENT_RESUME_NOT_DISPATCHED',
    },
    {
      label: 'another error',
      executionStatus: 'error',
      persistenceStatus: 'saved',
      errorCode: 'AGENT_RESUME_RESULT_UNKNOWN',
    },
    { label: 'read failure', failure: true },
  ])('never releases an uncertain known resume on $label', async scenario => {
    let posts = 0;
    jest.mocked(agentRequest).mockImplementation(async (_app, path, init) => {
      if (init?.method === 'POST') {
        posts++;
        return { run: { id: 'uncertain-resume' }, replayed: false } as never;
      }
      if (path === '/runs/uncertain-resume') {
        if ('failure' in scenario) throw new AgentRequestError(503);
        return scenario as never;
      }
      return { interactions: [pending] } as never;
    });
    const { result } = renderHook(() => useAgentInteractions(options));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.respond(pending.id, 'approve', ''));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.uncertainId).toBe(pending.id);
    expect(result.current.notDispatched).not.toBe(true);
    expect(result.current.blocked).toBe(true);
    await act(async () => result.current.respond(pending.id, 'reject', ''));
    expect(posts).toBe(1);
    act(() => result.current.check());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.uncertainId).toBe(pending.id);
    expect(posts).toBe(1);
  });

  it('queries a pending expiration once and keeps expired unresolved tasks protected', async () => {
    jest.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    jest.mocked(agentRequest).mockImplementation(
      async () =>
        ({
          interactions: [
            {
              ...pending,
              expiresAt,
              status:
                Date.parse(expiresAt) <= Date.now() ? 'expired' : 'pending',
            },
          ],
        }) as never
    );
    const { result } = renderHook(() => useAgentInteractions(options));
    await act(async () => {});
    expect(agentRequest).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(agentRequest).toHaveBeenCalledTimes(2);
    expect(result.current.items[0].status).toBe('expired');
    expect(result.current.blocked).toBe(true);
    await act(async () => jest.advanceTimersByTimeAsync(60000));
    expect(agentRequest).toHaveBeenCalledTimes(2);
  });
});
