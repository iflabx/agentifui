/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

function readFile(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

const manifest = JSON.parse(readFile('package.json'));
const apiManifest = JSON.parse(readFile('apps/api/package.json'));
const sharedManifest = JSON.parse(readFile('packages/shared/package.json'));

test('Next runtime and configuration packages use the same version', () => {
  expect(manifest.devDependencies['eslint-config-next']).toBe(
    manifest.dependencies.next
  );
  expect(manifest.devDependencies['@next/bundle-analyzer']).toBe(
    manifest.dependencies.next
  );
});

test('React, Tailwind and authentication packages keep their paired versions', () => {
  expect(manifest.dependencies.react).toBe(manifest.dependencies['react-dom']);
  expect(manifest.devDependencies['@types/react']).toBe(
    manifest.devDependencies['@types/react-dom']
  );
  expect(manifest.devDependencies.tailwindcss).toBe(
    manifest.devDependencies['@tailwindcss/postcss']
  );
  expect(manifest.dependencies['better-auth']).toBe(
    manifest.dependencies['@better-auth/sso']
  );
});

test('workspace compilers and database clients stay aligned', () => {
  for (const workspace of [apiManifest, sharedManifest]) {
    expect(workspace.devDependencies.typescript).toBe(
      manifest.devDependencies.typescript
    );
  }
  expect(apiManifest.dependencies.pg).toBe(manifest.dependencies.pg);
});

test('Jest transformer and environment follow the Jest runtime version', () => {
  expect(manifest.devDependencies['babel-jest']).toBe(
    manifest.devDependencies.jest
  );
  expect(manifest.devDependencies['jest-environment-jsdom']).toBe(
    manifest.devDependencies.jest
  );
});

test('packages with bundled types do not retain obsolete type dependencies', () => {
  expect(manifest.dependencies['@types/uuid']).toBeUndefined();
  expect(manifest.devDependencies['@types/uuid']).toBeUndefined();
  expect(manifest.devDependencies['@types/nodemailer']).toBeUndefined();
  expect(manifest.dependencies['utf-8-validate']).toBeUndefined();
});

test('Node and pnpm versions agree across CI, the test image and runbooks', () => {
  const nodeVersion = readFile('.nvmrc').trim();
  const pnpmVersion = manifest.packageManager.replace(/^pnpm@/, '');
  expect(manifest.engines.node).toBe(`^${nodeVersion}`);
  expect(manifest.engines.pnpm).toBe(pnpmVersion);
  expect(readFile('.github/workflows/ci.yml')).toContain(
    `NODE_VERSION: '${nodeVersion}'`
  );
  expect(readFile('.github/workflows/security.yml')).toContain(
    `node-version: '${nodeVersion}'`
  );
  expect(readFile('Dockerfile.prod-test')).toContain(
    `FROM node:${nodeVersion}-bookworm-slim`
  );
  for (const relative of [
    'Dockerfile.prod-test',
    'README.md',
    'docs/QUICK-DEPLOYMENT.md',
  ]) {
    expect(readFile(relative)).toContain(`pnpm@${pnpmVersion}`);
  }
});

test('installs enforce runtime engines and peer dependency compatibility', () => {
  const workspace = readFile('pnpm-workspace.yaml');
  expect(workspace).toMatch(/^engineStrict: true$/m);
  expect(workspace).toMatch(/^strictPeerDependencies: true$/m);
});

test('SSO plugin storage has a separate additive migration', () => {
  const configuration = readFile('lib/auth/better-auth/server.ts');
  const migration = readFile(
    'database/migrations/20261110113000_create_better_auth_sso_providers.sql'
  );
  expect(configuration).toContain("modelName: 'auth_sso_providers'");
  expect(migration).toContain(
    'CREATE TABLE IF NOT EXISTS public.auth_sso_providers'
  );
  for (const field of [
    'oidc_config',
    'saml_config',
    'user_id',
    'provider_id',
    'organization_id',
  ]) {
    expect(configuration).toContain(`'${field}'`);
    expect(migration).toContain(field);
  }
  expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|UPDATE|DELETE FROM)\b/i);
});

test('Next cookie forwarding runs after authentication plugin hooks', () => {
  const configuration = readFile('lib/auth/better-auth/server.ts');
  expect(configuration).toMatch(/nextCookies\(\),\s*\],\s*\}\);\s*$/);
});

test('normal development and builds explicitly keep the Webpack compiler', () => {
  for (const command of Object.values(manifest.scripts) as string[]) {
    if (command.includes('next build')) {
      expect(command).toContain('next build --webpack');
    }
    if (command.includes('next dev') && !command.includes('--turbopack')) {
      expect(command).toContain('next dev --webpack');
    }
    expect(command).not.toContain('next lint');
  }
  expect(readFile('next.config.ts')).not.toMatch(/ignoreDuringBuilds/);
});

test('ESLint uses the Next native flat configuration without legacy conversion', () => {
  const configuration = readFile('eslint.config.mjs');
  expect(configuration).toContain('eslint-config-next/core-web-vitals');
  expect(configuration).toContain('eslint-config-next/typescript');
  expect(configuration).not.toContain('FlatCompat');
  expect(configuration).not.toMatch(/['"]react-hooks\/rules-of-hooks['"]\s*:/);
  expect(configuration).not.toMatch(/['"]react-hooks\/exhaustive-deps['"]\s*:/);
});
