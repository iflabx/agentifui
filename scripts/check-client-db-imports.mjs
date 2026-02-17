#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['app', 'components', 'lib'];
const CLIENT_RUNTIME_PREFIXES = ['components/', 'lib/hooks/', 'lib/stores/'];
const ALLOWED_RUNTIME_IMPORTS = new Set(['@lib/db/internal-data-api']);
const FORBIDDEN_RUNTIME_EXACT_IMPORTS = new Set([
  '@lib/services/db/data-service',
  '@lib/services/db/message-service',
]);
const IMPORT_STATEMENT_RE = /import[\s\S]*?\sfrom\s+['"][^'"]+['"]/g;
const IMPORT_PATH_RE = /from\s+['"]([^'"]+)['"]/;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function isTsFile(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function countNewlines(input) {
  return (input.match(/\n/g) || []).length;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
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

function shouldCheckFile(relativePath, source) {
  if (isClientModule(source)) {
    return true;
  }

  const normalizedPath = toPosixPath(relativePath);
  return CLIENT_RUNTIME_PREFIXES.some(prefix =>
    normalizedPath.startsWith(prefix)
  );
}

function isForbiddenRuntimeImport(importPath) {
  if (ALLOWED_RUNTIME_IMPORTS.has(importPath)) {
    return false;
  }

  if (FORBIDDEN_RUNTIME_EXACT_IMPORTS.has(importPath)) {
    return true;
  }

  if (importPath.startsWith('@lib/db/')) {
    return true;
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
    const relativePath = path.relative(ROOT, filePath);
    if (!shouldCheckFile(relativePath, source)) {
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
      if (!isForbiddenRuntimeImport(importPath)) {
        continue;
      }

      const offset = match.index;
      const line = countNewlines(source.slice(0, offset)) + 1;
      violations.push({
        file: relativePath,
        line,
        importPath,
      });
    }

    DYNAMIC_IMPORT_RE.lastIndex = 0;
    while ((match = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
      const importPath = match[1];
      if (!isForbiddenRuntimeImport(importPath)) {
        continue;
      }

      const offset = match.index;
      const line = countNewlines(source.slice(0, offset)) + 1;
      violations.push({
        file: relativePath,
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
