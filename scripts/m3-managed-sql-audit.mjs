#!/usr/bin/env node

import { execSync } from 'node:child_process';

const managedTables = [
  'profiles',
  'conversations',
  'messages',
  'providers',
  'service_instances',
];

const allowedFallbackFiles = new Set([
  'lib/db/users.ts',
  'lib/db/conversations.ts',
  'lib/db/service-instances.ts',
  'lib/services/db/message-service.ts',
]);

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    const status = error?.status;
    if (status === 1) {
      return '';
    }
    throw error;
  }
}

const tablePattern = managedTables.join('|');
const sqlHits = run(
  `rg -n "\\b(${tablePattern})\\b" lib/db lib/services/db | rg "rawQuery|rawExecute|client\\.query|SELECT|UPDATE|DELETE|INSERT"`
);

const lines = sqlHits ? sqlHits.split('\n').filter(Boolean) : [];
const byFile = new Map();
for (const line of lines) {
  const file = line.split(':')[0];
  const count = byFile.get(file) || 0;
  byFile.set(file, count + 1);
}

const files = Array.from(byFile.keys()).sort();
const unexpected = files.filter(file => !allowedFallbackFiles.has(file));

if (unexpected.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'Unexpected managed-table SQL fallback files detected',
        unexpected,
        expected: Array.from(allowedFallbackFiles).sort(),
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      managedTables,
      fallbackFiles: files.map(file => ({
        file,
        hitCount: byFile.get(file),
      })),
    },
    null,
    2
  )
);
