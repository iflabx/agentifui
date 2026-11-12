/** @jest-environment node */
import { CacheRedisLayer } from '@lib/services/db/cache-service/redis-layer';
import {
  createRedisClient,
  resolveRedisUrl,
} from '@lib/services/db/cache-service/redis-runtime';
import type { RedisClientLike } from '@lib/services/db/cache-service/types';

jest.mock('@lib/services/db/cache-service/redis-runtime', () => ({
  createRedisClient: jest.fn(),
  resolveRedisUrl: jest.fn(),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createClient() {
  const client = {
    isOpen: false,
    connect: jest.fn(async () => {
      client.isOpen = true;
    }),
    destroy: jest.fn(() => {
      client.isOpen = false;
    }),
    quit: jest.fn(async () => {
      client.isOpen = false;
    }),
    duplicate: jest.fn<RedisClientLike, []>(),
    get: jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest
      .fn<Promise<void>, [string, (message: string) => void]>()
      .mockResolvedValue(undefined),
    scanIterator: jest.fn(async function* () {
      yield [];
    }),
    on: jest.fn(),
  };
  return client;
}

describe('CacheRedisLayer connection ownership', () => {
  let layer: CacheRedisLayer;
  let command: ReturnType<typeof createClient>;
  let subscriber: ReturnType<typeof createClient>;
  let warning: jest.SpyInstance;
  const onRemoteInvalidation = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    command = createClient();
    subscriber = createClient();
    command.duplicate.mockReturnValue(subscriber);
    jest.mocked(createRedisClient).mockReturnValue(command);
    jest
      .mocked(resolveRedisUrl)
      .mockReturnValue('redis://cache.example.invalid');
    layer = new CacheRedisLayer({
      enabled: true,
      keyPrefix: 'cache-test',
      invalidationEnabled: true,
      invalidationChannel: 'cache-test:invalidate',
      invalidationOrigin: 'test-origin',
      debugLogs: false,
      onRemoteInvalidation,
    });
  });

  afterEach(() => {
    layer.destroy();
    warning.mockRestore();
  });

  it('preserves cache hits, writes and peer invalidations while active', async () => {
    command.get.mockResolvedValue(JSON.stringify({ id: 'profile' }));
    const onHit = jest.fn();
    expect(await layer.read('profile', 1500, onHit)).toEqual({ id: 'profile' });
    expect(onHit).toHaveBeenCalledWith({ id: 'profile' }, 1500);
    expect(command.get).toHaveBeenCalledWith('cache-test:profile');
    await layer.write('profile', { id: 'updated' }, 1500);
    expect(command.set).toHaveBeenCalledWith(
      'cache-test:profile',
      JSON.stringify({ id: 'updated' }),
      { EX: 2 }
    );
    const listener = subscriber.subscribe.mock.calls[0][1];
    const peerMessage = { origin: 'peer', operation: 'clear' };
    listener(JSON.stringify(peerMessage));
    listener(JSON.stringify({ origin: 'test-origin', operation: 'clear' }));
    expect(onRemoteInvalidation).toHaveBeenCalledTimes(1);
    expect(onRemoteInvalidation).toHaveBeenCalledWith(peerMessage);
    expect(layer.getMetrics().l2Hits).toBe(1);
    expect(layer.isL2Enabled()).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });

  it('closes both owned connections exactly once and cannot restart after destruction', async () => {
    await layer.read('profile', 1000, jest.fn());
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);

    layer.destroy();
    layer.destroy();
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(subscriber.destroy).toHaveBeenCalledTimes(1);
    expect(layer.isL2Enabled()).toBe(false);
    expect(await layer.read('later', 1000, jest.fn())).toBeNull();
    await layer.write('later', {}, 1000);
    expect(createRedisClient).toHaveBeenCalledTimes(1);
    expect(command.get).toHaveBeenCalledTimes(1);
    expect(command.set).not.toHaveBeenCalled();
  });

  it('shares a pending connection between simultaneous cache operations', async () => {
    const connecting = deferred();
    const clients: ReturnType<typeof createClient>[] = [];
    jest.mocked(createRedisClient).mockImplementation(() => {
      const client = createClient();
      client.duplicate.mockReturnValue(subscriber);
      client.connect.mockImplementation(async () => {
        client.isOpen = true;
        await connecting.promise;
      });
      clients.push(client);
      return client;
    });

    const pending = Promise.all([
      layer.read('profile', 1000, jest.fn()),
      layer.write('profile', {}, 1000),
      layer.deleteKey('old-profile'),
    ]);
    connecting.resolve();
    await pending;
    layer.destroy();

    expect(clients).toHaveLength(1);
    expect(clients[0].connect).toHaveBeenCalledTimes(1);
    expect(clients[0].destroy).toHaveBeenCalledTimes(1);
    expect(command.duplicate).not.toHaveBeenCalled();
  });

  it('closes an in-progress connection and does not create a late subscriber', async () => {
    const connecting = deferred();
    command.connect.mockImplementation(async () => {
      command.isOpen = true;
      await connecting.promise;
    });
    const reading = layer.read('profile', 1000, jest.fn());
    layer.destroy();
    connecting.resolve();

    expect(await reading).toBeNull();
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(command.get).not.toHaveBeenCalled();
    expect(command.duplicate).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it('closes a subscriber while its connection is still being established', async () => {
    const connecting = deferred();
    subscriber.connect.mockImplementation(async () => {
      subscriber.isOpen = true;
      await connecting.promise;
    });
    await layer.read('profile', 1000, jest.fn());
    layer.destroy();
    connecting.resolve();
    await subscriber.connect.mock.results[0].value;

    expect(subscriber.destroy).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).not.toHaveBeenCalled();
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('ignores invalidation callbacks after destruction during subscribe', async () => {
    const subscribing = deferred();
    subscriber.subscribe.mockReturnValue(subscribing.promise);
    await layer.read('profile', 1000, jest.fn());
    const listener = subscriber.subscribe.mock.calls[0][1] as (
      value: string
    ) => void;
    layer.destroy();
    subscribing.resolve();
    await subscribing.promise;
    listener(JSON.stringify({ origin: 'peer', operation: 'clear' }));

    expect(subscriber.destroy).toHaveBeenCalledTimes(1);
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(onRemoteInvalidation).not.toHaveBeenCalled();
  });

  it('releases a partially connected command client when initialization fails', async () => {
    command.connect.mockImplementation(async () => {
      command.isOpen = true;
      throw new Error('test connection failure');
    });
    expect(await layer.read('profile', 1000, jest.fn())).toBeNull();
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(command.duplicate).not.toHaveBeenCalled();
  });

  it.each(['connect', 'subscribe'] as const)(
    'releases a subscriber after %s failure without closing the usable command client',
    async operation => {
      if (operation === 'connect') {
        subscriber.connect.mockImplementation(async () => {
          subscriber.isOpen = true;
          throw new Error('test subscriber connection failure');
        });
      } else {
        subscriber.subscribe.mockRejectedValue(
          new Error('test subscription failure')
        );
      }
      await layer.read('profile', 1000, jest.fn());

      expect(subscriber.destroy).toHaveBeenCalledTimes(1);
      expect(command.destroy).not.toHaveBeenCalled();
      expect(command.isOpen).toBe(true);
    }
  );

  it('handles duplicate failures without leaking an unhandled rejection', async () => {
    command.duplicate.mockImplementation(() => {
      throw new Error('test duplicate failure');
    });
    expect(await layer.read('profile', 1000, jest.fn())).toBeNull();
    expect(command.isOpen).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it('settles an interrupted invalidation publish without warning after destruction', async () => {
    const started = deferred();
    let rejectPublish!: (reason: Error) => void;
    const pending = new Promise<number>((_resolve, reject) => {
      rejectPublish = reject;
    });
    command.publish.mockImplementation(() => {
      started.resolve();
      return pending;
    });
    const publishing = layer.publishInvalidation('clear');
    await started.promise;
    layer.destroy();
    rejectPublish(new Error('test shutdown disconnect'));
    await publishing;
    expect(warning).not.toHaveBeenCalled();
  });

  it('closes both connections on a cache failure instead of losing their references', async () => {
    await layer.read('profile', 1000, jest.fn());
    command.get.mockRejectedValue(new Error('test cache failure'));
    expect(await layer.read('profile', 1000, jest.fn())).toBeNull();
    expect(command.destroy).toHaveBeenCalledTimes(1);
    expect(subscriber.destroy).toHaveBeenCalledTimes(1);
    expect(await layer.read('profile', 1000, jest.fn())).toBeNull();
    expect(createRedisClient).toHaveBeenCalledTimes(1);
  });

  it('does not open a new subscriber without subscribe support', async () => {
    delete (subscriber as RedisClientLike).subscribe;
    await layer.read('profile', 1000, jest.fn());
    expect(subscriber.connect).not.toHaveBeenCalled();
    expect(command.isOpen).toBe(true);
  });
});
