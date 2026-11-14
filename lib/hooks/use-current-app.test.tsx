import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { act, renderHook } from '@testing-library/react';

import { useCurrentApp } from './use-current-app';

describe('submission app configuration ownership', () => {
  it('resolves captured A without switching the selection back from B', async () => {
    let respond!: (value: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          respond = resolve;
        })
    );
    useCurrentAppStore.setState({
      currentAppId: 'app-A',
      currentAppInstance: { instance_id: 'app-A' } as never,
    });
    const { result } = renderHook(() => useCurrentApp());
    let pending!: ReturnType<typeof result.current.ensureAppReady>;
    act(() => {
      pending = result.current.ensureAppReady('app-A');
    });
    act(() => {
      useCurrentAppStore.setState({
        currentAppId: 'app-B',
        currentAppInstance: { instance_id: 'app-B' } as never,
      });
    });
    await act(async () => {
      respond({
        ok: true,
        json: async () => ({ success: true, app: { instance_id: 'app-A' } }),
      } as Response);
      await expect(pending).resolves.toMatchObject({ appId: 'app-A' });
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps?instanceId=app-A',
      expect.anything()
    );
    expect(useCurrentAppStore.getState().currentAppId).toBe('app-B');
    expect(useCurrentAppStore.getState().currentAppInstance?.instance_id).toBe(
      'app-B'
    );
  });
});
