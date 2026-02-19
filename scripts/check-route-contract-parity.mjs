#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const apiConfigFile = resolve(rootDir, 'apps/api/src/config.ts');
const routesDir = resolve(rootDir, 'apps/api/src/routes');

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

function readRouteSources() {
  const files = readdirSync(routesDir).filter(name => name.endsWith('.ts'));
  return files.map(name => ({
    file: resolve(routesDir, name),
    source: readFileSync(resolve(routesDir, name), 'utf8'),
  }));
}

function hasPrefixCoverage(prefix, routeSources) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefixRegex = new RegExp(`['"\`]${escaped}(?:/|['"\`])`);
  if (prefix === '/api/admin') {
    return routeSources.some(item =>
      /['"`]\/api\/admin(?:\/|['"`])/.test(item.source)
    );
  }
  return routeSources.some(item => prefixRegex.test(item.source));
}

function main() {
  const configSource = readFileSync(apiConfigFile, 'utf8');
  const proxyPrefixes = extractPrefixList(
    configSource,
    'DEFAULT_FASTIFY_PROXY_PREFIXES',
    apiConfigFile
  );
  const routeSources = readRouteSources();

  const missing = proxyPrefixes.filter(
    prefix => !hasPrefixCoverage(prefix, routeSources)
  );

  if (missing.length > 0) {
    console.error('[route-contract-parity] missing Fastify route coverage:');
    for (const prefix of missing) {
      console.error(`- ${prefix}`);
    }
    process.exit(1);
  }

  console.log('route-contract-parity: ok');
}

main();
