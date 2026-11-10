/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRuntimeContentDir } from './runtime-content';

const original = process.env.AGENTIF_RUNTIME_DIR;
let runtime: string;

beforeEach(() => {
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'agentifui-runtime-path-'));
  fs.mkdirSync(path.join(runtime, 'messages'));
  fs.mkdirSync(path.join(runtime, 'content/pages'), { recursive: true });
  process.env.AGENTIF_RUNTIME_DIR = runtime;
});

afterEach(() => {
  if (original === undefined) delete process.env.AGENTIF_RUNTIME_DIR;
  else process.env.AGENTIF_RUNTIME_DIR = original;
  fs.rmSync(runtime, { recursive: true, force: true });
});

test('both content kinds use the same external runtime directory', () => {
  expect(resolveRuntimeContentDir('messages')).toBe(
    path.join(runtime, 'messages')
  );
  expect(resolveRuntimeContentDir('content/pages')).toBe(
    path.join(runtime, 'content/pages')
  );
});

test.each(['relative', '', '/does-not-exist-agentifui', process.cwd()])(
  'invalid configuration never falls back to source: %s',
  configured => {
    process.env.AGENTIF_RUNTIME_DIR = configured;
    expect(() => resolveRuntimeContentDir('messages')).toThrow();
  }
);
