import { useChatInputStore } from '@lib/stores/chat-input-store';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { AgentInputCapabilities } from '../../packages/shared/src/agent-input';
import { useAgentInputCapabilities } from './use-agent-input-capabilities';

const ready: AgentInputCapabilities = {
  version: 1,
  status: 'ready',
  mode: 'conversation',
  text: { enabled: true, required: true, target: 'query' },
  fields: [],
  attachmentSlots: [],
};
const respond = (capabilities = ready) =>
  ({ ok: true, json: async () => capabilities }) as Response;

describe('live input capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatInputStore.getState().setActor('actor');
  });

  it('fetches the UUID with credentials, fails closed and supports retry', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce(respond());
    const { result } = renderHook(() =>
      useAgentInputCapabilities('instance-uuid')
    );
    expect(result.current.capabilities).toBeNull();
    await waitFor(() =>
      expect(result.current.error).toBe('INPUT_CAPABILITIES_UNAVAILABLE')
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps/instance-uuid/input-capabilities',
      expect.objectContaining({ credentials: 'include', method: 'GET' })
    );
    act(() => result.current.retry());
    expect(result.current.capabilities).toBeNull();
    await waitFor(() => expect(result.current.capabilities).toEqual(ready));
  });

  it('does not show or accept stale capabilities when app or actor changes', async () => {
    let finish!: (response: Response) => void;
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(respond())
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      )
      .mockResolvedValueOnce(respond({ ...ready, status: 'unsupported' }));
    const { result, rerender } = renderHook(
      ({ appId }) => useAgentInputCapabilities(appId),
      { initialProps: { appId: 'A' } }
    );
    await waitFor(() =>
      expect(result.current.capabilities?.status).toBe('ready')
    );
    rerender({ appId: 'B' });
    expect(result.current.capabilities).toBeNull();
    act(() => useChatInputStore.getState().setActor('other'));
    await waitFor(() =>
      expect(result.current.capabilities?.status).toBe('unsupported')
    );
    await act(async () => finish(respond()));
    expect(result.current.capabilities?.status).toBe('unsupported');
  });

  it('refreshes on a round trip and never reuses the previous ready result', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(respond())
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ appId }) => useAgentInputCapabilities(appId),
      { initialProps: { appId: 'A' as string | null } }
    );
    await waitFor(() =>
      expect(result.current.capabilities?.status).toBe('ready')
    );
    rerender({ appId: null });
    rerender({ appId: 'A' });
    expect(result.current.capabilities).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown versions and malformed responses rather than guessing', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(respond({ ...ready, version: 2 } as never));
    const { result } = renderHook(() => useAgentInputCapabilities('A'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.capabilities).toBeNull();
  });
});
