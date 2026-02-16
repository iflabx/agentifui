#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['app', 'components', 'lib'];
const ALLOWED_RUNTIME_IMPORT = '@lib/db/internal-data-api';
const IMPORT_STATEMENT_RE = /import[\s\S]*?\sfrom\s+['"][^'"]+['"]/g;
const IMPORT_PATH_RE = /from\s+['"](@lib\/db\/[^'"]+)['"]/;

function isTsFile(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function countNewlines(input) {
  return (input.match(/\n/g) || []).length;
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

function isClientModule(source) {
  const normalized = source.replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line === "'use client';" || line === '"use client";') {
      return true;
    }
    return false;
  }
  return false;
}

async function main() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    const fullDir = path.join(ROOT, dir);
    try {
      const stat = await fs.stat(fullDir);
      if (!stat.isDirectory()) continue;
      await walk(fullDir, files);
    } catch {
      // ignore missing folders
    }
  }

  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    if (!isClientModule(source)) {
      continue;
    }

    IMPORT_STATEMENT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_STATEMENT_RE.exec(source)) !== null) {
      const statement = match[0];
      const pathMatch = IMPORT_PATH_RE.exec(statement);
      if (!pathMatch) {
        continue;
      }

      const importPath = pathMatch[1];
      const isTypeImport = /^\s*import\s+type\b/.test(statement);
      if (isTypeImport) {
        continue;
      }
      if (importPath === ALLOWED_RUNTIME_IMPORT) {
        continue;
      }

      const offset = match.index;
      const line = countNewlines(source.slice(0, offset)) + 1;
      violations.push({
        file: path.relative(ROOT, filePath),
        line,
        importPath,
      });
    }
  }

  if (violations.length === 0) {
    console.log('client-db-imports: ok');
    return;
  }

  console.error('client-db-imports: found forbidden runtime imports:');
  for (const v of violations) {
    console.error(`- ${v.file}:${v.line} -> ${v.importPath}`);
  }
  process.exit(1);
}

main().catch(error => {
  console.error('client-db-imports: unexpected error', error);
  process.exit(1);
});
