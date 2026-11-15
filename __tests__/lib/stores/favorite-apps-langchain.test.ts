import {
  resolveFavoriteAppRoute,
  useFavoriteAppsStore,
} from '@lib/stores/favorite-apps-store';

beforeEach(() => {
  jest.mocked(fetch).mockReset();
  useFavoriteAppsStore.setState({ favoriteApps: [] });
});

afterEach(() => {
  useFavoriteAppsStore.setState({ favoriteApps: [] });
});

it('keeps LangChain favorites identified by the service UUID when synchronizing the app list', () => {
  useFavoriteAppsStore.getState().addFavoriteApp({
    instanceId: 'service-uuid',
    serviceInstanceId: 'service-uuid',
    backendType: 'langchain',
    displayName: 'Example Agent',
    appType: 'marketplace',
  });
  useFavoriteAppsStore.getState().syncWithAppList([
    {
      id: 'service-uuid',
      instance_id: 'agent-name',
      display_name: 'Updated Agent',
      config: { backend_type: 'langchain' },
    },
  ]);
  expect(useFavoriteAppsStore.getState().favoriteApps).toEqual([
    expect.objectContaining({
      instanceId: 'service-uuid',
      serviceInstanceId: 'service-uuid',
      backendType: 'langchain',
      displayName: 'Updated Agent',
    }),
  ]);
});

it('keeps Dify favorites on their existing native app identifier', () => {
  useFavoriteAppsStore.getState().addFavoriteApp({
    instanceId: 'dify-app',
    displayName: 'Dify',
    appType: 'marketplace',
  });
  useFavoriteAppsStore.getState().syncWithAppList([
    {
      id: 'dify-service-uuid',
      instance_id: 'dify-app',
      display_name: 'Dify',
      config: {},
    },
  ]);
  expect(useFavoriteAppsStore.getState().favoriteApps[0]).toMatchObject({
    instanceId: 'dify-app',
    backendType: 'dify',
  });
});

describe('favorite app entry resolution', () => {
  const favorite = {
    instanceId: 'native-app',
    serviceInstanceId: 'service-uuid',
  };

  it('keeps synchronization pinned to the cached service UUID rather than a same-named app', () => {
    useFavoriteAppsStore.getState().addFavoriteApp({
      ...favorite,
      displayName: 'Original',
      appType: 'marketplace',
    });
    useFavoriteAppsStore.getState().syncWithAppList([
      { id: 'other-service', instance_id: 'native-app', display_name: 'Other' },
      {
        id: 'service-uuid',
        instance_id: 'native-app',
        display_name: 'Updated',
      },
    ]);
    expect(useFavoriteAppsStore.getState().favoriteApps[0]).toMatchObject({
      serviceInstanceId: 'service-uuid',
      displayName: 'Updated',
    });
    useFavoriteAppsStore.getState().syncWithAppList([
      {
        id: 'other-service',
        instance_id: 'native-app',
        display_name: 'Other',
      },
    ]);
    expect(useFavoriteAppsStore.getState().favoriteApps).toEqual([]);
  });

  function respond(config: Record<string, unknown>) {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        apps: [{ id: 'service-uuid', instance_id: 'native-app', config }],
      }),
    } as Response);
  }

  it('uses a fresh protected lookup and the service UUID for an opted-in Dify app', async () => {
    respond({
      backend_type: 'dify',
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
    });
    expect(await resolveFavoriteAppRoute(favorite)).toBe(
      '/apps/agent-chat/service-uuid'
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' })
    );
  });

  it('does not trust a cached opt-in after the latest app configuration disables it', async () => {
    const cached = { ...favorite, interaction_protocol: 'ag-ui/1.0' };
    respond({
      backend_type: 'dify',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
    });
    expect(await resolveFavoriteAppRoute(cached)).toBe(
      '/apps/chatbot/native-app'
    );
  });

  it('does not migrate model favorites even with a stale explicit opt-in', async () => {
    respond({
      backend_type: 'dify',
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'model', dify_apptype: 'chatbot' },
    });
    expect(await resolveFavoriteAppRoute(favorite)).toBe(
      '/apps/chatbot/native-app'
    );
  });

  it('keeps other Dify modes on their latest legacy route and routes LangChain publicly by default', async () => {
    respond({
      backend_type: 'dify',
      app_metadata: { dify_apptype: 'workflow' },
    });
    expect(await resolveFavoriteAppRoute(favorite)).toBe(
      '/apps/workflow/native-app'
    );
    respond({ backend_type: 'langchain' });
    expect(await resolveFavoriteAppRoute(favorite)).toBe(
      '/apps/agent-chat/service-uuid'
    );
  });

  it('does not fall back to persisted routing when the fresh request fails or access is lost', async () => {
    jest.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    await expect(resolveFavoriteAppRoute(favorite)).rejects.toThrow(
      'App lookup failed'
    );
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, apps: [] }),
    } as Response);
    await expect(resolveFavoriteAppRoute(favorite)).rejects.toThrow(
      'App unavailable'
    );
  });

  it('never substitutes a different service with the same native app identifier', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        apps: [
          { id: 'different-service', instance_id: 'native-app', config: {} },
        ],
      }),
    } as Response);
    await expect(resolveFavoriteAppRoute(favorite)).rejects.toThrow(
      'App unavailable'
    );
  });

  it('resolves old favorites without a cached service UUID from the authorized response', async () => {
    respond({
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
    });
    expect(await resolveFavoriteAppRoute({ instanceId: 'native-app' })).toBe(
      '/apps/agent-chat/service-uuid'
    );
  });
});
