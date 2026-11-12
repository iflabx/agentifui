/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function evaluate(script: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'test' },
  });
}

test('type checks exclude private research and validation sources', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8')
  );
  expect(config.exclude).toEqual(
    expect.arrayContaining(['local_docs', 'local_scripts', 'private-baselines'])
  );
  expect(config.include).toEqual(
    expect.arrayContaining(['**/*.ts', '**/*.tsx'])
  );
});

test('Docker smoke validates arguments without starting Docker on import', () => {
  const result = evaluate(`
    import assert from 'node:assert/strict';
    import { parseArguments } from './scripts/smoke-docker.mjs';
    assert.deepEqual(parseArguments(['--image', 'fixture:local']), { image: 'fixture:local', port: 23300 });
    assert.deepEqual(parseArguments(['--image', 'fixture:local', '--web-port', '24400']), { image: 'fixture:local', port: 24400 });
    for (const args of [[], ['--image'], ['--other', 'value'], ['--image', '-bad'], ['--image', 'fixture', '--web-port', '0'], ['--image', 'fixture', '--web-port', '23300.1']])
      assert.throws(() => parseArguments(args));
  `);
  expect(result.status).toBe(0);
});

test('Docker smoke uses synthetic isolated configuration and redacts credentials', () => {
  const result = evaluate(`
    import assert from 'node:assert/strict';
    import { createEnvironment, redact } from './scripts/smoke-docker.mjs';
    process.env.DATABASE_URL = 'must-not-inherit';
    const environment = createEnvironment('fixture:local', 24400, 'fixture-project');
    assert.equal(environment.WEB_BIND_IP, '127.0.0.1');
    assert.equal(environment.STORAGE_PORT, '0');
    assert.equal(environment.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:24400');
    assert.equal(environment.REDIS_PREFIX, 'fixture-project');
    assert.equal(environment.SMTP_HOST, 'smtp.example.invalid');
    assert.notEqual(environment.DATABASE_URL, process.env.DATABASE_URL);
    assert.notEqual(environment.APP_DATABASE_PASSWORD, environment.POSTGRES_PASSWORD);
    assert.equal(environment.API_ENCRYPTION_KEY.length, 64);
    const secrets = Object.entries(environment).filter(([name]) => /PASSWORD|SECRET|ENCRYPTION_KEY|DATABASE_URL|REDIS_URL/.test(name));
    const output = redact(secrets.map(([, value]) => value).join(' '), environment);
    for (const [, value] of secrets) assert(!output.includes(value));
  `);
  expect(result.status).toBe(0);
});

test('Docker smoke scopes cleanup and never builds, initializes or stops an existing project', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'scripts/smoke-docker.mjs'),
    'utf8'
  );
  expect(script).toContain('agentifui-smoke-${randomBytes(8)');
  expect(script).toContain("docker(['image', 'inspect', options.image])");
  expect(script).toContain("'--no-build'");
  expect(script).toMatch(/'down',\s*'--volumes'/);
  expect(script).toContain('for (const item of baseline)');
  expect(script).toMatch(/current\.get\(item\.id\),\s*item/);
  expect(script).not.toMatch(
    /system.*prune|volume.*prune|container.*prune|local_scripts|\.env\.prod/
  );
});
