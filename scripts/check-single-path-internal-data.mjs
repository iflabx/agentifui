#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const nextRouteFile = resolve(rootDir, 'app/api/internal/data/route.ts');
const browserBridgeFile = resolve(rootDir, 'lib/db/internal-data-api.ts');

function assertPattern(source, pattern, message, filePath) {
  if (pattern.test(source)) {
    return;
  }
  throw new Error(`[single-path-internal-data] ${message} (${filePath})`);
}

function main() {
  const nextRouteSource = readFileSync(nextRouteFile, 'utf8');
  const bridgeSource = readFileSync(browserBridgeFile, 'utf8');

  assertPattern(
    nextRouteSource,
    /INTERNAL_DATA_NEXT_DISABLED/,
    'Next internal-data route must stay disabled after Fastify convergence',
    nextRouteFile
  );
  assertPattern(
    nextRouteSource,
    /status:\s*503/,
    'Next internal-data route must return 503',
    nextRouteFile
  );

  const fetchMatches = bridgeSource.match(
    /fetch\(\s*['"]\/api\/internal\/data['"]/g
  );
  if (!fetchMatches || fetchMatches.length !== 1) {
    throw new Error(
      `[single-path-internal-data] browser bridge must call /api/internal/data exactly once (${browserBridgeFile})`
    );
  }

  if (/\/api\/internal\/data\/fallback/.test(bridgeSource)) {
    throw new Error(
      `[single-path-internal-data] fallback internal-data endpoints are not allowed (${browserBridgeFile})`
    );
  }

  console.log('single-path-internal-data: ok');
}

main();
