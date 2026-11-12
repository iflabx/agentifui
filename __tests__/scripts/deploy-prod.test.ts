/** @jest-environment node */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = process.cwd();
let temporary: string;
let target: string;
let bin: string;
let calls: string;

function executable(name: string, content: string) {
  fs.writeFileSync(path.join(bin, name), content, { mode: 0o755 });
}

function run(environment: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(target, 'scripts/deploy-prod.sh')], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_ROOT: target,
      TEST_CALLS: calls,
      AGENTIF_SMOKE_READY_TIMEOUT: '1',
      ...environment,
    },
  });
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentifui-deploy-test-'));
  target = path.join(temporary, 'release');
  bin = path.join(temporary, 'bin');
  calls = path.join(temporary, 'calls');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(target, 'scripts/lib'), { recursive: true });
  for (const file of [
    'deploy-prod.sh',
    'smoke-prod.sh',
    'with-env-local.sh',
    'lib/deploy-state.mjs',
    'prepare-runtime-content.mjs',
    'lib/page-content-utils.mjs',
  ]) {
    fs.copyFileSync(
      path.join(repository, 'scripts', file),
      path.join(target, 'scripts', file)
    );
  }
  const runtime = path.join(temporary, 'runtime');
  fs.cpSync(path.join(repository, 'messages'), path.join(target, 'messages'), {
    recursive: true,
  });
  fs.cpSync(
    path.join(repository, 'content/pages'),
    path.join(target, 'content/pages'),
    { recursive: true }
  );
  fs.mkdirSync(path.join(target, 'lib/config'), { recursive: true });
  fs.copyFileSync(
    path.join(repository, 'lib/config/language-config.ts'),
    path.join(target, 'lib/config/language-config.ts')
  );
  fs.cpSync(path.join(target, 'messages'), path.join(runtime, 'messages'), {
    recursive: true,
  });
  fs.cpSync(
    path.join(target, 'content/pages'),
    path.join(runtime, 'content/pages'),
    { recursive: true }
  );
  fs.writeFileSync(
    path.join(target, '.env.prod'),
    `NODE_ENV=production\nAGENTIF_RUNTIME_DIR=${runtime}\n`
  );
  fs.writeFileSync(
    path.join(target, 'ecosystem.prod.config.js'),
    'module.exports = {apps: [{name: "AgentifUI-Prod", cwd: __dirname}, {name: "AgentifUI-API-Prod", cwd: __dirname}]};'
  );
  fs.writeFileSync(path.join(target, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.writeFileSync(
    path.join(target, 'release-source.json'),
    JSON.stringify({
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      archiveSha256: 'c'.repeat(64),
    })
  );
  fs.writeFileSync(calls, '');
  executable(
    'pnpm',
    `#!/usr/bin/env bash
set -eu
echo "pnpm $*" >> "$TEST_CALLS"
if [[ "$1" == --version ]]; then echo 10.14.0; exit; fi
if [[ "$1" == install && "\${TEST_INSTALL_FAIL:-0}" == 1 ]]; then exit 41; fi
if [[ "$1" == build:all ]]; then
  [[ "\${TEST_BUILD_FAIL:-0}" == 0 ]] || exit 42
  mkdir -p .next apps/api/dist packages/shared/dist
  echo test-build > .next/BUILD_ID
  echo api > apps/api/dist/server.js
  echo shared > packages/shared/dist/index.js
  case "\${TEST_MUTATE_SOURCE:-}" in
    modify) echo changed >> lib/config/language-config.ts ;;
    add) echo unexpected > lib/injected.js ;;
    delete) rm lib/config/language-config.ts ;;
  esac
fi
`
  );
  executable(
    'pm2',
    String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=process.env.TEST_ROOT, state=path.join(root,'test-state.json');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS,'pm2 '+args.join(' ')+'\n');
if(args[0]==='jlist') {
  console.log(fs.existsSync(state)?fs.readFileSync(state,'utf8'):'[]');
} else if(args[0]==='start') {
  if(process.env.TEST_START_FAIL==='1') process.exit(43);
  const cwd=path.dirname(args[1]);
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd,detached:true,stdio:'ignore'});
  child.unref();
  fs.appendFileSync(path.join(root,'test-pids'),child.pid+'\n');
  const records=['AgentifUI-Prod','AgentifUI-API-Prod'].map(name=>({name,pid:child.pid,pm2_env:{pm_cwd:cwd,status:process.env.TEST_API_FAIL==='1'&&cwd===root&&name==='AgentifUI-API-Prod'?'errored':'online'}}));
  fs.writeFileSync(state,JSON.stringify(records));
}
`
  );
  executable(
    'curl',
    String.raw`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2), output=args[args.indexOf('-o')+1];
if(process.env.TEST_REQUIRE_CURL_ENV==='1' && (process.env.CURL_CA_BUNDLE!=='/private/stage-ca.pem' || process.env.NO_PROXY!=='stage.internal,127.0.0.1')) process.exit(60);
const health=args.some(arg=>arg.endsWith('/healthz'));
const client=args.some(arg=>arg.endsWith('/client'));
if(output&&output!=='/dev/null') fs.writeFileSync(output,health?(process.env.TEST_BAD_HEALTH==='1'?'{}':'{"ok":true,"service":"agentifui-fastify-api"}'):'<script src="/_next/static/chunks/app.js"></script>');
if(args.includes('-w')) process.stdout.write(client?'400':'200');
`
  );
  fs.copyFileSync(
    path.join(repository, '.gitignore'),
    path.join(target, '.gitignore')
  );
  fs.appendFileSync(path.join(target, '.gitignore'), '\ntest-*\n');
  const identity = path.join(temporary, 'identity');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
    ),
    NODE_ENV: process.env.NODE_ENV,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['--git-dir', identity, '--work-tree', target, ...args],
      { cwd: target, env, encoding: 'utf8' }
    ).trim();
  execFileSync(
    'git',
    [
      'init',
      '--bare',
      '--quiet',
      '--template=',
      '--object-format=sha1',
      identity,
    ],
    { env }
  );
  git('add', '--all', '--', '.');
  fs.writeFileSync(
    path.join(target, 'release-source.json'),
    JSON.stringify({
      commit: 'a'.repeat(40),
      tree: git('write-tree'),
      archiveSha256: 'c'.repeat(64),
    })
  );
});

afterEach(() => {
  const pids = path.join(target, 'test-pids');
  if (fs.existsSync(pids)) {
    for (const pid of fs.readFileSync(pids, 'utf8').trim().split('\n')) {
      try {
        process.kill(Number(pid));
      } catch {
        continue;
      }
    }
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('smoke requests load TLS and proxy settings from the release env file', () => {
  fs.appendFileSync(
    path.join(target, '.env.prod'),
    'CURL_CA_BUNDLE=/private/stage-ca.pem\nNO_PROXY=stage.internal,127.0.0.1\n'
  );
  const result = run({
    TEST_REQUIRE_CURL_ENV: '1',
    CURL_CA_BUNDLE: '',
    NO_PROXY: '',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('[smoke-prod] ok');
});

test('rejects active directories even when the PM2 cwd is a symlink', () => {
  const alias = path.join(temporary, 'alias');
  fs.symlinkSync(target, alias);
  fs.writeFileSync(
    path.join(target, 'test-state.json'),
    JSON.stringify([
      {
        name: 'existing',
        pid: 1,
        pm2_env: { pm_cwd: alias, status: 'launching' },
      },
    ])
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Active PM2 process');
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pnpm');
});

test('rejects a missing migration command before install or build', () => {
  const result = run({ AGENTIF_DEPLOY_RUN_MIGRATIONS: '1' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('migration command is required');
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
});

test('rejects a stopped application whose watcher can restart it', () => {
  fs.writeFileSync(
    path.join(target, 'test-state.json'),
    JSON.stringify([
      {
        name: 'watcher',
        pm2_env: { pm_cwd: target, status: 'stopped', watch: true },
      },
    ])
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Active PM2 process');
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pnpm');
});

test('rejects an API process outside PM2 before replacing its build', async () => {
  const directory = path.join(target, 'apps/api/dist');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'server.js'),
    'setInterval(() => {}, 1000);'
  );
  const child = spawn(process.execPath, [path.join(directory, 'server.js')], {
    cwd: target,
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  fs.writeFileSync(path.join(target, 'test-pids'), String(child.pid));
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Application or watcher process');
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pnpm');
});

test('rejects different build and startup env files', () => {
  const other = path.join(temporary, 'other.env');
  fs.writeFileSync(other, 'NODE_ENV=production\n');
  const result = run({ AGENTIF_PROD_ENV_FILE: other });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('same .env.prod');
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
});

test('build failure leaves existing PM2 applications untouched', () => {
  const result = run({ TEST_BUILD_FAIL: '1' });
  expect(result.status).toBe(42);
  expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/pm2 (delete|start|save)/);
});

test('rejects PM2 configuration pointing at another version before building', () => {
  fs.writeFileSync(
    path.join(target, 'ecosystem.prod.config.js'),
    'module.exports = {apps: [{name: "AgentifUI-Prod", cwd: "/tmp"}, {name: "AgentifUI-API-Prod", cwd: "/tmp"}]};'
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('outside the target directory');
  expect(fs.readFileSync(calls, 'utf8')).toBe('');
});

test('ignores an unrelated PM2 application whose old directory no longer exists', () => {
  fs.writeFileSync(
    path.join(target, 'test-state.json'),
    JSON.stringify([
      {
        name: 'another-project',
        pm2_env: { pm_cwd: path.join(temporary, 'removed'), status: 'online' },
      },
    ])
  );
  expect(run().status).toBe(0);
});

test('install failure leaves existing PM2 applications untouched', () => {
  const result = run({ TEST_INSTALL_FAIL: '1' });
  expect(result.status).toBe(41);
  expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/pm2 (delete|start|save)/);
});

test('rejects an archive changed before deployment without touching applications', () => {
  fs.appendFileSync(path.join(target, 'lib/config/language-config.ts'), '\n');
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('does not match the verified Git tree');
  const log = fs.readFileSync(calls, 'utf8');
  expect(log).not.toContain('pnpm install');
  expect(log).not.toMatch(/pm2 (delete|start|save)/);
});

test('archive verification preserves the caller Git index', () => {
  const identity = path.join(temporary, 'identity');
  const index = path.join(identity, 'index');
  const before = fs.readFileSync(index);
  const result = run({
    GIT_DIR: identity,
    GIT_COMMON_DIR: identity,
    GIT_WORK_TREE: target,
    GIT_INDEX_FILE: index,
  });
  expect(result.status).toBe(0);
  expect(fs.readFileSync(index)).toEqual(before);
  expect(fs.existsSync(path.join(target, '.git'))).toBe(false);
});

test('archive verification detects changed executable permissions', () => {
  fs.chmodSync(path.join(target, 'lib/config/language-config.ts'), 0o755);
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('does not match the verified Git tree');
  expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/pm2 (delete|start|save)/);
});

test.each(['modify', 'add', 'delete'])(
  'rejects archive source %s during build before switching applications',
  mutation => {
    const result = run({ TEST_MUTATE_SOURCE: mutation });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the verified Git tree');
    expect(fs.readFileSync(calls, 'utf8')).not.toMatch(
      /pm2 (delete|start|save)/
    );
  }
);

test('migration failure leaves existing PM2 applications untouched', () => {
  const result = run({
    AGENTIF_DEPLOY_RUN_MIGRATIONS: '1',
    AGENTIF_DEPLOY_MIGRATION_COMMAND: 'exit 44',
  });
  expect(result.status).toBe(44);
  expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/pm2 (delete|start|save)/);
});

test('a failed switch restores the prepared previous directory without rebuilding it', () => {
  const previous = path.join(temporary, 'previous');
  fs.cpSync(target, previous, { recursive: true });
  const result = run({
    TEST_API_FAIL: '1',
    AGENTIF_DEPLOY_ROLLBACK: '1',
    AGENTIF_DEPLOY_PREVIOUS_DIR: previous,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('previous application restored');
  const log = fs.readFileSync(calls, 'utf8');
  expect(log.match(/pnpm build:all/g)).toHaveLength(1);
  expect(log).toContain('pm2 save');
});

test('failed recovery never saves a failed process list', () => {
  const previous = path.join(temporary, 'previous');
  fs.cpSync(target, previous, { recursive: true });
  const result = run({
    TEST_START_FAIL: '1',
    AGENTIF_DEPLOY_ROLLBACK: '1',
    AGENTIF_DEPLOY_PREVIOUS_DIR: previous,
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('recovery failed');
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pm2 save');
});

test('successful switch records artifacts and waits for manual business acceptance', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('[smoke-prod] ok');
  const record = fs
    .readdirSync(path.join(target, 'pm2-logs'))
    .find(file => file.startsWith('build-'))!;
  const data = JSON.parse(
    fs.readFileSync(path.join(target, 'pm2-logs', record), 'utf8')
  );
  expect(data.source.commit).toBe('a'.repeat(40));
  expect(data.apiDistSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pm2 save');
});

test('one failed application cannot report deployment success', () => {
  const result = run({ TEST_API_FAIL: '1' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('deployment is not successful');
  expect(fs.readFileSync(calls, 'utf8')).not.toContain('pm2 save');
});

test('HTTP 200 with invalid health JSON fails within the readiness deadline', () => {
  const result = run({ TEST_BAD_HEALTH: '1' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('readiness timed out');
});

test('refuses another deployment holding the stable lock', () => {
  const result = spawnSync(
    'flock',
    [
      path.join(temporary, '.agentifui-deploy.lock'),
      'bash',
      '-c',
      'bash "$1"',
      'test',
      path.join(target, 'scripts/deploy-prod.sh'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TEST_ROOT: target,
        TEST_CALLS: calls,
      },
    }
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('another deployment');
});

test('CI aggregation rejects failed detection/checks, cancellation and missing required jobs', () => {
  const workflow = fs.readFileSync(
    path.join(repository, '.github/workflows/ci.yml'),
    'utf8'
  );
  const body = workflow
    .split("node <<'NODE'\n")[1]
    .split('\n          NODE')[0]
    .replace(/^          /gm, '');
  const jobs = ['quality', 'verify', 'docker'];
  function check(
    required: string,
    changedJob?: string,
    result?: string,
    dockerRequired = required
  ) {
    const needs: Record<
      string,
      {
        result: string;
        outputs?: { required: string; docker_required: string };
      }
    > = {
      changes: {
        result: 'success',
        outputs: { required, docker_required: dockerRequired },
      },
      'publication-check': { result: 'success' },
    };
    for (const job of jobs) {
      const flag = job === 'docker' ? dockerRequired : required;
      needs[job] = { result: flag === 'true' ? 'success' : 'skipped' };
    }
    if (changedJob) {
      if (result === undefined) delete needs[changedJob];
      else needs[changedJob].result = result;
    }
    return spawnSync(process.execPath, ['-e', body], {
      env: { ...process.env, CI_NEEDS: JSON.stringify(needs) },
    }).status;
  }
  expect(check('true')).toBe(0);
  expect(check('false')).toBe(0);
  expect(check('true', undefined, undefined, 'false')).toBe(0);
  expect(check('false', undefined, undefined, 'true')).toBe(0);
  expect(check('false', 'publication-check', 'skipped')).not.toBe(0);
  expect(check('true', 'publication-check', 'failure')).not.toBe(0);
  expect(check('true', 'changes', 'failure')).not.toBe(0);
  for (const job of jobs) {
    expect(check('true', job, 'failure')).not.toBe(0);
    expect(check('true', job, 'cancelled')).not.toBe(0);
    expect(check('true', job, 'skipped')).not.toBe(0);
    expect(check('true', job)).not.toBe(0);
    expect(check('false', job, 'cancelled')).not.toBe(0);
    expect(check('false', job, 'success')).not.toBe(0);
    expect(check('false', job)).not.toBe(0);
  }
  expect(check('')).not.toBe(0);
  expect(check('true', undefined, undefined, '')).not.toBe(0);
});
