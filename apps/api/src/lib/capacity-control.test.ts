/** @jest-environment node */
import Fastify from 'fastify';
import { get } from 'node:http';

import {
  installCapacityControl,
  trackApiBackgroundTask,
} from './capacity-control';
import {
  isRealtimeOutboxBusy,
  setRealtimeOutboxPaused,
} from './realtime/outbox-dispatcher';

jest.mock('./realtime/outbox-dispatcher', () => ({
  isRealtimeOutboxBusy: jest.fn(() => false),
  setRealtimeOutboxPaused: jest.fn(),
}));

const token = 'capacity-control-fixture-'.repeat(3);
const headers = { authorization: `Bearer ${token}`, Connection: 'close' };

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { Connection: 'close' } }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => resolve(JSON.parse(body)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

test('capacity control is absent unless explicitly enabled', async () => {
  const app = Fastify();
  installCapacityControl(app, '');
  expect((await app.inject('/__agentifui/capacity')).statusCode).toBe(404);
  await app.close();
});

test('tracks detached generation work for draining after the HTTP client has gone', async () => {
  const app = Fastify();
  installCapacityControl(app, token);
  let finish!: () => void;
  const task = new Promise<void>(resolve => {
    finish = resolve;
  });
  trackApiBackgroundTask(task);
  try {
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
        .backgroundTasks
    ).toBe(1);
    finish();
    await task;
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
        .backgroundTasks
    ).toBe(0);
  } finally {
    finish();
    await task;
    await app.close();
  }
});

test('requires a private token and a loopback transport, not forwarded headers', async () => {
  const app = Fastify();
  installCapacityControl(app, token);
  for (const options of [
    { headers: {} },
    { headers: { authorization: 'Bearer incorrect' } },
    {
      headers: { ...headers, 'x-forwarded-for': '127.0.0.1' },
      remoteAddress: '203.0.113.9',
    },
  ]) {
    expect(
      (await app.inject({ url: '/__agentifui/capacity', ...options }))
        .statusCode
    ).toBe(404);
  }
  expect(
    (await app.inject({ url: '/__agentifui/capacity', headers })).json()
  ).toEqual({
    draining: false,
    activeRequests: 0,
    subscriptions: 0,
    backgroundTasks: 0,
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/__agentifui/capacity',
        headers,
        payload: {},
      })
    ).statusCode
  ).toBe(400);
  await app.close();
});

test('drain reports background outbox work until its claimed batch settles', async () => {
  const app = Fastify();
  installCapacityControl(app, token);
  try {
    jest.mocked(isRealtimeOutboxBusy).mockReturnValue(true);
    const response = await app.inject({
      method: 'POST',
      url: '/__agentifui/capacity',
      headers,
      payload: { draining: true },
    });
    expect(setRealtimeOutboxPaused).toHaveBeenCalledWith(true);
    expect(response.json()).toMatchObject({
      draining: true,
      activeRequests: 0,
      backgroundTasks: 1,
    });
    jest.mocked(isRealtimeOutboxBusy).mockReturnValue(false);
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
    ).toMatchObject({ backgroundTasks: 0 });
    await app.inject({
      method: 'POST',
      url: '/__agentifui/capacity',
      headers,
      payload: { draining: false },
    });
    expect(setRealtimeOutboxPaused).toHaveBeenLastCalledWith(false);
  } finally {
    jest.mocked(isRealtimeOutboxBusy).mockReturnValue(false);
    await app.close();
  }
});

test('draining preserves in-flight work and rejects new requests until resumed', async () => {
  const app = Fastify();
  installCapacityControl(app, token);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  app.get('/work', async () => {
    entered();
    await pending;
    return { saved: true };
  });
  app.get('/healthz', async () => ({ ok: true }));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const work = getJson(`${origin}/work`);
    await started;
    const drain = await app.inject({
      method: 'POST',
      url: '/__agentifui/capacity',
      headers,
      payload: { draining: true },
    });
    expect(drain.json()).toMatchObject({ draining: true, activeRequests: 1 });
    expect((await app.inject('/work')).statusCode).toBe(503);
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    release();
    expect(await work).toEqual({ saved: true });
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
        .activeRequests
    ).toBe(0);
    await app.inject({
      method: 'POST',
      url: '/__agentifui/capacity',
      headers,
      payload: { draining: false },
    });
    expect((await app.inject('/work')).statusCode).toBe(200);
  } finally {
    release();
    await app.close();
  }
});

test('drain closes realtime subscriptions without counting them as model work', async () => {
  const app = Fastify();
  installCapacityControl(app, token);
  app.get('/api/internal/realtime/stream', async (_request, reply) => {
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.write('event: ready\ndata: {}\n\n');
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    let ended!: Promise<void>;
    await new Promise<void>((resolve, reject) => {
      get(
        `${origin}/api/internal/realtime/stream`,
        { headers: { Connection: 'close' } },
        response => {
          ended = new Promise<void>(end => {
            response.once('end', end);
          });
          response.once('data', () => resolve());
          response.on('error', reject);
          response.resume();
        }
      ).on('error', reject);
    });
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
    ).toMatchObject({ activeRequests: 0, subscriptions: 1 });
    await app.inject({
      method: 'POST',
      url: '/__agentifui/capacity',
      headers,
      payload: { draining: true },
    });
    await ended;
    expect(
      (await app.inject({ url: '/__agentifui/capacity', headers })).json()
        .subscriptions
    ).toBe(0);
  } finally {
    await app.close();
  }
});
