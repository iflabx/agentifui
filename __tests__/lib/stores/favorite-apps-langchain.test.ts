import { useFavoriteAppsStore } from '@lib/stores/favorite-apps-store';

beforeEach(() => {
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
