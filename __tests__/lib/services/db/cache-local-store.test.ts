import { CacheLocalStore } from '@lib/services/db/cache-service/local-store';

describe('CacheLocalStore', () => {
  it('deletes wildcard-matched entries and inflight promises together', async () => {
    const store = new CacheLocalStore();

    store.set('users:1', { id: '1' }, 1000);
    store.set('users:2', { id: '2' }, 1000);
    store.set('groups:1', { id: 'g1' }, 1000);
    store.trackInflight('users:2', Promise.resolve({ id: '2' }));

    expect(store.deletePattern('users:*')).toBe(2);
    expect(store.has('users:1')).toBe(false);
    expect(store.has('users:2')).toBe(false);
    expect(store.has('groups:1')).toBe(true);
    expect(store.getInflight('users:2')).toBeUndefined();
  });

  it('applies remote invalidation payloads to local state', () => {
    const store = new CacheLocalStore();

    store.set('profile:1', { id: '1' }, 1000);
    store.trackInflight('profile:1', Promise.resolve({ id: '1' }));
    store.applyRemoteInvalidation({
      origin: 'peer',
      operation: 'delete',
      key: 'profile:1',
    });

    expect(store.has('profile:1')).toBe(false);
    expect(store.getInflight('profile:1')).toBeUndefined();
  });
});
