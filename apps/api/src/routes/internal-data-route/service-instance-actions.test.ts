/** @jest-environment node */
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { ensureProviderDefaultServiceInstance } from './domain-helpers';
import { handleServiceInstanceAction } from './service-instance-actions';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  systemQueryForClient: () =>
    jest.requireMock('../../lib/pg-context').queryRowsWithPgSystemContext,
}));
jest.mock('./domain-helpers', () => ({
  ensureProviderDefaultServiceInstance: jest.fn(),
}));

const query = jest.mocked(queryRowsWithPgSystemContext);
const row = {
  id: 'service',
  provider_id: 'provider',
  instance_id: 'native-app',
  config: {},
};

beforeEach(() => {
  jest.resetAllMocks();
  query.mockResolvedValue([row]);
});

describe('service instance interaction protocol validation', () => {
  it.each(['serviceInstances.create', 'serviceInstances.update'])(
    '%s rejects invalid protocol and mode combinations before database side effects',
    async action => {
      const invalidConfigs = [
        { interaction_protocol: 'ag-ui/2.0' },
        { interaction_protocol: null },
        { interaction_protocol: false },
        { interaction_protocol: 'ag-ui/1.0' },
        {
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { dify_apptype: 'chatbot' },
        },
        {
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'model', dify_apptype: 'chatbot' },
        },
        ...['agent', 'chatflow', 'workflow', 'text-generation'].map(type => ({
          backend_type: 'dify',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: type },
        })),
        {
          backend_type: 'langchain',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
        },
        {
          backend_type: 'unknown',
          interaction_protocol: 'ag-ui/1.0',
          app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
        },
      ];
      for (const config of invalidConfigs) {
        const response = await handleServiceInstanceAction(action, {
          id: 'service',
          serviceInstance: {
            provider_id: 'provider',
            instance_id: 'native-app',
            is_default: true,
            config,
          },
          updates: { config, is_default: true },
        });
        expect(response?.statusCode).toBe(400);
      }
      expect(query).not.toHaveBeenCalled();
      expect(ensureProviderDefaultServiceInstance).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { backend_type: 'langchain' },
    { backend_type: 'dify', app_metadata: { dify_apptype: 'workflow' } },
    {
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
    },
    {
      backend_type: 'dify',
      interaction_protocol: 'ag-ui/1.0',
      app_metadata: { app_type: 'marketplace', dify_apptype: 'chatbot' },
    },
  ])(
    'preserves compatible create and update configurations: %p',
    async config => {
      const created = await handleServiceInstanceAction(
        'serviceInstances.create',
        {
          serviceInstance: {
            provider_id: 'provider',
            instance_id: 'native-app',
            config,
          },
        }
      );
      expect(created?.statusCode).toBe(200);
      const insert = query.mock.calls.find(([sql]) =>
        sql.includes('INSERT INTO service_instances')
      );
      expect(insert?.[1]).toContain(JSON.stringify(config));
      query.mockClear();
      const updated = await handleServiceInstanceAction(
        'serviceInstances.update',
        {
          id: 'service',
          updates: { config },
        }
      );
      expect(updated?.statusCode).toBe(200);
      const update = query.mock.calls.find(([sql]) =>
        sql.includes('SET config =')
      );
      expect(update?.[1]).toContain(JSON.stringify(config));
    }
  );

  it('does not require protocol revalidation when updating unrelated fields', async () => {
    const response = await handleServiceInstanceAction(
      'serviceInstances.update',
      {
        id: 'service',
        updates: { display_name: 'Updated' },
      }
    );
    expect(response?.statusCode).toBe(200);
  });
});
