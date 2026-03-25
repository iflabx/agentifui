/** @jest-environment node */
import type { DifyAppParametersResponse } from '@lib/services/dify/types';
import {
  createClearedParameterState,
  createUserScopedReset,
  dedupeAccessibleApps,
  getFreshCachedParameters,
  isCacheValid,
  normalizeAdminApps,
  toAppInfo,
} from '@lib/stores/app-list-store/helpers';

describe('app list store helpers', () => {
  it('maps and deduplicates accessible apps', () => {
    const source = {
      service_instance_id: 'svc-1',
      display_name: 'Demo',
      description: 'desc',
      instance_id: 'demo',
      api_path: '',
      visibility: 'group_only',
      config: {},
      usage_quota: 10,
      used_count: 2,
      quota_remaining: 8,
      group_name: 'team',
    } as const;

    expect(toAppInfo(source)).toMatchObject({
      id: 'svc-1',
      name: 'Demo',
      visibility: 'group_only',
    });
    expect(dedupeAccessibleApps([source, source])).toHaveLength(1);
  });

  it('normalizes cache and reset state', () => {
    expect(isCacheValid(Date.now(), 1, Date.now())).toBe(true);
    expect(isCacheValid(Date.now() - 31 * 60 * 1000, 1, Date.now())).toBe(
      false
    );
    expect(createUserScopedReset('u1')).toMatchObject({
      apps: [],
      currentUserId: 'u1',
      error: null,
    });
    expect(createClearedParameterState()).toMatchObject({
      parametersCache: {},
      parametersError: null,
    });
  });

  it('normalizes admin apps and reads fresh parameter cache', () => {
    expect(
      normalizeAdminApps([{ id: '1', name: 'Demo', instance_id: 'demo' }])
    ).toEqual([
      { id: '1', name: 'Demo', instance_id: 'demo', visibility: 'public' },
    ]);

    const cache = {
      demo: {
        data: { opening_statement: 'hello' } as DifyAppParametersResponse,
        timestamp: Date.now(),
      },
    };
    expect(getFreshCachedParameters(cache, 'demo', Date.now())).toEqual({
      opening_statement: 'hello',
    });
    expect(
      getFreshCachedParameters(cache, 'demo', Date.now() + 31 * 60 * 1000)
    ).toBeNull();
  });
});
