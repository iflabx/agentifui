import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/ci.yml'),
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
  expect(job('verify')).toMatch(/run: pnpm test --runInBand/);
  expect(job('verify')).toMatch(
    /run: pnpm test --runInBand[\s\S]*?NODE_ENV: production\n\s+run: pnpm run build:all/
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
  const security = fs.readFileSync(
    path.join(process.cwd(), '.github/workflows/security.yml'),
    'utf8'
  );
  expect(security).toMatch(/^  schedule:$/m);
  expect(security).toMatch(/^  workflow_dispatch:$/m);
  expect(security).not.toMatch(/^  (?:pull_request|push):$/m);
  expect(security).toContain('pnpm audit --audit-level=moderate');
});
