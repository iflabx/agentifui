#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const nextConfigFile = resolve(rootDir, 'next.config.ts');
const apiConfigFile = resolve(rootDir, 'apps/api/src/config.ts');

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

function formatList(values) {
  return values.map(value => `  - ${value}`).join('\n');
}

function main() {
  const nextConfigText = readFileSync(nextConfigFile, 'utf8');
  const apiConfigText = readFileSync(apiConfigFile, 'utf8');

  const nextPrefixes = extractPrefixList(
    nextConfigText,
    'DEFAULT_FASTIFY_PROXY_PREFIXES',
    nextConfigFile
  );
  const apiPrefixes = extractPrefixList(
    apiConfigText,
    'DEFAULT_FASTIFY_PROXY_PREFIXES',
    apiConfigFile
  );

  const nextSerialized = JSON.stringify(nextPrefixes);
  const apiSerialized = JSON.stringify(apiPrefixes);
  if (nextSerialized !== apiSerialized) {
    console.error(
      '[check-fastify-proxy-prefixes] DEFAULT_FASTIFY_PROXY_PREFIXES mismatch'
    );
    console.error(`next.config.ts:\n${formatList(nextPrefixes)}`);
    console.error(`apps/api/src/config.ts:\n${formatList(apiPrefixes)}`);
    process.exit(1);
  }

  console.log('fastify-proxy-prefixes: ok');
}

main();
