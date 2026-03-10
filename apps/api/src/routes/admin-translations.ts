import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

import type { ApiRuntimeConfig } from '../config';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';

interface AdminTranslationsRoutesOptions {
  config: ApiRuntimeConfig;
}

type TranslationData = {
  [key: string]: string | TranslationData;
};
type TranslationUpdateMode = 'merge' | 'replace';

const SUPPORTED_LOCALES = new Set([
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'es-ES',
  'pt-PT',
  'fr-FR',
  'de-DE',
  'ru-RU',
  'it-IT',
]);
const LOCK_TIMEOUT = 5000;
const fileLocks = new Map<string, { timestamp: number; processId: string }>();
const MESSAGES_DIR_CANDIDATES = [
  path.resolve(process.cwd(), 'messages'),
  path.resolve(process.cwd(), '..', 'messages'),
  path.resolve(process.cwd(), '..', '..', 'messages'),
];

function getSupportedLocales(): string[] {
  return Array.from(SUPPORTED_LOCALES);
}

function isValidLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.has(locale);
}

function resolveMessagesDirPath(): string {
  for (const directoryPath of MESSAGES_DIR_CANDIDATES) {
    if (existsSync(directoryPath)) {
      return directoryPath;
    }
  }
  return path.resolve(process.cwd(), 'messages');
}

async function acquireLock(filePath: string): Promise<void> {
  const lockKey = path.basename(filePath);
  const now = Date.now();
  const processId = `${process.pid}-${now}`;

  const existingLock = fileLocks.get(lockKey);
  if (existingLock) {
    if (now - existingLock.timestamp < LOCK_TIMEOUT) {
      throw new Error(`File ${lockKey} is locked by another process`);
    }
    fileLocks.delete(lockKey);
  }

  fileLocks.set(lockKey, { timestamp: now, processId });
}

function releaseLock(filePath: string): void {
  const lockKey = path.basename(filePath);
  fileLocks.delete(lockKey);
}

async function readTranslationFile(locale: string): Promise<TranslationData> {
  const filePath = path.join(resolveMessagesDirPath(), `${locale}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as TranslationData;
  } catch (error) {
    throw new Error(
      `Failed to read translation file for locale ${locale}: ${error}`
    );
  }
}

async function writeTranslationFile(
  locale: string,
  data: TranslationData
): Promise<void> {
  const filePath = path.join(resolveMessagesDirPath(), `${locale}.json`);
  const tempPath = `${filePath}.tmp`;

  try {
    await acquireLock(filePath);
    const fileContent = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, fileContent, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // best effort cleanup
    }
    throw new Error(
      `Failed to write translation file for locale ${locale}: ${error}`
    );
  } finally {
    releaseLock(filePath);
  }
}

function deepMerge(
  target: TranslationData,
  source: TranslationData
): TranslationData {
  const result: TranslationData = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as TranslationData,
        sourceValue as TranslationData
      );
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

function getNestedValue(
  obj: TranslationData,
  sectionPath: string
): TranslationData | string | undefined {
  return sectionPath.split('.').reduce(
    (current, key) => {
      if (current && typeof current === 'object') {
        return (current as TranslationData)[key];
      }
      return undefined;
    },
    obj as TranslationData | string | undefined
  );
}

function setNestedValue(
  obj: TranslationData,
  sectionPath: string,
  value: TranslationData | string
): void {
  const keys = sectionPath.split('.');
  const lastKey = keys.pop();
  if (!lastKey) {
    return;
  }

  let current: TranslationData = obj;
  for (const key of keys) {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as TranslationData;
  }

  current[lastKey] = value;
}

function isTranslationObject(
  value: TranslationData | string | undefined
): value is TranslationData {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function applyTranslationUpdate(
  currentTranslations: TranslationData,
  section: string,
  updates: TranslationData | string,
  mode: TranslationUpdateMode
): TranslationData {
  if (section) {
    const updatedTranslations: TranslationData = { ...currentTranslations };
    if (mode === 'replace') {
      setNestedValue(updatedTranslations, section, updates);
      return updatedTranslations;
    }

    const currentSection = getNestedValue(currentTranslations, section);
    if (isTranslationObject(currentSection) && isTranslationObject(updates)) {
      const mergedSection = deepMerge(currentSection, updates);
      setNestedValue(updatedTranslations, section, mergedSection);
      return updatedTranslations;
    }

    setNestedValue(updatedTranslations, section, updates);
    return updatedTranslations;
  }

  if (mode === 'replace') {
    return updates as TranslationData;
  }

  if (isTranslationObject(updates)) {
    return deepMerge(currentTranslations, updates);
  }

  return currentTranslations;
}

async function updateSingleLocaleTranslation(params: {
  locale: string;
  section: string;
  updates: TranslationData | string;
  mode: TranslationUpdateMode;
}): Promise<string> {
  const { locale, section, updates, mode } = params;
  const currentTranslations = await readTranslationFile(locale);
  const updatedTranslations = applyTranslationUpdate(
    currentTranslations,
    section,
    updates,
    mode
  );
  await writeTranslationFile(locale, updatedTranslations);
  return new Date().toISOString();
}

async function requireAdmin(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<
  | { ok: true }
  | { ok: false; statusCode: number; payload: Record<string, unknown> }
> {
  const resolved = await resolveIdentityFromSession(request, config);
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      statusCode: 401,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized access',
      }),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      statusCode: 500,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 500,
        source: 'auth',
        code: 'AUTH_PERMISSION_VERIFY_FAILED',
        userMessage: 'Failed to verify permissions',
      }),
    };
  }
  if (resolved.identity.role !== 'admin') {
    return {
      ok: false,
      statusCode: 403,
      payload: buildRouteErrorPayload({
        request,
        statusCode: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Insufficient permissions',
      }),
    };
  }
  return { ok: true };
}

export const adminTranslationsRoutes: FastifyPluginAsync<
  AdminTranslationsRoutesOptions
> = async (app, options) => {
  app.get<{
    Querystring: { locale?: string; section?: string };
  }>('/api/admin/translations', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const locale =
        typeof request.query.locale === 'string' ? request.query.locale : '';
      const section =
        typeof request.query.section === 'string' ? request.query.section : '';

      if (locale && !isValidLocale(locale)) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'TRANSLATION_LOCALE_UNSUPPORTED',
            userMessage: `Unsupported locale: ${locale}`,
          })
        );
      }

      if (locale) {
        const translations = await readTranslationFile(locale);

        if (section) {
          const sectionData = getNestedValue(translations, section);
          if (sectionData === undefined) {
            return reply.status(404).send(
              buildRouteErrorPayload({
                request,
                statusCode: 404,
                code: 'TRANSLATION_SECTION_NOT_FOUND',
                userMessage: `Section '${section}' not found in locale '${locale}'`,
              })
            );
          }
          return reply.send({ locale, section, data: sectionData });
        }

        return reply.send({ locale, data: translations });
      }

      const supportedLocales = getSupportedLocales();
      return reply.send({
        supportedLocales,
        availableLanguages: supportedLocales.length,
        lastModified: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-translations] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'TRANSLATION_READ_FAILED',
          userMessage: 'Failed to read translations',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown translations read error',
        })
      );
    }
  });

  app.put<{
    Body: {
      locale?: string;
      section?: string;
      updates?: TranslationData | string;
      mode?: 'merge' | 'replace';
    };
  }>('/api/admin/translations', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const locale =
        typeof request.body?.locale === 'string' ? request.body.locale : '';
      const section =
        typeof request.body?.section === 'string' ? request.body.section : '';
      const updates = request.body?.updates;
      const mode = request.body?.mode === 'replace' ? 'replace' : 'merge';

      if (!locale || updates === undefined) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'TRANSLATION_UPDATE_PARAMS_MISSING',
            userMessage: 'Missing required parameters: locale, updates',
          })
        );
      }

      if (!isValidLocale(locale)) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'TRANSLATION_LOCALE_UNSUPPORTED',
            userMessage: `Unsupported locale: ${locale}`,
          })
        );
      }

      const updatedAt = await updateSingleLocaleTranslation({
        locale,
        section,
        updates: updates as TranslationData | string,
        mode,
      });

      return reply.send({
        success: true,
        locale,
        section: section || null,
        mode,
        updatedAt,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-translations] PUT failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'TRANSLATION_UPDATE_FAILED',
          userMessage: 'Failed to update translations',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown translations update error',
        })
      );
    }
  });

  app.post<{
    Body: {
      section?: string;
      updates?: Record<string, TranslationData | string>;
      mode?: TranslationUpdateMode;
    };
  }>('/api/admin/translations', async (request, reply) => {
    try {
      const authResult = await requireAdmin(request, options.config);
      if (!authResult.ok) {
        return reply.status(authResult.statusCode).send(authResult.payload);
      }

      const section =
        typeof request.body?.section === 'string' ? request.body.section : '';
      const mode = request.body?.mode === 'replace' ? 'replace' : 'merge';
      const updates = request.body?.updates;

      if (
        !section ||
        !updates ||
        typeof updates !== 'object' ||
        Array.isArray(updates)
      ) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'TRANSLATION_BATCH_PARAMS_MISSING',
            userMessage:
              'Missing required parameters: section, updates (locale map)',
          })
        );
      }

      const results: Array<{
        locale: string;
        success: boolean;
        updatedAt: string;
      }> = [];
      const errors: Array<{ locale: string; error: string }> = [];

      for (const [locale, localeUpdates] of Object.entries(updates)) {
        if (!isValidLocale(locale)) {
          errors.push({
            locale,
            error: `Unsupported locale: ${locale}`,
          });
          continue;
        }

        if (localeUpdates === undefined) {
          errors.push({
            locale,
            error: `Missing updates for locale: ${locale}`,
          });
          continue;
        }

        try {
          const updatedAt = await updateSingleLocaleTranslation({
            locale,
            section,
            updates: localeUpdates,
            mode,
          });
          results.push({ locale, success: true, updatedAt });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown translations update error';
          errors.push({ locale, error: message });
          request.log.error(
            { err: error, locale },
            '[FastifyAPI][admin-translations] POST locale update failed'
          );
        }
      }

      return reply.send({
        success: errors.length === 0,
        section,
        mode,
        results,
        errors,
        totalProcessed: results.length + errors.length,
        totalErrors: errors.length,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][admin-translations] POST failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'TRANSLATION_BATCH_UPDATE_FAILED',
          userMessage: 'Failed to batch update translations',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown translations update error',
        })
      );
    }
  });
};
