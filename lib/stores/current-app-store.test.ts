import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import type { ServiceInstance } from '@lib/types/database';
import { waitFor } from '@testing-library/react';

import { useCurrentAppStore } from './current-app-store';

jest.mock('@lib/auth/better-auth/http-client', () => ({
  getCurrentUser: jest.fn(),
}));

describe('current application persistence', () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(getCurrentUser).mockResolvedValue({ id: 'actor' } as never);
    useCurrentAppStore.getState().clearCurrentApp();
    localStorage.clear();
  });

  it('persists only the selected ID, not application metadata', () => {
    useCurrentAppStore.getState().setCurrentAppId('app-A', {
      instance_id: 'app-A',
      description: 'In-memory description',
      config: { attachment_limit: 2 },
    } as unknown as ServiceInstance);
    expect(
      JSON.parse(localStorage.getItem('current-app-storage')!).state
    ).toEqual({ currentAppId: 'app-A' });
    expect(useCurrentAppStore.getState().currentAppInstance?.description).toBe(
      'In-memory description'
    );
  });

  it('ignores legacy metadata and temporary state while restoring the selected ID', async () => {
    localStorage.setItem(
      'current-app-storage',
      JSON.stringify({
        state: {
          currentAppId: 'app-A',
          currentAppInstance: { instance_id: 'app-A', description: 'Outdated' },
          isLoadingAppId: true,
        },
        version: 0,
      })
    );
    await useCurrentAppStore.persist.rehydrate();
    expect(useCurrentAppStore.getState()).toMatchObject({
      currentAppId: 'app-A',
      currentAppInstance: null,
      isLoadingAppId: false,
    });
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        app: { instance_id: 'app-A', description: 'Latest' },
      }),
    } as Response);
    await useCurrentAppStore.getState().initializeDefaultAppId();
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps?instanceId=app-A',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(useCurrentAppStore.getState().currentAppInstance?.description).toBe(
      'Latest'
    );
    expect(
      JSON.parse(localStorage.getItem('current-app-storage')!).state
    ).toEqual({ currentAppId: 'app-A' });
  });

  it('still resolves the default app when no selection is stored', async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        app: { instance_id: 'app-default' },
      }),
    } as Response);
    await useCurrentAppStore.getState().initializeDefaultAppId();
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps?mode=default',
      expect.anything()
    );
    expect(useCurrentAppStore.getState().currentAppId).toBe('app-default');
  });

  it('does not restore metadata before authentication', async () => {
    useCurrentAppStore.setState({ currentAppId: 'app-A' });
    jest.mocked(getCurrentUser).mockResolvedValueOnce(null);
    await useCurrentAppStore.getState().initializeDefaultAppId();
    expect(fetch).not.toHaveBeenCalled();
    expect(useCurrentAppStore.getState().currentAppInstance).toBeNull();
  });

  it('does not silently replace an unavailable saved app with a default app', async () => {
    useCurrentAppStore.setState({ currentAppId: 'app-A' });
    jest.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await useCurrentAppStore.getState().initializeDefaultAppId();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useCurrentAppStore.getState().currentAppInstance).toBeNull();
    expect(useCurrentAppStore.getState().errorLoadingAppId).not.toBeNull();
  });

  it('does not overwrite a new selection with a late initialization response', async () => {
    useCurrentAppStore.setState({ currentAppId: 'app-A' });
    let finish!: (value: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const pending = useCurrentAppStore.getState().initializeDefaultAppId();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    useCurrentAppStore.getState().setCurrentAppId('app-B', {
      instance_id: 'app-B',
    } as ServiceInstance);
    finish({
      ok: true,
      json: async () => ({ success: true, app: { instance_id: 'app-A' } }),
    } as Response);
    await pending;
    expect(useCurrentAppStore.getState().currentAppId).toBe('app-B');
  });
});
