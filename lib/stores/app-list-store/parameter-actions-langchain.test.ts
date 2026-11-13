import { createParameterActions } from './parameter-actions';
import { fetchDifyAppParametersByInstanceId } from './shared';
import type { AppListStoreGet, AppListStoreSet } from './types';

jest.mock('./shared', () => ({
  fetchDifyAppParametersByInstanceId: jest.fn(),
}));

it('never fetches Dify parameters for LangChain apps in either prefetch path', async () => {
  const state = {
    apps: [
      {
        id: 'agent-uuid',
        instance_id: 'agent',
        config: { backend_type: 'langchain' },
      },
    ],
    lastParametersFetchTime: 0,
    parametersCache: {},
    fetchingApps: new Set(),
    fetchApps: jest.fn(),
  };
  const actions = createParameterActions(
    jest.fn() as AppListStoreSet,
    (() => state) as unknown as AppListStoreGet
  );
  await actions.fetchAllAppParameters();
  await actions.fetchAppParameters('agent-uuid');
  expect(fetchDifyAppParametersByInstanceId).not.toHaveBeenCalled();
});
