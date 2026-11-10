#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const nextConfigFile = resolve(rootDir, 'next.config.ts');
const apiConfigFile = resolve(rootDir, 'apps/api/src/config.ts');
const NEXT_AUTH_OWNED_PREFIXES = [
  '/api/auth',
  '/api/sso',
  '/api/internal/auth',
];

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

function normalizePrefixList(rawValue) {
  const seen = new Set();
  return rawValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => (value.startsWith('/') ? value : `/${value}`))
    .map(value => (value.length > 1 ? value.replace(/\/+$/, '') : value))
    .filter(value => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function isPrefixOverlapping(candidatePrefix, authOwnedPrefix) {
  return (
    candidatePrefix === authOwnedPrefix ||
    candidatePrefix.startsWith(`${authOwnedPrefix}/`) ||
    authOwnedPrefix.startsWith(`${candidatePrefix}/`)
  );
}

function collectAuthBoundaryViolations(prefixes, sourceLabel) {
  const violations = [];

  for (const prefix of prefixes) {
    for (const authOwnedPrefix of NEXT_AUTH_OWNED_PREFIXES) {
      if (!isPrefixOverlapping(prefix, authOwnedPrefix)) {
        continue;
      }
      violations.push({
        sourceLabel,
        prefix,
        matchedAuthPrefix: authOwnedPrefix,
      });
      break;
    }
  }

  return violations;
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

  const boundaryViolations = [
    ...collectAuthBoundaryViolations(nextPrefixes, 'next.config.ts'),
    ...collectAuthBoundaryViolations(apiPrefixes, 'apps/api/src/config.ts'),
  ];

  const runtimeEnvPrefixesRaw = process.env.FASTIFY_PROXY_PREFIXES;
  if (runtimeEnvPrefixesRaw && runtimeEnvPrefixesRaw.trim().length > 0) {
    const runtimeEnvPrefixes = normalizePrefixList(runtimeEnvPrefixesRaw);
    boundaryViolations.push(
      ...collectAuthBoundaryViolations(
        runtimeEnvPrefixes,
        'FASTIFY_PROXY_PREFIXES (env)'
      )
    );
  }

  if (boundaryViolations.length > 0) {
    console.error(
      '[check-fastify-proxy-prefixes] auth-owned paths must stay Next-owned; remove these prefixes from Fastify proxy config:'
    );
    for (const violation of boundaryViolations) {
      console.error(
        `- source=${violation.sourceLabel} prefix=${violation.prefix} overlaps=${violation.matchedAuthPrefix}`
      );
    }
    process.exit(1);
  }

  console.log('fastify-proxy-prefixes: ok');
}

main();
