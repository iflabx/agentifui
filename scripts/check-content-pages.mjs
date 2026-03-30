#!/usr/bin/env node
import path from 'node:path';

import {
  PAGE_NAMES,
  SOURCE_LOCALE,
  parseSupportedLocales,
  readJsonFile,
  resolveContentPagesDir,
  validateContentFiles,
} from './lib/page-content-utils.mjs';

const rootDir = process.cwd();
const contentPagesDir = resolveContentPagesDir(rootDir);

function readRequiredJson(filePath) {
  try {
    return readJsonFile(filePath);
  } catch (error) {
    throw new Error(
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function printErrors(pageName, locale, errors) {
  console.error(`${pageName}/${locale}:`);
  errors.forEach(error => {
    console.error(`  - ${error}`);
  });
}

function main() {
  const supportedLocales = parseSupportedLocales(rootDir);
  let hasFailures = false;

  for (const pageName of PAGE_NAMES) {
    const structurePath = path.resolve(contentPagesDir, pageName, 'structure.json');
    const structureFile = readRequiredJson(structurePath);

    if (structureFile.page !== pageName) {
      hasFailures = true;
      printErrors(pageName, 'structure', [
        `page mismatch: expected ${pageName}, found ${structureFile.page}`,
      ]);
      continue;
    }

    if (structureFile.sourceLocale !== SOURCE_LOCALE) {
      hasFailures = true;
      printErrors(pageName, 'structure', [
        `sourceLocale mismatch: expected ${SOURCE_LOCALE}, found ${structureFile.sourceLocale}`,
      ]);
    }

    for (const locale of supportedLocales) {
      const localePath = path.resolve(
        contentPagesDir,
        pageName,
        'locales',
        `${locale}.json`
      );
      const localeLayer = readRequiredJson(localePath);
      const errors = [];

      if (localeLayer.page !== pageName) {
        errors.push(`page mismatch: expected ${pageName}, found ${localeLayer.page}`);
      }

      if (localeLayer.locale !== locale) {
        errors.push(`locale mismatch: expected ${locale}, found ${localeLayer.locale}`);
      }

      errors.push(...validateContentFiles({ structureFile, localeLayer }));

      if (errors.length > 0) {
        hasFailures = true;
        printErrors(pageName, locale, errors);
      }
    }
  }

  if (hasFailures) {
    process.exit(1);
  }

  console.log(
    `content:check ok (${PAGE_NAMES.length} pages, ${parseSupportedLocales(rootDir).length} locales)`
  );
}

try {
  main();
} catch (error) {
  console.error(
    `content:check failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
