import type { FastifyPluginAsync } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { buildRouteErrorPayload } from '../lib/route-error';

const DEFAULT_SECTIONS = ['pages.about', 'pages.home'];
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

interface FileCacheEntry {
  data: Record<string, unknown>;
  mtime: number;
}

const fileCache = new Map<string, FileCacheEntry>();
const messageRootCandidates = [
  path.resolve(process.cwd(), 'messages'),
  path.resolve(process.cwd(), '..', '..', 'messages'),
];

function isValidLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.has(locale);
}

function parseSections(rawValue: string | undefined): string[] {
  if (!rawValue || rawValue.trim().length === 0) {
    return DEFAULT_SECTIONS;
  }
  const sections = rawValue
    .split(',')
    .map(section => section.trim())
    .filter(Boolean);
  return sections.length > 0 ? sections : DEFAULT_SECTIONS;
}

function getSectionData(
  data: Record<string, unknown>,
  section: string
): unknown {
  return section.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, data as unknown);
}

function setNestedValue(
  target: Record<string, unknown>,
  sectionPath: string,
  value: unknown
): void {
  const keys = sectionPath.split('.');
  const lastKey = keys.pop();
  if (!lastKey) {
    return;
  }

  const nestedTarget = keys.reduce((current: Record<string, unknown>, key) => {
    const existing = current[key];
    if (!existing || typeof existing !== 'object') {
      current[key] = {};
    }
    return current[key] as Record<string, unknown>;
  }, target);

  nestedTarget[lastKey] = value;
}

async function resolveMessageFile(locale: string): Promise<{
  filePath: string;
  mtimeMs: number;
}> {
  for (const rootPath of messageRootCandidates) {
    const filePath = path.join(rootPath, `${locale}.json`);
    try {
      const stats = await fs.stat(filePath);
      return { filePath, mtimeMs: stats.mtimeMs };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const notFoundError = new Error(
    `Translation file not found for locale ${locale}`
  );
  (notFoundError as NodeJS.ErrnoException).code = 'ENOENT';
  throw notFoundError;
}

export const translationsRoutes: FastifyPluginAsync = async app => {
  app.get<{
    Params: { locale: string };
    Querystring: { sections?: string };
  }>('/api/translations/:locale', async (request, reply) => {
    const locale = (request.params.locale || '').trim();
    if (!isValidLocale(locale)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'TRANSLATION_LOCALE_INVALID',
          userMessage: 'Invalid locale',
        })
      );
    }

    const sections = parseSections(request.query.sections);

    try {
      const { filePath, mtimeMs } = await resolveMessageFile(locale);
      const cacheKey = `${filePath}:${mtimeMs}`;

      let fileContent = fileCache.get(cacheKey);
      if (!fileContent || fileContent.mtime !== mtimeMs) {
        const content = await fs.readFile(filePath, 'utf-8');
        fileContent = {
          data: JSON.parse(content) as Record<string, unknown>,
          mtime: mtimeMs,
        };
        fileCache.set(cacheKey, fileContent);

        if (fileCache.size > 20) {
          const oldestKey = fileCache.keys().next().value;
          if (oldestKey) {
            fileCache.delete(oldestKey);
          }
        }
      }

      const result: Record<string, unknown> = {};
      for (const section of sections) {
        const sectionData = getSectionData(fileContent.data, section);
        if (sectionData !== undefined) {
          setNestedValue(result, section, sectionData);
        }
      }

      reply.header('Cache-Control', 'public, max-age=60, s-maxage=300');
      reply.header('ETag', `"${locale}-${sections.join(',')}-${mtimeMs}"`);
      return reply.send(result);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;

      if (code === 'ENOENT') {
        return reply.status(404).send(
          buildRouteErrorPayload({
            request,
            statusCode: 404,
            code: 'TRANSLATION_FILE_NOT_FOUND',
            userMessage: 'Translation file not found',
          })
        );
      }

      request.log.error(
        { err: error, locale },
        '[FastifyAPI][translations] failed to resolve translation file'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'TRANSLATION_RESOLVE_FAILED',
          userMessage: 'Failed to resolve translation file',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown translation resolve error',
        })
      );
    }
  });
};
