import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { act, renderHook } from '@testing-library/react';

import { useChatInputApp } from './use-chat-input-app';

function respond(instanceId: string) {
  return {
    ok: true,
    json: async () => ({ success: true, app: { instance_id: instanceId } }),
  } as Response;
}

describe('history input app ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncChatDraftActor('actor');
    useCurrentAppStore.setState({
      currentAppId: 'app-B',
      currentAppInstance: { instance_id: 'app-B' } as never,
    });
  });

  it('resolves history A upload configuration without changing selected B', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(respond('app-A'));
    const { result } = renderHook(() => useChatInputApp('app-A', true));
    await act(async () => {});
    expect(result.current.instance?.instance_id).toBe('app-A');
    expect(useCurrentAppStore.getState().currentAppId).toBe('app-B');
  });

  it('does not adopt a late A configuration after moving to B', async () => {
    let finish!: (value: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ appId }) => useChatInputApp(appId, true),
      { initialProps: { appId: 'app-A' } }
    );
    rerender({ appId: 'app-B' });
    await act(async () => {
      finish(respond('app-A'));
    });
    expect(result.current.instance?.instance_id).toBe('app-B');
  });

  it('does not adopt a prior login configuration after logout', async () => {
    let finish!: (value: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ ready }) => useChatInputApp('app-A', ready),
      { initialProps: { ready: true } }
    );
    act(() => {
      syncChatDraftActor(null);
    });
    rerender({ ready: false });
    await act(async () => {
      finish(respond('app-A'));
    });
    expect(result.current.instance).toBeNull();
  });

  it.each(['network', 'empty'])(
    'offers same-page recovery after a %s lookup failure without falling back to B',
    async failure => {
      if (failure === 'network')
        jest
          .mocked(fetch)
          .mockRejectedValueOnce(new Error('Synthetic offline'));
      else jest.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
      jest.mocked(fetch).mockResolvedValueOnce(respond('app-A'));
      const { result } = renderHook(() => useChatInputApp('app-A', true));
      await act(async () => {});
      expect(result.current.instance).toBeNull();
      expect(result.current.failed).toBe(true);
      await act(async () => {
        result.current.retry();
      });
      expect(result.current.instance?.instance_id).toBe('app-A');
      expect(result.current.failed).toBe(false);
      expect(useCurrentAppStore.getState().currentAppId).toBe('app-B');
    }
  );
});
