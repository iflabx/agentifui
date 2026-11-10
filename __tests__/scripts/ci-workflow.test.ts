import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const workflow = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/ci.yml'),
  'utf8'
);

const security = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/security.yml'),
  'utf8'
);

function job(name: string) {
  const body = workflow.match(
    new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm')
  )?.[0];
  expect(body).toBeDefined();
  return body!;
}

test('CI keeps five jobs, two dependency installs and one isolated service set', () => {
  expect(workflow.match(/^  [\w-]+:$/gm)?.slice(3)).toEqual([
    '  publication-check:',
    '  changes:',
    '  quality:',
    '  verify:',
    '  ci-status:',
  ]);
  expect(workflow.match(/run: pnpm install --frozen-lockfile/g)).toHaveLength(
    2
  );
  expect(workflow.match(/^    services:$/gm)).toHaveLength(1);
  expect(workflow).not.toMatch(/actions\/upload-artifact|run: pnpm audit/);
  expect(job('verify')).toMatch(/run: pnpm test --maxWorkers=2/);
  expect(job('verify')).not.toContain('--forceExit');
  expect(job('verify')).toMatch(
    /run: pnpm test --maxWorkers=2[\s\S]*?NODE_ENV: production\n\s+run: pnpm run build:all/
  );
  expect(job('quality')).toContain('pnpm --filter @agentifui/api type-check');
});

test('CI object storage uses pinned upstream source and caches only binaries', () => {
  const verify = job('verify');
  expect(verify).toMatch(/GO_VERSION: '\d+\.\d+\.\d+'/);
  expect(verify).toMatch(/MINIO_COMMIT: '[a-f0-9]{40}'/);
  expect(verify).toMatch(/MC_COMMIT: '[a-f0-9]{40}'/);
  expect(verify).toContain('go install "github.com/minio/minio@$MINIO_COMMIT"');
  expect(verify).toContain('go install "github.com/minio/mc@$MC_COMMIT"');
  expect(verify).toContain('path: ${{ runner.temp }}/ci-s3/bin');
  expect(verify).toContain(
    'key: ci-s3-${{ runner.os }}-${{ runner.arch }}-go${{ env.GO_VERSION }}-${{ env.MINIO_COMMIT }}-${{ env.MC_COMMIT }}'
  );
  expect(
    verify.match(/if: steps.s3-tools.outputs.cache-hit != 'true'/g)
  ).toHaveLength(2);
  expect(verify).not.toMatch(/minio\/(?:minio|mc):|dl\.min\.io/);
});

test('CI object storage keeps data and client configuration ephemeral', () => {
  const verify = job('verify');
  expect(verify).toContain('server "$RUNNER_TEMP/minio-data"');
  expect(verify).toContain(
    '--address 127.0.0.1:9000 --console-address 127.0.0.1:9001'
  );
  expect(verify).toContain('export MC_CONFIG_DIR="$RUNNER_TEMP/mc-config"');
  expect(verify).toContain('mb --ignore-existing "ci/$S3_BUCKET"');
  expect(verify).toContain('for _ in {1..60}');
  expect(verify).toContain(
    'curl -fsS "$S3_ENDPOINT/minio/health/live" >/dev/null'
  );
});

test('publication checks remain unconditional while heavy jobs keep change gating', () => {
  expect(job('publication-check')).not.toMatch(/^    if:/m);
  expect(job('publication-check')).toContain(
    'uses: ./.github/actions/publication-check'
  );
  for (const name of ['quality', 'verify']) {
    expect(job(name)).toContain("if: needs.changes.outputs.required == 'true'");
  }
  expect(job('changes')).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow).toContain('cancel-in-progress: true');
  expect(job('ci-status')).toContain('name: CI Status Check');
  expect(job('ci-status')).toContain('if: always()');
});

test('security auditing remains weekly and manual rather than duplicating every PR', () => {
  expect(security).toMatch(/^  schedule:$/m);
  expect(security).toMatch(/^  workflow_dispatch:$/m);
  expect(security).not.toMatch(/^  (?:pull_request|push):$/m);
  expect(security).toContain("['audit', '--audit-level=moderate', '--json']");
});

function runSecurityScript(
  index: number,
  env: Record<string, string> = {},
  auditResult = { status: 0, stdout: '' }
) {
  const scripts = [...security.matchAll(/node <<'NODE'\n([\s\S]*?)\n\s*NODE/g)];
  expect(scripts).toHaveLength(2);
  const output: string[] = [];
  const scriptProcess: {
    env: Record<string, string>;
    exitCode?: number;
  } = {
    env: {
      GITHUB_OUTPUT: 'test-output',
      GITHUB_STEP_SUMMARY: 'test-summary',
      ...env,
    },
  };
  vm.runInNewContext(scripts[index][1], {
    require: (moduleName: string) => {
      if (moduleName === 'node:child_process') {
        return { spawnSync: () => auditResult };
      }
      if (moduleName === 'node:fs') {
        return {
          appendFileSync: (_file: string, value: string) => output.push(value),
        };
      }
      throw new Error(`Unexpected module: ${moduleName}`);
    },
    process: scriptProcess,
    console: { log: jest.fn(), error: jest.fn() },
  });
  return { output: output.join('\n'), exitCode: scriptProcess.exitCode };
}

test.each([
  [
    'passed',
    0,
    { metadata: { vulnerabilities: { moderate: 0, high: 0, critical: 0 } } },
  ],
  [
    'vulnerabilities',
    1,
    { metadata: { vulnerabilities: { moderate: 2, high: 1, critical: 0 } } },
  ],
  ['error', 1, { error: { code: 'ECONNRESET' } }],
  ['error', 1, {}],
  [
    'error',
    0,
    { metadata: { vulnerabilities: { moderate: 1, high: 0, critical: 0 } } },
  ],
  [
    'error',
    1,
    { metadata: { vulnerabilities: { moderate: 0, high: 0, critical: 0 } } },
  ],
] as const)(
  'dependency audit reports %s for exit %s and %j',
  (status, exitCode, report) => {
    const result = runSecurityScript(
      0,
      {},
      {
        status: exitCode,
        stdout: JSON.stringify(report),
      }
    );
    expect(result.output).toBe(`status=${status}\n`);
    expect(result.exitCode).toBe(status === 'error' ? 1 : undefined);
  }
);

test('dependency audit treats invalid JSON as an incomplete audit', () => {
  const result = runSecurityScript(0, {}, { status: 1, stdout: 'Unavailable' });
  expect(result.output).toBe('status=error\n');
  expect(result.exitCode).toBe(1);
});

test.each([
  ['passed', 'success', 'success', 'No findings reported', undefined],
  ['vulnerabilities', 'success', 'success', 'Attention required', undefined],
  ['error', 'failure', 'success', 'Checks failed or incomplete', 1],
  ['passed', 'success', 'failure', 'Checks failed or incomplete', 1],
  ['', 'skipped', 'success', 'Checks failed or incomplete', 1],
] as const)(
  'security summary handles %s / %s / %s',
  (auditStatus, dependencyResult, codeResult, message, exitCode) => {
    const result = runSecurityScript(1, {
      AUDIT_STATUS: auditStatus,
      DEPENDENCY_RESULT: dependencyResult,
      CODE_RESULT: codeResult,
    });
    expect(result.output).toContain(message);
    expect(result.output).not.toContain('Overall Status: Secure');
    expect(result.exitCode).toBe(exitCode);
  }
);
