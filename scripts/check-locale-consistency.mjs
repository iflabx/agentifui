#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const messagesDir = resolve(rootDir, 'messages');
const languageConfigFile = resolve(rootDir, 'lib/config/language-config.ts');
const DEFAULT_BASELINE_LOCALE = 'en-US';
const MAX_ITEMS_PER_SECTION = 100;

function parseArgs(argv) {
  let baselineLocale = DEFAULT_BASELINE_LOCALE;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--baseline') {
      baselineLocale = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--baseline=')) {
      baselineLocale = arg.slice('--baseline='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!baselineLocale) {
    throw new Error('Missing value for --baseline');
  }

  return { baselineLocale };
}

function loadSupportedLocales() {
  const source = readFileSync(languageConfigFile, 'utf8');
  const match = source.match(
    /export\s+const\s+SUPPORTED_LANGUAGES\s*=\s*{([\s\S]*?)}\s*as\s+const;/
  );

  if (!match) {
    throw new Error(`Cannot find SUPPORTED_LANGUAGES in ${languageConfigFile}`);
  }

  const localeMatches = match[1].matchAll(
    /^\s*['"]([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)['"]\s*:\s*{/gm
  );

  const locales = [...localeMatches].map(matchItem => matchItem[1]);
  if (locales.length === 0) {
    throw new Error(`No supported locales found in ${languageConfigFile}`);
  }

  return locales;
}

function classifyValue(value) {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function joinObjectPath(parentPath, childKey) {
  return parentPath ? `${parentPath}.${childKey}` : childKey;
}

function joinArrayPath(parentPath, index) {
  return `${parentPath}[${index}]`;
}

function collectLeafPaths(value, currentPath) {
  const valueType = classifyValue(value);

  if (valueType === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return [currentPath];
    }

    return keys.flatMap(key =>
      collectLeafPaths(value[key], joinObjectPath(currentPath, key))
    );
  }

  if (valueType === 'array') {
    if (value.length === 0) {
      return [currentPath];
    }

    return value.flatMap((item, index) =>
      collectLeafPaths(item, joinArrayPath(currentPath, index))
    );
  }

  return [currentPath];
}

function compareNodes(baseValue, localeValue, currentPath, findings) {
  const baseType = classifyValue(baseValue);
  const localeType = classifyValue(localeValue);

  if (baseType !== localeType) {
    findings.typeMismatches.push({
      path: currentPath || '<root>',
      expected: baseType,
      actual: localeType,
    });
    return;
  }

  if (baseType === 'object') {
    const baseKeys = new Set(Object.keys(baseValue));
    const localeKeys = new Set(Object.keys(localeValue));

    for (const key of baseKeys) {
      if (!localeKeys.has(key)) {
        findings.missingKeys.push(
          ...collectLeafPaths(baseValue[key], joinObjectPath(currentPath, key))
        );
      }
    }

    for (const key of localeKeys) {
      if (!baseKeys.has(key)) {
        findings.extraKeys.push(
          ...collectLeafPaths(
            localeValue[key],
            joinObjectPath(currentPath, key)
          )
        );
      }
    }

    for (const key of baseKeys) {
      if (localeKeys.has(key)) {
        compareNodes(
          baseValue[key],
          localeValue[key],
          joinObjectPath(currentPath, key),
          findings
        );
      }
    }

    return;
  }

  if (baseType === 'array') {
    const sharedLength = Math.min(baseValue.length, localeValue.length);

    for (let index = 0; index < sharedLength; index += 1) {
      compareNodes(
        baseValue[index],
        localeValue[index],
        joinArrayPath(currentPath, index),
        findings
      );
    }

    if (baseValue.length > localeValue.length) {
      for (let index = sharedLength; index < baseValue.length; index += 1) {
        findings.missingKeys.push(
          ...collectLeafPaths(
            baseValue[index],
            joinArrayPath(currentPath, index)
          )
        );
      }
    }

    if (localeValue.length > baseValue.length) {
      for (let index = sharedLength; index < localeValue.length; index += 1) {
        findings.extraKeys.push(
          ...collectLeafPaths(
            localeValue[index],
            joinArrayPath(currentPath, index)
          )
        );
      }
    }
  }
}

function printSection(title, items, formatter = item => item) {
  console.error(`  ${title} (${items.length})`);

  for (const item of items.slice(0, MAX_ITEMS_PER_SECTION)) {
    console.error(`    - ${formatter(item)}`);
  }

  if (items.length > MAX_ITEMS_PER_SECTION) {
    console.error(
      `    - ... ${items.length - MAX_ITEMS_PER_SECTION} more omitted`
    );
  }
}

function loadLocaleFile(locale) {
  const filePath = resolve(messagesDir, `${locale}.json`);

  try {
    const source = readFileSync(filePath, 'utf8');
    return {
      exists: true,
      filePath,
      data: JSON.parse(source),
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        filePath,
      };
    }

    return {
      exists: true,
      filePath,
      parseError: error.message,
    };
  }
}

function main() {
  const { baselineLocale } = parseArgs(process.argv.slice(2));
  const supportedLocales = loadSupportedLocales();

  if (!supportedLocales.includes(baselineLocale)) {
    throw new Error(
      `Baseline locale ${baselineLocale} is not declared in ${languageConfigFile}`
    );
  }

  const undeclaredLocaleFiles = readdirSync(messagesDir)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .filter(locale => !supportedLocales.includes(locale))
    .sort();

  const localeFiles = new Map(
    supportedLocales.map(locale => [locale, loadLocaleFile(locale)])
  );

  const missingFiles = supportedLocales.filter(
    locale => !localeFiles.get(locale).exists
  );
  const invalidJsonFiles = supportedLocales
    .map(locale => ({
      locale,
      file: localeFiles.get(locale),
    }))
    .filter(item => item.file.parseError);

  let hasFailures = false;

  if (missingFiles.length > 0) {
    hasFailures = true;
    console.error('i18n:check failed');
    console.error('');
    printSection('missing locale files', missingFiles, locale =>
      resolve(messagesDir, `${locale}.json`)
    );
  }

  if (invalidJsonFiles.length > 0) {
    if (!hasFailures) {
      console.error('i18n:check failed');
      console.error('');
    }
    hasFailures = true;
    printSection('invalid locale files', invalidJsonFiles, item => {
      return `${item.file.filePath}: ${item.file.parseError}`;
    });
  }

  const baselineFile = localeFiles.get(baselineLocale);
  if (!baselineFile.exists || baselineFile.parseError) {
    process.exit(1);
  }

  const localeFindings = [];

  for (const locale of supportedLocales) {
    if (locale === baselineLocale) {
      continue;
    }

    const localeFile = localeFiles.get(locale);
    if (!localeFile.exists || localeFile.parseError) {
      continue;
    }

    const findings = {
      locale,
      missingKeys: [],
      extraKeys: [],
      typeMismatches: [],
    };

    compareNodes(baselineFile.data, localeFile.data, '', findings);

    findings.missingKeys.sort();
    findings.extraKeys.sort();
    findings.typeMismatches.sort((left, right) =>
      left.path.localeCompare(right.path)
    );

    if (
      findings.missingKeys.length > 0 ||
      findings.extraKeys.length > 0 ||
      findings.typeMismatches.length > 0
    ) {
      localeFindings.push(findings);
    }
  }

  if (localeFindings.length > 0) {
    if (!hasFailures) {
      console.error('i18n:check failed');
      console.error('');
    }
    hasFailures = true;

    for (const finding of localeFindings) {
      console.error(`${finding.locale}:`);

      if (finding.missingKeys.length > 0) {
        printSection('missing keys', finding.missingKeys);
      }

      if (finding.extraKeys.length > 0) {
        printSection('extra keys', finding.extraKeys);
      }

      if (finding.typeMismatches.length > 0) {
        printSection('type mismatches', finding.typeMismatches, item => {
          return `${item.path} (expected ${item.expected}, found ${item.actual})`;
        });
      }

      console.error('');
    }
  }

  if (undeclaredLocaleFiles.length > 0) {
    console.warn('i18n:check warning');
    console.warn('');
    printSection('undeclared locale files', undeclaredLocaleFiles, locale => {
      return resolve(messagesDir, `${locale}.json`);
    });
    console.warn('');
  }

  if (hasFailures) {
    process.exit(1);
  }

  console.log(
    `i18n:check ok (${supportedLocales.length} locales, baseline ${baselineLocale})`
  );
}

try {
  main();
} catch (error) {
  console.error(`i18n:check failed: ${error.message}`);
  process.exit(1);
}
