import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const serviceName = (role, index) =>
  index === 0 ? role : `${role}-${index + 1}`;
export const digest = value =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function normalizeCapacityConfig(input, filename) {
  const directory = path.dirname(path.resolve(filename));
  const result = { ...input };
  for (const field of ['envFile', 'composeFile', 'stateDir', 'upstreamFile']) {
    if (typeof input[field] !== 'string' || !input[field])
      throw new Error(`${field} is required`);
    result[field] = path.resolve(directory, input[field]);
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(input.project || ''))
    throw new Error('Set a valid dedicated Compose project');
  result.upstreamPrefix = input.upstreamPrefix || 'agentifui_capacity';
  if (!/^[a-z][a-z0-9_]*$/.test(result.upstreamPrefix))
    throw new Error('Invalid upstreamPrefix');
  const ports = [];
  for (const role of ['web', 'api']) {
    if (!Array.isArray(input[`${role}Ports`]) || !input[`${role}Ports`].length)
      throw new Error(`${role}Ports must contain at least one port`);
    ports.push(...input[`${role}Ports`]);
    const resources = input[`${role}Resources`] || {};
    result[`${role}Resources`] = {
      cpus: resources.cpus || 2,
      mem_limit: resources.memory || (role === 'web' ? '2g' : '1g'),
    };
  }
  ports.push(input.webGatewayPort, input.apiGatewayPort);
  if (
    ports.some(
      port => !Number.isInteger(port) || port < 1024 || port > 65535
    ) ||
    new Set(ports).size !== ports.length
  )
    throw new Error('Use distinct integer ports between 1024 and 65535');
  for (const field of ['nginxTest', 'nginxReload']) {
    if (
      !Array.isArray(input[field]) ||
      !input[field].length ||
      input[field].some(argument => typeof argument !== 'string' || !argument)
    )
      throw new Error(`${field} must be a command argument array`);
  }
  for (const field of ['healthTimeoutSeconds', 'drainTimeoutSeconds']) {
    result[field] = input[field] ?? 180;
    if (
      !Number.isInteger(result[field]) ||
      result[field] < 1 ||
      result[field] > 3600
    )
      throw new Error(`${field} must be between 1 and 3600`);
  }
  return result;
}

export function capacityCounts(config, previous, options) {
  const result = {};
  for (const role of ['web', 'api']) {
    const raw = options[role] ?? previous?.[role] ?? 1;
    if (!/^[1-9]\d*$/.test(String(raw)))
      throw new Error(`${role} must be a positive integer`);
    result[role] = Number(raw);
    if (result[role] > config[`${role}Ports`].length)
      throw new Error(
        `${role} exceeds configured slots; extend the instance port table first`
      );
  }
  return result;
}

export function selectedServices(counts) {
  return ['web', 'api'].flatMap(role =>
    Array.from({ length: counts[role] }, (_, index) => serviceName(role, index))
  );
}

export function renderCapacityCompose(base, config, image, token) {
  const result = {
    name: config.project,
    services: {},
    volumes: base.volumes || {},
  };
  for (const role of ['web', 'api']) {
    const original = base.services?.[role];
    if (!original) throw new Error(`Missing ${role} in base Compose`);
    config[`${role}Ports`].forEach((port, index) => {
      const service = structuredClone(original);
      for (const field of [
        'build',
        'ports',
        'networks',
        'depends_on',
        'profiles',
        'container_name',
      ])
        delete service[field];
      Object.assign(service, {
        image,
        pull_policy: 'never',
        network_mode: 'host',
        command: [role],
        ...config[`${role}Resources`],
      });
      service.environment = {
        ...service.environment,
        FASTIFY_PROXY_BASE_URL: `http://127.0.0.1:${config.apiGatewayPort}`,
        NEXT_UPSTREAM_BASE_URL: `http://127.0.0.1:${config.webGatewayPort}`,
        REALTIME_OUTBOX_ENABLED: role === 'api' ? '1' : '0',
        ...(role === 'web'
          ? { WEB_HOST: '127.0.0.1', WEB_LISTEN_PORT: String(port) }
          : {
              FASTIFY_API_HOST: '127.0.0.1',
              FASTIFY_API_PORT: String(port),
              APP_CAPACITY_TOKEN: token,
            }),
      };
      service.labels = {
        ...(service.labels || {}),
        'io.agentifui.capacity.role': role,
      };
      service.healthcheck = {
        test: [
          'CMD',
          'node',
          '-e',
          `fetch('http://127.0.0.1:${port}${role === 'web' ? '/api/auth/better/get-session' : '/healthz'}',{headers:{Connection:'close'}}).then(async response=>{await response.arrayBuffer();if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))`,
        ],
        interval: '15s',
        timeout: '10s',
        start_period: '45s',
        retries: 3,
      };
      service.labels['io.agentifui.capacity.config'] = digest(service);
      result.services[serviceName(role, index)] = service;
    });
  }
  return result;
}

export function fastifyPrefixes() {
  const source = fs.readFileSync(
    new URL('../../next.config.ts', import.meta.url),
    'utf8'
  );
  const list = source.match(
    /const DEFAULT_FASTIFY_PROXY_PREFIXES\s*=\s*\[([\s\S]*?)\]/
  )?.[1];
  if (!list) throw new Error('Cannot resolve the source route ownership list');
  const prefixes = [...list.matchAll(/'([^']+)'/g)].map(match => match[1]);
  if (prefixes.some(prefix => !/^\/[a-z0-9/_-]+$/.test(prefix)))
    throw new Error('Unsupported route prefix');
  return prefixes;
}

export function renderCapacityNginx(
  config,
  counts,
  origin,
  prefixes = fastifyPrefixes()
) {
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('NEXT_PUBLIC_APP_URL must be a public HTTP(S) origin');
  const prefix = config.upstreamPrefix;
  const upstream = (name, ports, least = false) =>
    `upstream ${prefix}_${name} {\n  zone ${prefix}_${name} 64k;\n${least ? '  least_conn;\n' : ''}${ports.map(port => `  server 127.0.0.1:${port} max_fails=2 fail_timeout=5s;`).join('\n')}\n  keepalive 16;\n}\n`;
  const proxy = target => `proxy_pass http://${target};
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host ${url.host};
    proxy_set_header X-Forwarded-Host ${url.host};
    proxy_set_header X-Forwarded-Proto ${url.protocol.slice(0, -1)};
    proxy_set_header X-Forwarded-Port ${url.port || (url.protocol === 'https:' ? '443' : '80')};
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_next_upstream off;`;
  const internal = (port, target, health = false) => `server {
  listen 127.0.0.1:${port};
  set_real_ip_from 127.0.0.1;
  set_real_ip_from ::1;
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;
  location ^~ /__agentifui/ { return 404; }
${health ? `  location = /healthz { ${proxy(`${prefix}_api`)} }\n` : ''}
  location / {
    ${proxy(target)}
  }
}\n`;
  return [
    upstream('web', config.webPorts.slice(0, counts.web)),
    upstream('api', config.apiPorts.slice(0, counts.api), true),
    upstream('writer', [config.apiPorts[0]]),
    `map $uri $${prefix}_backend {
  default ${prefix}_web;
  ~^/api/admin/translations(?:/|$) ${prefix}_writer;
  ~^/api/admin/content/pages(?:/|$) ${prefix}_writer;
${['/api/auth', '/api/sso', '/api/internal/auth'].map(route => `  ~^${route}(?:/|$) ${prefix}_web;`).join('\n')}
${prefixes.map(route => `  ~^${route}(?:/|$) ${prefix}_api;`).join('\n')}
}\n`,
    internal(config.webGatewayPort, `${prefix}_web`),
    internal(config.apiGatewayPort, `$${prefix}_backend`, true),
  ].join('\n');
}

export function countEstablishedConnections(contents, port) {
  const hexadecimal = port.toString(16).toUpperCase().padStart(4, '0');
  return contents.split('\n').filter(line => {
    const columns = line.trim().split(/\s+/);
    return columns[1]?.split(':')[1] === hexadecimal && columns[3] === '01';
  }).length;
}
