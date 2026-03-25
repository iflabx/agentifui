/** @jest-environment node */
import {
  appendApiKey,
  buildDefaultDifyInstance,
  buildDefaultDifyProvider,
  buildServiceInstancePayload,
  handleResult,
  sortServiceInstances,
} from '@lib/stores/api-config-store/helpers';
import type { ServiceInstance } from '@lib/types/database';
import { failure, success } from '@lib/types/result';

describe('api config store helpers', () => {
  it('normalizes results and instance payloads', () => {
    expect(handleResult(success('ok'), 'test')).toBe('ok');
    expect(() => handleResult(failure(new Error('boom')), 'test')).toThrow(
      'test failed: boom'
    );

    expect(
      buildServiceInstancePayload({ instance_id: 'demo' } as never)
    ).toEqual({
      provider_id: '1',
      display_name: '',
      description: '',
      instance_id: 'demo',
      api_path: '',
      is_default: false,
      visibility: 'public',
      config: {},
    });
  });

  it('builds default Dify provider/instance records', () => {
    expect(buildDefaultDifyProvider('https://api.dify.ai')).toMatchObject({
      name: 'Dify',
      base_url: 'https://api.dify.ai',
    });
    expect(buildDefaultDifyInstance('provider-1')).toMatchObject({
      provider_id: 'provider-1',
      instance_id: 'default',
      is_default: true,
    });
  });

  it('sorts instances and appends api keys', () => {
    const sorted = sortServiceInstances([
      { id: '2', display_name: 'Zed', instance_id: 'z' },
      { id: '1', display_name: 'Alpha', instance_id: 'a' },
    ] as ServiceInstance[]);
    expect(sorted.map(instance => instance.id)).toEqual(['1', '2']);

    expect(
      appendApiKey([{ id: '1' } as never], { id: '2' } as never).map(
        apiKey => apiKey.id
      )
    ).toEqual(['1', '2']);
  });
});
