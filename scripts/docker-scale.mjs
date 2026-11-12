import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  capacityCounts,
  countEstablishedConnections,
  digest,
  normalizeCapacityConfig,
  renderCapacityCompose,
  renderCapacityNginx,
  selectedServices,
  serviceName,
} from './lib/docker-capacity.mjs';

const pause = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

function command(arguments_, label) {
  try {
    return execFileSync(arguments_[0], arguments_.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(`${label} failed; private command output is not printed`);
  }
}

function atomicWrite(filename, text) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, filename);
}

async function request(port, pathname, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Connection: 'close',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Instance check failed');
  }
  return response.json();
}

async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Loopback port ${port} is already occupied`))
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function waitUntil(check, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {}
    await pause(500);
  }
  throw new Error(`${label} timed out; no busy container was forcibly stopped`);
}

export async function scaleApplications(filename, options = {}) {
  if (process.platform !== 'linux')
    throw new Error('Host-network capacity management requires Linux');
  process.umask(0o077);
  const config = normalizeCapacityConfig(readJson(filename), filename);
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  if ((fs.statSync(config.stateDir).mode & 0o077) !== 0)
    throw new Error('stateDir must have mode 700');
  const lock = path.join(config.stateDir, 'capacity.lock');
  const lockDescriptor = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(lockDescriptor, String(process.pid));
  const stateFile = path.join(config.stateDir, 'state.json');
  const runtimeFile = path.join(config.stateDir, 'compose.json');
  const docker = (...arguments_) =>
    command(['docker', ...arguments_], 'Docker command');
  const baseCompose = [
    'compose',
    '-p',
    config.project,
    '--env-file',
    config.envFile,
    '-f',
    config.composeFile,
  ];
  const runtimeCompose = ['compose', '-p', config.project, '-f', runtimeFile];
  try {
    const previous = fs.existsSync(stateFile) ? readJson(stateFile) : null;
    const counts = capacityCounts(config, previous?.counts, options);
    const wanted = selectedServices(counts);
    const base = JSON.parse(
      docker(...baseCompose, 'config', '--format', 'json')
    );
    const imageReference = base.services?.web?.image;
    if (!imageReference || imageReference !== base.services?.api?.image)
      throw new Error('Web/API must select one previously built image');
    const image = JSON.parse(docker('image', 'inspect', imageReference))[0];
    const apiTarget = `http://127.0.0.1:${config.apiGatewayPort}`;
    if (
      image.Config.Labels?.['io.agentifui.fastify-proxy-base-url'] !== apiTarget
    )
      throw new Error(
        'Build the image for this host-network API gateway before scaling'
      );
    const token = previous?.token || randomBytes(32).toString('hex');
    const runtime = renderCapacityCompose(base, config, image.Id, token);
    const origin = base.services.web.environment.NEXT_PUBLIC_APP_URL;
    const nginx = renderCapacityNginx(config, counts, origin);
    const identifiers = docker(
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${config.project}`
    )
      .split(/\s+/)
      .filter(Boolean);
    const containers = identifiers.length
      ? JSON.parse(docker('inspect', ...identifiers))
      : [];
    const existing = new Map();
    for (const container of containers) {
      const labels = container.Config.Labels || {};
      const name = labels['com.docker.compose.service'];
      if (!/^(web|api)(-\d+)?$/.test(name || '')) continue;
      const expected = runtime.services[name];
      if (
        !expected ||
        container.Image !== image.Id ||
        container.HostConfig.NetworkMode !== 'host' ||
        labels['io.agentifui.capacity.config'] !==
          expected.labels['io.agentifui.capacity.config']
      )
        throw new Error(
          'Existing applications differ from this image/configuration; use the explicit release procedure, not scaling'
        );
      if (existing.has(name))
        throw new Error('Duplicate managed application service');
      existing.set(name, container);
    }
    const oldNginx = fs.existsSync(config.upstreamFile)
      ? fs.readFileSync(config.upstreamFile, 'utf8')
      : null;
    if (
      oldNginx !== null &&
      (!previous?.upstreamDigest ||
        digest(oldNginx) !== previous.upstreamDigest)
    )
      throw new Error(
        'Refusing to overwrite an unmanaged or externally edited Nginx fragment'
      );
    const bindings = Object.fromEntries(
      ['web', 'api'].flatMap(role =>
        config[`${role}Ports`].map((port, index) => [
          serviceName(role, index),
          { role, port },
        ])
      )
    );
    const missing = wanted.filter(name => !existing.get(name)?.State.Running);
    for (const name of missing) await freePort(bindings[name].port);
    const state = previous || { counts: { web: 1, api: 1 }, token };
    atomicWrite(stateFile, JSON.stringify(state));
    atomicWrite(runtimeFile, JSON.stringify(runtime));
    docker(...runtimeCompose, 'config', '--quiet');
    if (missing.length)
      docker(
        ...runtimeCompose,
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--pull',
        'never',
        ...missing
      );
    for (const name of wanted) {
      const { role, port } = bindings[name];
      await waitUntil(
        async () => {
          const result = await request(
            port,
            role === 'web' ? '/api/auth/better/get-session' : '/healthz'
          );
          return role === 'web' || result.ok === true;
        },
        config.healthTimeoutSeconds,
        `${name} readiness`
      );
      if (role === 'api')
        await request(port, '/__agentifui/capacity', token, {
          draining: false,
        });
    }
    if (oldNginx !== nginx) {
      atomicWrite(config.upstreamFile, nginx);
      try {
        command(config.nginxTest, 'Nginx configuration check');
        command(config.nginxReload, 'Nginx reload');
      } catch (error) {
        if (oldNginx === null) fs.unlinkSync(config.upstreamFile);
        else atomicWrite(config.upstreamFile, oldNginx);
        try {
          command(config.nginxTest, 'Restored Nginx configuration check');
          command(config.nginxReload, 'Restored Nginx reload');
        } catch {
          throw new Error(
            'Nginx update and restoration failed; inspect the private deployment before retrying'
          );
        }
        throw error;
      }
    }
    Object.assign(state, {
      counts,
      token,
      image: image.Id,
      upstreamDigest: digest(nginx),
    });
    atomicWrite(stateFile, JSON.stringify(state));
    const removed = [...existing.keys()].filter(
      name => !wanted.includes(name) && existing.get(name).State.Running
    );
    for (const name of removed) {
      const { role, port } = bindings[name];
      if (role === 'api')
        await request(port, '/__agentifui/capacity', token, { draining: true });
      await waitUntil(
        async () => {
          if (role === 'api') {
            const status = await request(port, '/__agentifui/capacity', token);
            return status.activeRequests === 0 && status.backgroundTasks === 0;
          }
          const tables = ['tcp', 'tcp6']
            .map(table => fs.readFileSync(`/proc/net/${table}`, 'utf8'))
            .join('\n');
          return countEstablishedConnections(tables, port) === 0;
        },
        config.drainTimeoutSeconds,
        `${name} drain`
      );
      docker(...runtimeCompose, 'stop', name);
    }
    const actual = docker(
      ...runtimeCompose,
      'ps',
      '--status',
      'running',
      '--services'
    )
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    if (actual.join(',') !== [...wanted].sort().join(','))
      throw new Error(
        'Actual application count differs from target; inspect and retry'
      );
    const result = {
      at: new Date().toISOString(),
      counts,
      image: image.Id,
      running: actual,
    };
    fs.appendFileSync(
      path.join(config.stateDir, 'operations.jsonl'),
      JSON.stringify(result) + '\n',
      { mode: 0o600 }
    );
    return result;
  } finally {
    fs.closeSync(lockDescriptor);
    fs.unlinkSync(lock);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: {
        config: { type: 'string' },
        web: { type: 'string' },
        api: { type: 'string' },
      },
    });
    if (!values.config)
      throw new Error(
        'Usage: node scripts/docker-scale.mjs --config /private/capacity.json [--web 1] [--api 1]'
      );
    const result = await scaleApplications(values.config, values);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[docker-scale] ${error.message}`);
    process.exitCode = 1;
  }
}
