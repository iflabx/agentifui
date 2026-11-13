/** @jest-environment node */
import { spawnSync } from 'node:child_process';

function evaluate(operation: string, arguments_: unknown[]) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import * as capacity from './scripts/lib/docker-capacity.mjs';
    const input = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(capacity[input.operation](...input.arguments)));
  `,
      JSON.stringify({ operation, arguments: arguments_ }),
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  return {
    ...result,
    value: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

const configuration = {
  project: 'fixture',
  envFile: '.env.fixture',
  composeFile: 'compose.yaml',
  stateDir: 'private/state',
  upstreamFile: 'private/upstreams.conf',
  webPorts: [23001, 23002],
  apiPorts: [23101, 23102, 23103],
  webGatewayPort: 23000,
  apiGatewayPort: 23010,
  nginxTest: ['nginx', '-t'],
  nginxReload: ['nginx', '-s', 'reload'],
};
const normalized = () =>
  evaluate('normalizeCapacityConfig', [
    configuration,
    '/tmp/deployment/capacity.json',
  ]).value;

test('defaults to one Web/API, preserves prior counts, and supports independent changes', () => {
  const config = normalized();
  expect(evaluate('capacityCounts', [config, null, {}]).value).toEqual({
    web: 1,
    api: 1,
  });
  expect(
    evaluate('capacityCounts', [config, { web: 2, api: 3 }, {}]).value
  ).toEqual({ web: 2, api: 3 });
  expect(
    evaluate('capacityCounts', [config, { web: 2, api: 3 }, { api: '1' }]).value
  ).toEqual({ web: 2, api: 1 });
  expect(evaluate('selectedServices', [{ web: 2, api: 3 }]).value).toEqual([
    'web',
    'web-2',
    'api',
    'api-2',
    'api-3',
  ]);
});

test.each(['0', '-1', '1.5', 'NaN', ' 2', '100'])(
  'rejects invalid/out-of-range target %s',
  value => {
    expect(
      evaluate('capacityCounts', [normalized(), null, { api: value }]).status
    ).not.toBe(0);
  }
);

test('validates loopback port allocation and command arguments', () => {
  expect(
    evaluate('normalizeCapacityConfig', [
      { ...configuration, apiPorts: [23001] },
      '/tmp/settings.json',
    ]).status
  ).not.toBe(0);
  expect(
    evaluate('normalizeCapacityConfig', [
      { ...configuration, nginxReload: 'nginx -s reload' },
      '/tmp/settings.json',
    ]).status
  ).not.toBe(0);
  expect(
    evaluate('normalizeCapacityConfig', [
      { ...configuration, upstreamPrefix: 'bad;config' },
      '/tmp/settings.json',
    ]).status
  ).not.toBe(0);
  expect(normalized().envFile).toBe('/tmp/deployment/.env.fixture');
});

test('renders only application slots with immutable images and separate content/init boundaries', () => {
  const base = {
    services: Object.fromEntries(
      ['web', 'api'].map(role => [
        role,
        {
          image: 'agentifui:fixture',
          build: { context: '.' },
          ports: ['3000:3000'],
          networks: ['default'],
          environment: {
            DATABASE_URL: 'postgresql://app@localhost/db',
            BETTER_AUTH_SECRET: 'fixture',
          },
          volumes: [{ type: 'volume', source: 'content', target: '/data' }],
        },
      ])
    ),
    volumes: { content: { name: 'fixture_content' } },
  };
  const result = evaluate('renderCapacityCompose', [
    base,
    normalized(),
    'sha256:fixture',
    'private-capacity-fixture',
  ]).value;
  expect(Object.keys(result.services)).toHaveLength(5);
  expect(result.services).not.toHaveProperty('postgres');
  expect(result.volumes.content.name).toBe('fixture_content');
  expect(result.services.web.environment).toMatchObject({
    WEB_HOST: '127.0.0.1',
    WEB_LISTEN_PORT: '23001',
    REALTIME_OUTBOX_ENABLED: '0',
  });
  expect(result.services.web.environment).not.toHaveProperty(
    'APP_CAPACITY_TOKEN'
  );
  expect(result.services['api-3'].environment).toMatchObject({
    FASTIFY_API_PORT: '23103',
    REALTIME_OUTBOX_ENABLED: '1',
  });
  for (const service of Object.values(result.services) as Record<
    string,
    unknown
  >[]) {
    expect(service.image).toBe('sha256:fixture');
    expect(service.network_mode).toBe('host');
    expect(service).not.toHaveProperty('ports');
    expect(service).not.toHaveProperty('build');
    expect(service).not.toHaveProperty('depends_on');
  }
});

test('routes authentication to Web, content writes to one API, and includes only selected slots', () => {
  const result = evaluate('renderCapacityNginx', [
    normalized(),
    { web: 1, api: 2 },
    'https://chat.example.com:8443',
  ]).value;
  expect(result).toContain(
    '~^/api/internal/auth(?:/|$) agentifui_capacity_web;'
  );
  expect(result).toContain(
    '~^/api/admin/content/pages(?:/|$) agentifui_capacity_writer;'
  );
  expect(result).toContain('server 127.0.0.1:23102');
  expect(result).not.toContain('server 127.0.0.1:23103');
  expect(result).not.toContain('server 127.0.0.1:23002');
  expect(result).toContain('proxy_set_header Host chat.example.com:8443;');
  expect(result).toContain('proxy_set_header X-Forwarded-Proto https;');
  expect(result).toContain('proxy_next_upstream off;');
  expect(result).toContain('location ^~ /__agentifui/ { return 404; }');
});

test('counts established inbound sockets, not idle listeners or client-side sockets', () => {
  const sockets =
    '0: 0100007F:59D9 0100007F:ABCD 01\n1: 0100007F:59D9 00000000:0000 0A\n2: 0100007F:ABCD 0100007F:59D9 01';
  expect(evaluate('countEstablishedConnections', [sockets, 23001]).value).toBe(
    1
  );
});
