#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const nextSessionOptionsFile = path.join(
  rootDir,
  'lib/server/pg/session-options.ts'
);
const fastifyPgContextFile = path.join(rootDir, 'apps/api/src/lib/pg-context.ts');

function assertPattern({ source, pattern, message, filePath }) {
  if (pattern.test(source)) {
    return;
  }
  throw new Error(`[rls-strict-consistency] ${message} (${filePath})`);
}

async function main() {
  const [nextSource, fastifySource] = await Promise.all([
    fs.readFile(nextSessionOptionsFile, 'utf8'),
    fs.readFile(fastifyPgContextFile, 'utf8'),
  ]);

  assertPattern({
    source: nextSource,
    pattern: /APP_RLS_STRICT_MODE/,
    message: 'Next pg session options must read APP_RLS_STRICT_MODE',
    filePath: nextSessionOptionsFile,
  });
  assertPattern({
    source: nextSource,
    pattern: /app\.rls_strict_mode=on/,
    message: 'Next pg session options must inject app.rls_strict_mode=on',
    filePath: nextSessionOptionsFile,
  });

  assertPattern({
    source: fastifySource,
    pattern: /APP_RLS_STRICT_MODE/,
    message: 'Fastify pg context must read APP_RLS_STRICT_MODE',
    filePath: fastifyPgContextFile,
  });
  assertPattern({
    source: fastifySource,
    pattern: /set_config\('app\.rls_strict_mode'/,
    message: 'Fastify pg context must set app.rls_strict_mode',
    filePath: fastifyPgContextFile,
  });
  assertPattern({
    source: fastifySource,
    pattern: /return parsed \? 'on' : 'off'/,
    message: 'Fastify pg context must normalize strict mode to on/off',
    filePath: fastifyPgContextFile,
  });

  console.log('rls-strict-consistency: ok');
}

main().catch(error => {
  console.error(
    error instanceof Error ? error.message : String(error ?? 'Unknown error')
  );
  process.exit(1);
});
