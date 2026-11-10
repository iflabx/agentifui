#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'app', 'api');

const BLOCK_PATTERNS = [
  {
    name: 'legacy_error_object',
    regex: /NextResponse\.json\(\s*\{\s*error\s*:/gms,
    reason:
      'Use nextApiErrorResponse(...) instead of NextResponse.json({ error: ... })',
  },
  {
    name: 'legacy_success_false_error',
    regex:
      /NextResponse\.json\(\s*\{\s*success\s*:\s*false\b[\s\S]{0,220}?\berror\s*:/gms,
    reason:
      'Use nextApiErrorResponse(...) instead of legacy { success: false, error: ... } payload',
  },
];

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
    if (!entry.isFile() || !isTsFile(fullPath)) {
      continue;
    }
    if (fullPath.endsWith('.test.ts') || fullPath.endsWith('.test.tsx')) {
      continue;
    }
    results.push(fullPath);
  }
}

async function main() {
  const files = [];
  try {
    await walk(API_DIR, files);
  } catch {
    console.log('next-error-envelope: app/api not found, skip');
    return;
  }

  const violations = [];
  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const relativePath = toPosixPath(path.relative(ROOT, filePath));

    for (const pattern of BLOCK_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(source)) !== null) {
        const line = countNewlines(source.slice(0, match.index)) + 1;
        violations.push({
          file: relativePath,
          line,
          reason: pattern.reason,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log('next-error-envelope: ok');
    return;
  }

  console.error('next-error-envelope: violations found:');
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} -> ${violation.reason}`
    );
  }
  process.exit(1);
}

main().catch(error => {
  console.error('next-error-envelope: unexpected error', error);
  process.exit(1);
});
