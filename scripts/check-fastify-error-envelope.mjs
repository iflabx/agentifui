#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, 'apps', 'api', 'src', 'routes');
const LEGACY_ERROR_SEND_RE = /\.send\s*\(\s*\{\s*error\b/g;
const LEGACY_SUCCESS_FALSE_RE =
  /\.send\s*\(\s*\{\s*success\s*:\s*false\s*,\s*error\b/g;

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
      await walk(fullPath, results);
      continue;
    }
    if (entry.isFile() && isTsFile(fullPath) && !fullPath.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
}

function collectLines(source, pattern) {
  pattern.lastIndex = 0;
  const lines = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    lines.push(countNewlines(source.slice(0, match.index)) + 1);
  }
  return lines;
}

async function main() {
  const files = [];
  try {
    await walk(ROUTES_DIR, files);
  } catch {
    console.log('fastify-error-envelope: routes not found, skip');
    return;
  }

  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    const sendErrorLines = collectLines(source, LEGACY_ERROR_SEND_RE);
    const successFalseLines = collectLines(source, LEGACY_SUCCESS_FALSE_RE);
    const lines = [...sendErrorLines, ...successFalseLines];
    if (lines.length === 0) {
      continue;
    }

    violations.push({
      file: toPosixPath(path.relative(ROOT, filePath)),
      lines: Array.from(new Set(lines)).sort((a, b) => a - b),
    });
  }

  if (violations.length === 0) {
    console.log('fastify-error-envelope: ok');
    return;
  }

  console.error(
    'fastify-error-envelope: legacy error payload write detected (use buildRouteErrorPayload / buildApiErrorEnvelope):'
  );
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.lines.join(',')}`);
  }
  process.exit(1);
}

main().catch(error => {
  console.error('fastify-error-envelope: unexpected error', error);
  process.exit(1);
});
