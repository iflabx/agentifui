/** @jest-environment node */
import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadApiRuntimeConfig } from '../config';
import { adminTranslationsRoutes } from './admin-translations';

jest.mock('../lib/session-identity', () => ({
  resolveIdentityFromSession: jest.fn(async () => ({
    kind: 'ok',
    identity: { role: 'admin' },
  })),
}));

const original = process.env.AGENTIF_RUNTIME_DIR;
let runtime: string;

beforeEach(() => {
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'agentifui-admin-content-'));
  fs.mkdirSync(path.join(runtime, 'messages'));
  fs.writeFileSync(
    path.join(runtime, 'messages/en-US.json'),
    '{"fixture":"original"}'
  );
  process.env.AGENTIF_RUNTIME_DIR = runtime;
});

afterEach(() => {
  if (original === undefined) delete process.env.AGENTIF_RUNTIME_DIR;
  else process.env.AGENTIF_RUNTIME_DIR = original;
  fs.rmSync(runtime, { recursive: true, force: true });
});

test('admin edits update external translations without modifying public defaults', async () => {
  const defaults = path.join(process.cwd(), 'messages/en-US.json');
  const before = fs.readFileSync(defaults, 'utf8');
  const app = Fastify();
  await app.register(adminTranslationsRoutes, {
    config: loadApiRuntimeConfig(),
  });
  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/translations',
      payload: { locale: 'en-US', updates: { fixture: 'operator edit' } },
    });
    expect(response.statusCode).toBe(200);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(runtime, 'messages/en-US.json'), 'utf8')
      ).fixture
    ).toBe('operator edit');
    expect(fs.readFileSync(defaults, 'utf8')).toBe(before);
  } finally {
    await app.close();
  }
});

test('invalid configured content does not fall back to default translations', async () => {
  process.env.AGENTIF_RUNTIME_DIR = path.join(runtime, 'missing');
  const app = Fastify();
  await app.register(adminTranslationsRoutes, {
    config: loadApiRuntimeConfig(),
  });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/translations?locale=en-US',
    });
    expect(response.statusCode).toBe(500);
  } finally {
    await app.close();
  }
});
