#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'app', 'api');
const GET_PG_POOL_CALL_RE = /\bgetPgPool\s*\(/g;

function isTsFile(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function countNewlines(source) {
  return (source.match(/\n/g) || []).length;
}

async function walk(dir, results) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') {
        continue;
      }
      await walk(fullPath, results);
      continue;
    }
    if (entry.isFile() && isTsFile(fullPath)) {
      results.push(fullPath);
    }
  }
}

async function main() {
  const files = [];
  try {
    await walk(API_DIR, files);
  } catch {
    console.log('no-raw-pg-in-api: app/api not found, skip');
    return;
  }

  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const relativePath = toPosixPath(path.relative(ROOT, filePath));
    const matches = [];
    GET_PG_POOL_CALL_RE.lastIndex = 0;

    let match;
    while ((match = GET_PG_POOL_CALL_RE.exec(source)) !== null) {
      const line = countNewlines(source.slice(0, match.index)) + 1;
      matches.push(line);
    }

    if (matches.length === 0) {
      continue;
    }

    violations.push({
      file: relativePath,
      reason:
        'raw getPgPool() call in app/api is not allowed; use @lib/server/pg/user-context helpers',
      lines: matches,
    });
  }

  if (violations.length === 0) {
    console.log('no-raw-pg-in-api: ok');
    return;
  }

  console.error('no-raw-pg-in-api: violations found:');
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.lines.join(',')} -> ${violation.reason}`
    );
  }
  process.exit(1);
}

main().catch(error => {
  console.error('no-raw-pg-in-api: unexpected error', error);
  process.exit(1);
});
