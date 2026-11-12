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

test('CI keeps six jobs, two dependency installs and one isolated service set', () => {
  expect(workflow.match(/^  [\w-]+:$/gm)?.slice(3)).toEqual([
    '  publication-check:',
    '  changes:',
    '  quality:',
    '  verify:',
    '  docker:',
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

test('Docker and runtime filters cover image inputs without rebuilding for documentation alone', () => {
  const changes = job('changes');
  expect(changes).toContain(
    "required: ${{ github.event_name == 'workflow_dispatch' || steps.filter.outputs.runtime == 'true' }}"
  );
  expect(changes).toContain(
    "docker_required: ${{ github.event_name == 'workflow_dispatch' || steps.filter.outputs.docker == 'true' }}"
  );
  expect(changes).toContain('docker: *runtime_paths');
  const paths = changes.match(
    /runtime: &runtime_paths\n([\s\S]*?)\n\s+docker: \*runtime_paths/
  )?.[1];
  expect(paths).toBeDefined();
  for (const pattern of [
    'app/**',
    'apps/**',
    'packages/**',
    'lib/**',
    'components/**',
    'hooks/**',
    'providers/**',
    'public/**',
    'content/**',
    'messages/**',
    'styles/**',
    'database/**',
    'scripts/**',
    '.github/workflows/**',
    '__tests__/scripts/**',
    '**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,scss,sql,sh,yml,yaml}',
    '**/Dockerfile*',
    '**/.dockerignore',
    'package.json',
    'pnpm*',
    'next.config.*',
    'tsconfig*',
    'postcss.config.*',
    'tailwind.config.*',
    '.npmrc',
    '.env*.example',
  ]) {
    expect(paths).toContain(`- '${pattern}'`);
  }
  expect(paths).not.toMatch(/- '(?:\*\*|\*\*\/\*|\*\*\/\*\.md|docs\/\*\*)'/);
});

test.each([
  ['scripts/smoke-docker.mjs', true],
  ['scripts/helper.cjs', true],
  ['app/page.tsx', true],
  ['lib/helper.ts', true],
  ['components/button.jsx', true],
  ['scripts/helper.js', true],
  ['docs/DOCKER.md', false],
  ['compose.yaml', false],
])('changed-file ESLint selection handles %s', (filename, selected) => {
  const pattern = job('quality').match(/grep -E '([^']+)'/)?.[1];
  expect(pattern).toBeDefined();
  expect(new RegExp(pattern!).test(filename)).toBe(selected);
});

test('Docker builds once into a local single-platform image with GHA caching', () => {
  const docker = job('docker');
  expect(docker).toContain('timeout-minutes: 30');
  expect(docker).toContain('needs: changes');
  expect(docker).toContain(
    "if: needs.changes.outputs.docker_required == 'true'"
  );
  expect(docker).toContain('uses: actions/checkout@v4');
  expect(docker).toContain('uses: actions/setup-node@v4');
  expect(docker).toContain('node-version: ${{ env.NODE_VERSION }}');
  expect(docker).toContain('uses: docker/setup-buildx-action@v3');
  expect(docker).toContain('uses: docker/build-push-action@v6');
  expect(docker).toContain('context: .');
  expect(docker).toContain('file: Dockerfile');
  expect(docker).toMatch(/^          platforms: linux\/amd64$/m);
  expect(docker).toContain('load: true');
  expect(docker).toContain('push: false');
  expect(docker).toContain('tags: agentifui:ci');
  expect(docker).toContain('SOURCE_COMMIT=${{ github.sha }}');
  expect(docker).toContain('NEXT_PUBLIC_APP_URL=http://127.0.0.1:23300');
  expect(docker).toContain('cache-from: type=gha');
  expect(docker).toContain('cache-to: type=gha,mode=max');
  expect(docker).toContain(
    'run: node scripts/smoke-docker.mjs --image agentifui:ci'
  );
  expect(docker).not.toMatch(
    /pnpm install|pnpm run build|services:|login-action/
  );
  expect(workflow).not.toMatch(
    /local_scripts\/|secrets\s*(?:\.|\[)|\.env\.prod\b/
  );
  expect(workflow).not.toMatch(/continue-on-error: true/);
});

test('verify always runs the full suite but defers builds to Docker when required', () => {
  expect(job('verify')).toMatch(
    /- name: Run tests\n\s+run: pnpm test --maxWorkers=2/
  );
  expect(job('verify')).toMatch(
    /- name: Build application and workspace packages\n\s+if: needs.changes.outputs.docker_required != 'true'\n\s+env:\n\s+NODE_ENV: production\n\s+run: pnpm run build:all/
  );
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
  expect(job('ci-status')).toMatch(
    /needs:\s*\n\s+- publication-check\n\s+- changes\n\s+- quality\n\s+- verify\n\s+- docker\n/
  );
  expect(job('ci-status')).toContain('CI_NEEDS: ${{ toJSON(needs) }}');
});

function ciNeeds(required: unknown = 'true', dockerRequired: unknown = 'true') {
  return {
    'publication-check': { result: 'success' },
    changes: {
      result: 'success',
      outputs: { required, docker_required: dockerRequired },
    },
    quality: { result: required === 'true' ? 'success' : 'skipped' },
    verify: { result: required === 'true' ? 'success' : 'skipped' },
    docker: { result: dockerRequired === 'true' ? 'success' : 'skipped' },
  };
}

function runCiStatus(needs: unknown) {
  const scripts = [
    ...job('ci-status').matchAll(/node <<'NODE'\n([\s\S]*?)\n\s*NODE/g),
  ];
  expect(scripts).toHaveLength(1);
  const exitSignal = new Error('process.exit');
  let exitCode = 0;
  try {
    vm.runInNewContext(scripts[0][1], {
      process: {
        env: { CI_NEEDS: JSON.stringify(needs) },
        exit: (code: number) => {
          exitCode = code;
          throw exitSignal;
        },
      },
      console: { log: jest.fn(), error: jest.fn() },
    });
  } catch (error) {
    if (error !== exitSignal) throw error;
  }
  return exitCode;
}

const requirementFlags = [
  ['true', 'true'],
  ['true', 'false'],
  ['false', 'true'],
  ['false', 'false'],
];

test.each(requirementFlags)(
  'CI status accepts exact expected results for runtime=%s, Docker=%s',
  (required, dockerRequired) => {
    expect(runCiStatus(ciNeeds(required, dockerRequired))).toBe(0);
  }
);

test.each(
  requirementFlags.flatMap(([required, dockerRequired]) =>
    (
      ['publication-check', 'changes', 'quality', 'verify', 'docker'] as const
    ).flatMap(name =>
      ['success', 'skipped', 'failure', 'cancelled', 'neutral', undefined]
        .filter(
          result => result !== ciNeeds(required, dockerRequired)[name].result
        )
        .map(result => ({ required, dockerRequired, name, result }))
    )
  )
)(
  'CI status rejects $name=$result for runtime=$required, Docker=$dockerRequired',
  ({ required, dockerRequired, name, result }) => {
    const needs = ciNeeds(required, dockerRequired);
    expect(runCiStatus({ ...needs, [name]: { result } })).toBe(1);
  }
);

test.each(['publication-check', 'changes', 'quality', 'verify', 'docker'])(
  'CI status rejects a missing %s dependency',
  name => {
    const needs: Record<string, unknown> = ciNeeds();
    delete needs[name];
    expect(runCiStatus(needs)).toBe(1);
  }
);

test.each([null, {}, { ...ciNeeds(), changes: { result: 'success' } }])(
  'CI status rejects missing dependency outputs: %j',
  needs => {
    expect(runCiStatus(needs)).toBe(1);
  }
);

test.each(
  (['required', 'docker_required'] as const).flatMap(flag =>
    [undefined, null, '', 'TRUE', '1', true, false].map(value => ({
      flag,
      value,
    }))
  )
)('CI status rejects invalid $flag=$value', ({ flag, value }) => {
  const needs = ciNeeds();
  needs.changes.outputs[flag] = value;
  expect(runCiStatus(needs)).toBe(1);
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
