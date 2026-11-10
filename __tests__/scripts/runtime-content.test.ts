/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = process.cwd();
let directory: string;
let release: string;
let runtime: string;

function prepare(mode = '--build', environment: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [path.join(release, 'scripts/prepare-runtime-content.mjs'), mode],
    {
      encoding: 'utf8',
      env: { ...process.env, AGENTIF_RUNTIME_DIR: runtime, ...environment },
      timeout: 15000,
    }
  );
}

function read(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentifui-runtime-test-'));
  release = path.join(directory, 'release');
  runtime = path.join(directory, 'runtime');
  fs.mkdirSync(path.join(release, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(release, 'lib/config'), { recursive: true });
  for (const file of [
    'scripts/prepare-runtime-content.mjs',
    'scripts/lib/page-content-utils.mjs',
    'lib/config/language-config.ts',
  ])
    fs.copyFileSync(path.join(source, file), path.join(release, file));
  for (const folder of ['messages', 'content/pages'])
    fs.cpSync(path.join(source, folder), path.join(release, folder), {
      recursive: true,
    });
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('initializes defaults only when explicitly requested and refuses reinitialization', () => {
  expect(prepare('--deploy').status).toBe(1);
  expect(prepare('--deploy', { AGENTIF_RUNTIME_INIT: '1' }).status).toBe(0);
  const original = fs.readFileSync(
    path.join(runtime, 'messages/en-US.json'),
    'utf8'
  );
  expect(prepare('--init').status).toBe(1);
  expect(
    fs.readFileSync(path.join(runtime, 'messages/en-US.json'), 'utf8')
  ).toBe(original);
});

test('upgrade preserves edits, adds new default keys and snapshots old runtime', () => {
  expect(prepare('--init').status).toBe(0);
  const operational = path.join(runtime, 'messages/en-US.json');
  const defaults = path.join(release, 'messages/en-US.json');
  const originalDefaults = fs.readFileSync(defaults, 'utf8');
  const existing = read(operational);
  existing.privateFixture = 'operator value';
  fs.writeFileSync(operational, JSON.stringify(existing));
  const next = read(defaults);
  next.newFixture = 'new default';
  fs.writeFileSync(defaults, JSON.stringify(next));
  const editedDefaults = fs.readFileSync(defaults, 'utf8');
  expect(prepare('--deploy').status).toBe(0);
  expect(read(operational)).toMatchObject({
    privateFixture: 'operator value',
    newFixture: 'new default',
  });
  expect(
    read(path.join(release, 'output/build-messages/en-US.json'))
  ).toMatchObject({
    privateFixture: 'operator value',
    newFixture: 'new default',
  });
  expect(fs.readFileSync(defaults, 'utf8')).toBe(editedDefaults);
  const snapshots = path.join(directory, 'runtime-snapshots');
  const snapshot = fs.readdirSync(snapshots)[0];
  expect(
    read(path.join(snapshots, snapshot, 'messages/en-US.json'))
  ).not.toHaveProperty('newFixture');
  expect(originalDefaults).not.toBe(editedDefaults);
});

test('translation edits do not change preserved build inputs until prepared again', () => {
  expect(prepare('--init').status).toBe(0);
  const built = path.join(release, 'output/build-messages/en-US.json');
  const before = fs.readFileSync(built, 'utf8');
  const file = path.join(runtime, 'messages/en-US.json');
  const edited = read(file);
  edited.fixture = 'latest edit';
  fs.writeFileSync(file, JSON.stringify(edited));
  expect(fs.readFileSync(built, 'utf8')).toBe(before);
  expect(prepare().status).toBe(0);
  expect(read(built).fixture).toBe('latest edit');
});

test('invalid types fail before snapshot or runtime write', () => {
  expect(prepare('--init').status).toBe(0);
  const file = path.join(runtime, 'messages/en-US.json');
  fs.writeFileSync(file, '[]');
  expect(prepare('--deploy').status).toBe(1);
  expect(fs.readFileSync(file, 'utf8')).toBe('[]');
  expect(fs.existsSync(path.join(directory, 'runtime-snapshots'))).toBe(false);
});

test('compatible locale layers do not require every translation revision to advance before deployment', () => {
  expect(prepare('--init').status).toBe(0);
  const file = path.join(runtime, 'content/pages/about/structure.json');
  const structure = read(file);
  structure.metadata.structureVersion += 1;
  fs.writeFileSync(file, JSON.stringify(structure));
  expect(prepare('--deploy').status).toBe(0);
});

test.each([
  'relative/path',
  '',
  '/',
  path.dirname(source),
  path.join(source, 'messages'),
])('rejects invalid configured path %s', configured => {
  expect(prepare('--deploy', { AGENTIF_RUNTIME_DIR: configured }).status).toBe(
    1
  );
});

test('refuses symlinks back into source and does not modify defaults', () => {
  expect(prepare('--init').status).toBe(0);
  const file = path.join(runtime, 'messages/en-US.json');
  fs.rmSync(file);
  fs.symlinkSync(path.join(release, 'messages/en-US.json'), file);
  expect(prepare('--deploy').status).toBe(1);
});

test('compatible rollback uses latest stable runtime without rebuilding old translations', () => {
  expect(prepare('--init').status).toBe(0);
  const oldBuild = fs.readFileSync(
    path.join(release, 'output/build-messages/en-US.json'),
    'utf8'
  );
  const file = path.join(runtime, 'messages/en-US.json');
  const edited = read(file);
  edited.fixture = 'edit after release';
  fs.writeFileSync(file, JSON.stringify(edited));
  expect(prepare('--check').status).toBe(0);
  expect(read(file).fixture).toBe('edit after release');
  expect(
    fs.readFileSync(
      path.join(release, 'output/build-messages/en-US.json'),
      'utf8'
    )
  ).toBe(oldBuild);
});
