#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '8.24.3';
const config = fileURLToPath(new URL('../.gitleaks.toml', import.meta.url));
const ignore = fileURLToPath(new URL('../.gitleaksignore', import.meta.url));
const zero = /^0+$/;

function git(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error('Git range or tree lookup failed');
  return result.stdout.trimEnd();
}

function commit(ref) {
  if (!/^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(ref))
    throw new Error('Expected a full Git object ID');
  return git(['rev-parse', '--verify', `${ref}^{commit}`]);
}

function forbidden(file) {
  const segments = file.split('/');
  const name = segments.at(-1);
  return (
    segments.some(segment =>
      /^(?:local[_-](?:docs|scripts)|private|private-baselines|backups|exports|uploads|runtime|output|node_modules|pm2-logs|\.next(?:-dev|-build)?|\.ssh|\.aws|\.gnupg)$/.test(
        segment
      )
    ) ||
    (/^\.env(?:\.|$)/.test(name) &&
      !['.env.example', '.env.prod.example', '.env.test.example'].includes(
        name
      )) ||
    /^(?:\.dev-env\.local|\.envrc|\.npmrc\.local|\.mcp\.local\.json|id_rsa|id_ed25519|release-source\.json)$/.test(
      name
    ) ||
    /\.(?:pem|key|p12|pfx|dump|sql\.gz|log|bak|local\.(?:json|yaml|yml|toml))$/.test(
      name
    )
  );
}

function ranges(args) {
  if (args[0] === '--pre-push') {
    const remote = args[1];
    if (!remote || remote.startsWith('-'))
      throw new Error('Missing remote name');
    return fs
      .readFileSync(0, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        const fields = line.trim().split(/\s+/);
        if (fields.length !== 4) throw new Error('Invalid pre-push input');
        const [, next, , previous] = fields;
        if (zero.test(next)) return [];
        const head = commit(next);
        const base = zero.test(previous) ? null : previous;
        return [{ head, base, remote }];
      });
  }
  if (args[0] === '--ci') {
    const event = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
    );
    const head = commit(event.pull_request?.head.sha || process.env.GITHUB_SHA);
    const before = event.pull_request?.base.sha || event.before;
    return [
      {
        head,
        base: before && !zero.test(before) ? before : null,
        all: !before,
      },
    ];
  }
  if (args[0] === '--all' && args.length === 1)
    return [{ head: git(['rev-parse', 'HEAD']), all: true }];
  if (args[0] === '--base' && args[2] === '--head' && args.length === 4) {
    return [{ base: commit(args[1]), head: commit(args[3]) }];
  }
  throw new Error('Use --pre-push, --ci, --all, or --base SHA --head SHA');
}

function checkPaths(range) {
  const files = git(['ls-tree', '-r', '--name-only', '-z', range.head])
    .split('\0')
    .filter(Boolean);
  if (!range.all) {
    let revisions;
    if (range.base) {
      try {
        revisions = [`${commit(range.base)}..${range.head}`];
      } catch {
        revisions = [range.head];
      }
    } else {
      revisions = range.remote
        ? [range.head, '--not', `--remotes=${range.remote}`]
        : [range.head];
    }
    const commits = git(['rev-list', ...revisions])
      .split('\n')
      .filter(Boolean);
    for (const revision of commits) {
      files.push(
        ...git([
          'diff-tree',
          '--root',
          '-m',
          '-r',
          '--no-commit-id',
          '--diff-filter=ACMRT',
          '--name-only',
          '-z',
          revision,
        ])
          .split('\0')
          .filter(Boolean)
      );
    }
  }
  const blocked = [...new Set(files.filter(forbidden))];
  for (const file of blocked)
    console.error(`[publication] forbidden path: ${JSON.stringify(file)}`);
  if (blocked.length) throw new Error('Private paths must not be published');
}

function scan(range) {
  let revision = range.all ? '--all' : range.head;
  if (range.base) {
    try {
      revision = `${commit(range.base)}..${range.head}`;
    } catch {
      revision = range.head;
    }
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agentifui-publication-')
  );
  const report = path.join(directory, 'report.json');
  try {
    const result = spawnSync(
      'gitleaks',
      [
        'git',
        '.',
        '--config',
        config,
        '--gitleaks-ignore-path',
        ignore,
        '--redact=100',
        '--no-banner',
        '--log-level',
        'error',
        '--report-format',
        'json',
        '--report-path',
        report,
        '--log-opts',
        `--full-history -m ${revision}`,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      }
    );
    if (fs.existsSync(report)) {
      for (const finding of JSON.parse(fs.readFileSync(report, 'utf8')) || []) {
        console.error(
          `[publication] ${JSON.stringify({ rule: finding.RuleID, file: finding.File, line: finding.StartLine, commit: finding.Commit })}`
        );
      }
    }
    if (result.error || result.status !== 0)
      throw new Error(
        'Secret scan failed; resolve findings or scanner errors before publishing'
      );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

try {
  const selected = ranges(process.argv.slice(2));
  if (selected.length) {
    const installed = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
    if (
      installed.error ||
      installed.status !== 0 ||
      installed.stdout.trim().replace(/^v/, '') !== version
    ) {
      throw new Error(
        `Install Gitleaks ${version} on PATH; publication checks never download tools during push`
      );
    }
  }
  for (const range of selected) {
    checkPaths(range);
    scan(range);
  }
  console.log('[publication] checks passed');
} catch (error) {
  console.error(`[publication] ${error.message}`);
  process.exitCode = 1;
}
