#!/usr/bin/env node
import path from 'node:path';

import {
  PAGE_NAMES,
  SOURCE_LOCALE,
  createLocaleLayer,
  createStructureFile,
  parseSupportedLocales,
  readLocaleMessages,
  resolveContentPagesDir,
  writeJsonFile,
} from '../scripts/lib/page-content-utils.mjs';

const rootDir = process.cwd();
const outputDir = resolveContentPagesDir(rootDir);

function main() {
  const supportedLocales = parseSupportedLocales(rootDir);
  const sourceMessages = readLocaleMessages(rootDir, SOURCE_LOCALE);
  const migrationReport = {
    generatedAt: new Date().toISOString(),
    sourceLocale: SOURCE_LOCALE,
    pages: {},
  };

  for (const pageName of PAGE_NAMES) {
    const sourcePageData = sourceMessages?.pages?.[pageName];
    if (!sourcePageData?.sections?.length) {
      throw new Error(
        `Cannot migrate pages.${pageName}: source locale ${SOURCE_LOCALE} has no dynamic sections`
      );
    }

    const structureFile = createStructureFile({
      pageName,
      pageData: sourcePageData,
    });

    writeJsonFile(
      path.resolve(outputDir, pageName, 'structure.json'),
      structureFile
    );

    migrationReport.pages[pageName] = {
      structureSections: structureFile.sections.length,
      locales: {},
    };

    for (const locale of supportedLocales) {
      const localeMessages = readLocaleMessages(rootDir, locale);
      const report = {
        byId: 0,
        byPosition: 0,
        byTypeFallback: 0,
        missing: 0,
      };

      const localeLayer = createLocaleLayer({
        locale,
        pageName,
        sourcePageData: localeMessages?.pages?.[pageName],
        baselinePageData: sourcePageData,
        structureFile,
        report,
      });

      writeJsonFile(
        path.resolve(outputDir, pageName, 'locales', `${locale}.json`),
        localeLayer
      );

      migrationReport.pages[pageName].locales[locale] = report;
    }
  }

  writeJsonFile(path.resolve(outputDir, 'migration-report.json'), migrationReport);
  console.log(
    `content migration ok (${PAGE_NAMES.join(', ')}, ${supportedLocales.length} locales)`
  );
}

try {
  main();
} catch (error) {
  console.error(
    `content migration failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
