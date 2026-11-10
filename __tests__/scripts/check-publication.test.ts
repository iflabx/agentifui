/** @jest-environment node */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const checker = path.join(process.cwd(), 'scripts/check-publication.mjs');
let directory: string;
let repository: string;
let initial: string;

function git(...args: string[]) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(name: string, value: string) {
  fs.mkdirSync(path.dirname(path.join(repository, name)), { recursive: true });
  fs.writeFileSync(path.join(repository, name), value);
  git('add', name);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'test fixture');
  return git('rev-parse', 'HEAD');
}

function check(
  args: string[],
  input?: string,
  environment: Record<string, string> = {}
) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repository,
    encoding: 'utf8',
    input,
    env: { ...process.env, ...environment },
    timeout: 20000,
  });
}

beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agentifui-publication-test-')
  );
  repository = path.join(directory, 'source');
  fs.mkdirSync(repository);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Publication Test');
  git('config', 'user.email', 'publication@example.invalid');
  initial = commitFile('README.md', 'Public fixture\n');
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('allows normal templates and documentation', () => {
  const head = commitFile('.env.prod.example', 'API_KEY=your-api-key\n');
  const result = check(['--base', initial, '--head', head]);
  expect(result.status).toBe(0);
});

test.each([
  'local_docs/notes.md',
  'local_scripts/helper.mjs',
  '.env.prod',
  '.dev-env.local',
  'exports/models.json',
  'private/key.json',
  'uploads/avatar.png',
  'id_ed25519',
  'tls.key',
])('rejects private path %s', name => {
  const head = commitFile(name, 'private fixture');
  expect(check(['--base', initial, '--head', head]).status).toBe(1);
});

test('rejects a force-added ignored local environment file', () => {
  commitFile('.gitignore', '.dev-env.local\n');
  fs.writeFileSync(
    path.join(repository, '.dev-env.local'),
    'LOCAL_APP_URL=https://private-installation.invalid\n'
  );
  git('add', '-f', '.dev-env.local');
  git('commit', '-m', 'local environment fixture');
  const result = check(['--base', initial, '--head', git('rev-parse', 'HEAD')]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('forbidden path: ".dev-env.local"');
});

test('rejects private paths introduced then deleted in outgoing commits', () => {
  commitFile('local_docs/notes.md', 'private fixture');
  git('rm', 'local_docs/notes.md');
  git('commit', '-m', 'remove fixture');
  expect(
    check(['--base', initial, '--head', git('rev-parse', 'HEAD')]).status
  ).toBe(1);
});

test('rejects an intermediate fake secret without printing its value', () => {
  const token = 'ghp_' + 'AbCdEf0123456789AbCdEf0123456789AbCdEf';
  commitFile('config.txt', `token=${token}\n`);
  const head = commitFile('config.txt', 'token=removed\n');
  const result = check(['--base', initial, '--head', head]);
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  expect(result.stderr).toContain('github-pat');
});

test('historical false-positive exceptions do not allow new occurrences', () => {
  const token = 'sk-' + '1234567890abcdef';
  const head = commitFile('docs/security.md', `const API_KEY = '${token}';\n`);
  const result = check(['--base', initial, '--head', head]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('generic-api-key');
});

test('owner-approved historical JWT exceptions do not exempt new JWTs', () => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'supabase',
      role: 'service_role',
      ref: 'publication-test-invalid',
    })
  ).toString('base64url');
  const signature = Buffer.from(
    'fixture-only-signature-not-a-real-credential'
  ).toString('base64url');
  const token = `${header}.${payload}.${signature}`;
  const head = commitFile('config.txt', `token=${token}\n`);
  const result = check(['--base', initial, '--head', head]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"rule":"jwt"');
  expect(`${result.stdout}${result.stderr}`).not.toContain(token);
});

test('checks new branches, annotated tags, multiple refs and deletions', () => {
  const head = commitFile('public.txt', 'normal\n');
  git('tag', '-a', 'v1', '-m', 'fixture release');
  const tag = git('rev-parse', 'v1');
  const zero = '0'.repeat(40);
  const input = `refs/heads/main ${head} refs/heads/main ${zero}\nrefs/tags/v1 ${tag} refs/tags/v1 ${zero}\n(delete) ${zero} refs/heads/old ${initial}\n`;
  expect(check(['--pre-push', 'origin'], input).status).toBe(0);
});

test('deleting a previously published internal file is allowed', () => {
  const previous = commitFile('local_scripts/old.mjs', 'historical fixture');
  git('rm', 'local_scripts/old.mjs');
  git('commit', '-m', 'stop publishing internal tool');
  expect(
    check(['--base', previous, '--head', git('rev-parse', 'HEAD')]).status
  ).toBe(0);
});

test('missing scanner fails closed', () => {
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(
    execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
    path.join(bin, 'git')
  );
  const result = check(['--base', initial, '--head', initial], undefined, {
    PATH: bin,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Install Gitleaks');
});

test('scans secrets introduced by merge resolution even when later deleted', () => {
  git('switch', '-c', 'feature');
  commitFile('feature.txt', 'public feature');
  git('switch', 'main');
  commitFile('main.txt', 'public main');
  git('merge', '--no-commit', '--no-ff', 'feature');
  const token = 'ghp_' + 'AbCdEf0123456789AbCdEf0123456789AbCdEf';
  commitFile('config.txt', `token=${token}\n`);
  const head = commitFile('config.txt', 'token=removed\n');
  const result = check(['--base', initial, '--head', head]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('github-pat');
});

test('document-only CI runs the same check', () => {
  const head = commitFile('docs/guide.md', 'Public guide\n');
  const event = path.join(directory, 'event.json');
  fs.writeFileSync(
    event,
    JSON.stringify({
      pull_request: { base: { sha: initial }, head: { sha: head } },
    })
  );
  expect(check(['--ci'], undefined, { GITHUB_EVENT_PATH: event }).status).toBe(
    0
  );
});

test('a real local push hook rejects a fake secret before remote transfer', () => {
  const remote = path.join(directory, 'remote.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const hook = path.join(repository, '.git/hooks/pre-push');
  fs.writeFileSync(
    hook,
    `#!/bin/sh\nexec '${process.execPath}' '${checker}' --pre-push "$@"\n`,
    { mode: 0o755 }
  );
  const token = 'ghp_' + 'AbCdEf0123456789AbCdEf0123456789AbCdEf';
  commitFile('config.txt', `token=${token}\n`);
  const result = spawnSync('git', ['push', 'origin', 'main'], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 20000,
  });
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  expect(git('--git-dir', remote, 'rev-parse', 'main')).toBe(initial);
});

test('CI installs the shared scanner in the test runner before running tests', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github/workflows/ci.yml'),
    'utf8'
  );
  const testJob = workflow.match(/^  verify:\n[\s\S]*?(?=^  [\w-]+:)/m)?.[0];
  expect(testJob).toBeDefined();
  expect(testJob).toMatch(
    /uses: \.\/\.github\/actions\/publication-check\n\s+with:\n\s+install-only: 'true'[\s\S]*?run: pnpm test/
  );
});

test('the shared action checks publication by default, including document-only CI', () => {
  const action = fs.readFileSync(
    path.join(process.cwd(), '.github/actions/publication-check/action.yml'),
    'utf8'
  );
  expect(action).toMatch(/install-only:\n[\s\S]*?default: 'false'/);
  expect(action).toMatch(
    /name: Check outgoing publication\n\s+if: inputs.install-only != 'true'\n\s+shell: bash\n\s+run: node scripts\/check-publication.mjs --ci/
  );
});
