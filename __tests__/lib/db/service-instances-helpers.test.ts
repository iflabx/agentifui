/** @jest-environment node */
import {
  buildServiceInstanceSetClause,
  getValidServiceInstanceUpdateKeys,
  normalizeServiceInstanceRow,
} from '@lib/db/service-instances/helpers';

describe('service instance helpers', () => {
  it('normalizes db rows into service instances', () => {
    expect(
      normalizeServiceInstanceRow({
        id: '1',
        provider_id: 'p1',
        display_name: 'Demo',
        description: null,
        instance_id: 'demo',
        api_path: undefined,
        is_default: 1,
        visibility: 'public',
        config: { a: 1 },
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: '2026-01-02T00:00:00Z',
      })
    ).toEqual({
      id: '1',
      provider_id: 'p1',
      display_name: 'Demo',
      description: null,
      instance_id: 'demo',
      api_path: '',
      is_default: true,
      visibility: 'public',
      config: { a: 1 },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('filters valid update keys and builds set clauses', () => {
    const { updateKeys, validKeys } = getValidServiceInstanceUpdateKeys({
      display_name: 'Demo',
      config: { foo: 'bar' },
      'bad key': 'x',
    } as never);

    expect(updateKeys).toEqual(['display_name', 'config', 'bad key']);
    expect(validKeys).toEqual(['display_name', 'config']);

    expect(
      buildServiceInstanceSetClause(
        {
          display_name: 'Demo',
          config: { foo: 'bar' },
        },
        validKeys
      )
    ).toEqual({
      nextParamIndex: 3,
      setClauses: ['display_name = $1', 'config = $2::jsonb'],
      values: ['Demo', '{"foo":"bar"}'],
    });
  });
});
