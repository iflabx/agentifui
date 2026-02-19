#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const rootDir = process.cwd();
const nextApiDir = resolve(rootDir, 'app/api');
const apiConfigFile = resolve(rootDir, 'apps/api/src/config.ts');

const NEXT_AUTH_OWNED_PREFIXES = ['/api/auth', '/api/sso', '/api/internal/auth'];
const NEXT_AUTH_OWNED_EXACT = new Set(['/api/internal/auth/profile-status']);

function walkRouteFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkRouteFiles(full));
      continue;
    }
    if (entry === 'route.ts') {
      files.push(full);
    }
  }
  return files;
}

function extractPrefixList(sourceText, variableName, filePath) {
  const pattern = new RegExp(
    `const\\s+${variableName}\\s*=\\s*\\[([\\s\\S]*?)\\];`,
    'm'
  );
  const match = sourceText.match(pattern);
  if (!match) {
    throw new Error(`Cannot find ${variableName} in ${filePath}`);
  }

  const values = [];
  const quotePattern = /'([^']+)'/g;
  let item = quotePattern.exec(match[1]);
  while (item) {
    values.push(item[1]);
    item = quotePattern.exec(match[1]);
  }
  return values;
}

function toRoutePath(routeFile) {
  const rel = relative(rootDir, routeFile).replaceAll('\\', '/');
  const noPrefix = rel.replace(/^app\/api\//, '');
  const noSuffix = noPrefix.replace(/\/route\.ts$/, '');
  return `/api/${noSuffix}`;
}

function isNextAuthOwned(routePath) {
  if (NEXT_AUTH_OWNED_EXACT.has(routePath)) {
    return true;
  }

  return NEXT_AUTH_OWNED_PREFIXES.some(
    prefix => routePath === prefix || routePath.startsWith(`${prefix}/`)
  );
}

function hasPrefixCoverage(routePath, proxyPrefixes) {
  return proxyPrefixes.some(prefix => {
    return routePath === prefix || routePath.startsWith(`${prefix}/`);
  });
}

function main() {
  const configSource = readFileSync(apiConfigFile, 'utf8');
  const proxyPrefixes = extractPrefixList(
    configSource,
    'DEFAULT_FASTIFY_PROXY_PREFIXES',
    apiConfigFile
  );

  const routeFiles = walkRouteFiles(nextApiDir);
  const violations = [];

  for (const routeFile of routeFiles) {
    const routePath = toRoutePath(routeFile);
    if (isNextAuthOwned(routePath)) {
      continue;
    }

    if (!hasPrefixCoverage(routePath, proxyPrefixes)) {
      violations.push({ routePath, routeFile: relative(rootDir, routeFile) });
    }
  }

  if (violations.length > 0) {
    console.error('[next-business-boundary] non-auth Next API route is outside Fastify proxy ownership:');
    for (const item of violations) {
      console.error(`- ${item.routePath} (${item.routeFile})`);
    }
    process.exit(1);
  }

  console.log('next-business-boundary: ok');
}

main();
