import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const [operation, directory, snapshot] = process.argv.slice(2);
const root = fs.realpathSync(directory);
const names = ['AgentifUI-Prod', 'AgentifUI-API-Prod'];
const digest = value => createHash('sha256').update(value).digest('hex');
const inside = directory =>
  directory === root || directory.startsWith(`${root}/`);
const fail = message => {
  throw new Error(message);
};

function processes() {
  return JSON.parse(fs.readFileSync(snapshot, 'utf8'));
}

function assertInactive() {
  for (const process of processes()) {
    const config = process.pm2_env;
    const watching = Array.isArray(config?.watch)
      ? config.watch.length > 0
      : Boolean(config?.watch);
    if (
      !config?.pm_cwd ||
      (['stopped', 'errored'].includes(config.status) && !watching)
    )
      continue;
    if (!fs.existsSync(config.pm_cwd)) continue;
    if (inside(fs.realpathSync(config.pm_cwd))) {
      fail(`Active PM2 process ${process.name} uses the target directory`);
    }
  }
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let cwd, command;
    try {
      cwd = fs.realpathSync(`/proc/${entry}/cwd`);
      command = fs
        .readFileSync(`/proc/${entry}/cmdline`, 'utf8')
        .replaceAll('\0', ' ');
    } catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM', 'ESRCH'].includes(error.code)) continue;
      throw error;
    }
    if (
      inside(cwd) &&
      /(?:next(?:-server)?(?:\s|\/)|ts-node|nodemon|(?:^|\s)tsx(?:\s|\/)|\bdist\/server\.js|\btsc(?:\s|$))/.test(
        command
      )
    )
      fail(`Application or watcher process ${entry} uses the target directory`);
  }
}

function assertRunning() {
  for (const name of names) {
    const instances = processes().filter(process => process.name === name);
    if (!instances.length) fail(`Missing PM2 application ${name}`);
    for (const process of instances) {
      const config = process.pm2_env;
      if (
        config.status !== 'online' ||
        !process.pid ||
        fs.realpathSync(config.pm_cwd) !== root
      ) {
        fail(`PM2 application ${name} is not online in the target directory`);
      }
      const actual = fs.realpathSync(`/proc/${process.pid}/cwd`);
      if (actual !== root) fail(`Process ${name} has an unexpected actual cwd`);
    }
  }
}

function archiveTree() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentifui-source-'));
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
    ),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '--git-dir',
        temporary,
        '--work-tree',
        root,
        '-c',
        'core.excludesFile=/dev/null',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.filemode=true',
        ...args,
      ],
      { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  try {
    execFileSync(
      'git',
      [
        'init',
        '--bare',
        '--quiet',
        '--template=',
        '--object-format=sha1',
        temporary,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    git('add', '--all', '--', '.');
    return git('write-tree');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function source() {
  if (fs.existsSync(path.join(root, '.git'))) {
    const git = (...args) =>
      execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    const dirty = git('status', '--porcelain').length > 0;
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(Boolean);
    return {
      commit: git('rev-parse', 'HEAD'),
      tree: git('rev-parse', 'HEAD^{tree}'),
      dirty,
      worktreeSha256: digest(
        git('diff', '--binary', 'HEAD') +
          JSON.stringify(
            untracked.map(file => [
              file,
              digest(fs.readFileSync(path.join(root, file))),
            ])
          )
      ),
    };
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'release-source.json'), 'utf8')
  );
  if (
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    !/^[a-f0-9]{40}$/.test(manifest.tree) ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256)
  ) {
    fail(
      'Invalid release-source.json; supply the verified source archive identity'
    );
  }
  if (archiveTree() !== manifest.tree)
    fail('Extracted source does not match the verified Git tree');
  return {
    commit: manifest.commit,
    tree: manifest.tree,
    archiveSha256: manifest.archiveSha256,
    dirty: manifest.dirty === true,
  };
}

function treeDigest(directory) {
  const entries = [];
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const file = path.join(relative, name);
      const stat = fs.lstatSync(path.join(directory, file));
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile())
        entries.push([
          file,
          digest(fs.readFileSync(path.join(directory, file))),
        ]);
      else fail(`Unexpected build artifact: ${file}`);
    }
  }
  visit('');
  if (!entries.length) fail(`No build artifacts in ${directory}`);
  return digest(JSON.stringify(entries));
}

if (operation === 'inactive') assertInactive();
else if (operation === 'running') assertRunning();
else if (operation === 'config') {
  const config = createRequire(import.meta.url)(fs.realpathSync(snapshot));
  for (const name of names) {
    const apps = config.apps?.filter(app => app.name === name);
    if (!apps?.length) fail(`Missing PM2 config for ${name}`);
    for (const app of apps) {
      if (fs.realpathSync(path.resolve(root, app.cwd || '.')) !== root) {
        fail(`PM2 config ${name} points outside the target directory`);
      }
    }
  }
} else if (operation === 'source')
  process.stdout.write(JSON.stringify(source()));
else if (operation === 'record') {
  const identity = source();
  const before = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
  if (JSON.stringify(identity) !== JSON.stringify(before))
    fail('Source identity changed during build');
  const record = {
    source: identity,
    builtAt: new Date().toISOString(),
    node: process.version,
    pnpm: execFileSync('pnpm', ['--version'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    lockSha256: digest(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    webBuildId: fs
      .readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8')
      .trim(),
    apiDistSha256: treeDigest(path.join(root, 'apps/api/dist')),
    sharedDistSha256: treeDigest(path.join(root, 'packages/shared/dist')),
  };
  const recordPath = path.join(root, 'pm2-logs', `build-${Date.now()}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(`Build record: ${recordPath}`);
} else fail(`Unknown operation: ${operation}`);
