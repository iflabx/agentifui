#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PAGE_NAMES,
  SOURCE_LOCALE,
  parseSupportedLocales,
  readJsonFile,
  validateContentFiles,
} from './lib/page-content-utils.mjs';

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const mode = process.argv[2] || '--build';
const configured = process.env.AGENTIF_RUNTIME_DIR;
const contains = (parent, child) =>
  child === parent ||
  child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
const isObject = value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function mergeMessages(defaults, existing, location) {
  if (isObject(defaults)) {
    if (!isObject(existing))
      throw new Error(`Translation type conflict: ${location}`);
    const merged = { ...existing };
    for (const [key, value] of Object.entries(defaults)) {
      merged[key] = Object.hasOwn(existing, key)
        ? mergeMessages(value, existing[key], `${location}.${key}`)
        : value;
    }
    return merged;
  }
  if (
    typeof defaults !== typeof existing ||
    Array.isArray(defaults) !== Array.isArray(existing) ||
    (defaults === null) !== (existing === null)
  ) {
    throw new Error(`Translation type conflict: ${location}`);
  }
  return existing;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function assertDirectory(directory) {
  if (!fs.statSync(directory).isDirectory())
    throw new Error('Runtime content path must be a directory');
  fs.accessSync(
    directory,
    fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK
  );
}

function initialize(runtime, allowExisting = false) {
  if (fs.existsSync(runtime) && fs.readdirSync(runtime).length) {
    if (allowExisting) return;
    throw new Error(
      'Refusing to initialize nonempty runtime content; use upgrade preparation instead'
    );
  }
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  const temporary = fs.mkdtempSync(`${runtime}.init-`);
  try {
    fs.cpSync(
      path.join(root, 'content/pages'),
      path.join(temporary, 'content/pages'),
      { recursive: true }
    );
    fs.cpSync(path.join(root, 'messages'), path.join(temporary, 'messages'), {
      recursive: true,
    });
    try {
      if (fs.existsSync(runtime)) {
        if (allowExisting && fs.readdirSync(runtime).length) return;
        fs.rmdirSync(runtime);
      }
      fs.renameSync(temporary, runtime);
    } catch (error) {
      if (
        !allowExisting ||
        !['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code) ||
        !fs.existsSync(runtime)
      )
        throw error;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function validate(runtime) {
  const messages = new Map();
  const locales = parseSupportedLocales(root);
  assertDirectory(runtime);
  for (const directory of ['messages', 'content/pages']) {
    const resolved = fs.realpathSync(path.join(runtime, directory));
    if (!contains(fs.realpathSync(runtime), resolved))
      throw new Error(
        'Runtime content must not link back into source or another environment'
      );
    assertDirectory(resolved);
  }
  for (const locale of locales) {
    const defaults = readJsonFile(
      path.join(root, 'messages', `${locale}.json`)
    );
    const file = path.join(runtime, 'messages', `${locale}.json`);
    if (!contains(fs.realpathSync(runtime), fs.realpathSync(file)))
      throw new Error('Runtime translation file escapes runtime directory');
    const existing = readJsonFile(file);
    messages.set(locale, mergeMessages(defaults, existing, locale));
  }
  for (const page of PAGE_NAMES) {
    const structureFile = path.join(
      runtime,
      'content/pages',
      page,
      'structure.json'
    );
    if (!contains(fs.realpathSync(runtime), fs.realpathSync(structureFile)))
      throw new Error('Runtime page escapes runtime directory');
    const structure = readJsonFile(structureFile);
    if (structure.page !== page || structure.sourceLocale !== SOURCE_LOCALE)
      throw new Error(`Invalid runtime page structure: ${page}`);
    for (const locale of locales) {
      const localeFile = path.join(
        runtime,
        'content/pages',
        page,
        'locales',
        `${locale}.json`
      );
      if (!contains(fs.realpathSync(runtime), fs.realpathSync(localeFile)))
        throw new Error('Runtime page locale escapes runtime directory');
      const layer = readJsonFile(localeFile);
      const errors = validateContentFiles({
        structureFile: structure,
        localeLayer: layer,
      });
      if (layer.page !== page || layer.locale !== locale)
        errors.push('page or locale mismatch');
      if (errors.length)
        throw new Error(
          `Invalid runtime content ${page}/${locale}: ${errors.join('; ')}`
        );
    }
  }
  return messages;
}

try {
  if (!['--build', '--init', '--deploy', '--check'].includes(mode))
    throw new Error('Unknown runtime preparation mode');
  if (
    configured !== undefined &&
    (!configured.trim() || !path.isAbsolute(configured))
  )
    throw new Error('AGENTIF_RUNTIME_DIR must be an absolute path');
  if ((mode === '--deploy' || mode === '--init') && !configured)
    throw new Error(
      'Deployment requires an explicit, stable AGENTIF_RUNTIME_DIR outside the release directory'
    );
  const runtime = path.resolve(configured || path.join(root, 'output/runtime'));
  if (configured && (contains(root, runtime) || contains(runtime, root)))
    throw new Error(
      'Configured runtime directory must be outside the source/release directory'
    );
  let ancestor = runtime;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (
    configured &&
    (contains(
      root,
      path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, runtime))
    ) ||
      contains(
        path.resolve(
          fs.realpathSync(ancestor),
          path.relative(ancestor, runtime)
        ),
        root
      ))
  )
    throw new Error(
      'Runtime directory resolves inside the source/release directory'
    );
  const initializeRequested =
    mode === '--init' ||
    (mode === '--deploy' && process.env.AGENTIF_RUNTIME_INIT === '1');
  if (initializeRequested || (!configured && !fs.existsSync(runtime)))
    initialize(runtime, !configured && !initializeRequested);
  const messages = validate(runtime);
  if (mode === '--deploy') {
    const snapshots = path.join(path.dirname(runtime), 'runtime-snapshots');
    fs.mkdirSync(snapshots, { recursive: true, mode: 0o700 });
    const snapshot = fs.mkdtempSync(
      path.join(snapshots, `${path.basename(runtime)}-${Date.now()}-`)
    );
    fs.cpSync(runtime, snapshot, { recursive: true });
    console.log(`[runtime-content] pre-upgrade snapshot: ${snapshot}`);
    for (const [locale, merged] of messages)
      atomicJson(path.join(runtime, 'messages', `${locale}.json`), merged);
  }
  if (mode !== '--check') {
    for (const [locale, merged] of messages)
      atomicJson(
        path.join(root, 'output/build-messages', `${locale}.json`),
        merged
      );
  }
  console.log(
    `[runtime-content] ${mode.slice(2)} ready; translations take effect after rebuild`
  );
} catch (error) {
  console.error(`[runtime-content] preparation failed: ${error.message}`);
  process.exitCode = 1;
}
