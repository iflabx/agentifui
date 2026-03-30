import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { buildTranslatedLocaleMap } from './admin-translations-auto-translate';
import {
  ContentPageStructureConflictError,
  getAllMergedPageTranslations,
  getMergedPageContent,
  getPageStructureInfo,
  getSupportedLocales,
  isValidLocale,
  isValidPageName,
  savePageLocale,
  savePageStructure,
  saveTranslatedLocale,
} from './content-pages-lib';

interface ContentPagesRoutesOptions {
  config: ApiRuntimeConfig;
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
        userMessage: 'Admin access required',
      }),
    };
  }

  return { ok: true };
}

export const contentPagesRoutes: FastifyPluginAsync<
  ContentPagesRoutesOptions
> = async (app, options) => {
  app.get<{
    Params: { page: string };
    Querystring: { locale?: string };
  }>('/api/content/pages/:page', async (request, reply) => {
    const page = (request.params.page || '').trim();
    if (!isValidPageName(page)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_PAGE_INVALID',
          userMessage: 'Invalid content page',
        })
      );
    }

    const locale = (request.query.locale || '').trim() || 'en-US';
    if (!isValidLocale(locale)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_LOCALE_INVALID',
          userMessage: 'Invalid locale',
        })
      );
    }

    try {
      const pageContent = await getMergedPageContent(page, locale);
      reply.header('Cache-Control', 'public, max-age=60, s-maxage=300');
      return reply.send(pageContent);
    } catch (error) {
      request.log.error(
        { err: error, page, locale },
        '[FastifyAPI][content-pages] failed to read public content page'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'CONTENT_PAGE_READ_FAILED',
          userMessage: 'Failed to read content page',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content page error',
        })
      );
    }
  });

  app.get<{
    Params: { page: string };
  }>('/api/admin/content/pages/:page', async (request, reply) => {
    const page = (request.params.page || '').trim();
    if (!isValidPageName(page)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_PAGE_INVALID',
          userMessage: 'Invalid content page',
        })
      );
    }

    const auth = await requireAdmin(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    try {
      const { sourceLocale, structureVersion } =
        await getPageStructureInfo(page);
      const translations = await getAllMergedPageTranslations(page);
      return reply.send({
        page,
        sourceLocale,
        structureVersion,
        supportedLocales: getSupportedLocales(),
        translations,
      });
    } catch (error) {
      request.log.error(
        { err: error, page },
        '[FastifyAPI][content-pages] failed to read admin content page'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'ADMIN_CONTENT_PAGE_READ_FAILED',
          userMessage: 'Failed to read admin content page',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown admin content read error',
        })
      );
    }
  });

  app.put<{
    Params: { page: string };
    Body: { translations?: Record<string, unknown> };
  }>('/api/admin/content/pages/:page', async (request, reply) => {
    const page = (request.params.page || '').trim();
    if (!isValidPageName(page)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_PAGE_INVALID',
          userMessage: 'Invalid content page',
        })
      );
    }

    const auth = await requireAdmin(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    if (!request.body?.translations) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'ADMIN_CONTENT_SAVE_ROUTE_DEPRECATED',
          userMessage:
            'Use structure or locale save routes for admin content writes',
        })
      );
    }

    return reply.status(410).send(
      buildRouteErrorPayload({
        request,
        statusCode: 410,
        code: 'ADMIN_CONTENT_SAVE_ROUTE_DEPRECATED',
        userMessage:
          'Use structure or locale save routes for admin content writes',
      })
    );
  });

  app.put<{
    Params: { page: string };
    Body: {
      content?: unknown;
      expectedStructureVersion?: number;
    };
  }>('/api/admin/content/pages/:page/structure', async (request, reply) => {
    const page = (request.params.page || '').trim();
    if (!isValidPageName(page)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_PAGE_INVALID',
          userMessage: 'Invalid content page',
        })
      );
    }

    const auth = await requireAdmin(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    if (request.body?.content === undefined) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'ADMIN_CONTENT_SAVE_PAYLOAD_INVALID',
          userMessage: 'Missing content payload',
        })
      );
    }

    try {
      const result = await savePageStructure({
        page,
        mergedPageContent: request.body.content,
        expectedStructureVersion: request.body.expectedStructureVersion,
      });

      return reply.send({
        success: true,
        page,
        sourceLocale: result.sourceLocale,
        structureVersion: result.structureVersion,
        updatedAt: result.updatedAt,
        translations: result.translations,
      });
    } catch (error) {
      if (error instanceof ContentPageStructureConflictError) {
        return reply.status(409).send(
          buildRouteErrorPayload({
            request,
            statusCode: 409,
            code: 'ADMIN_CONTENT_STRUCTURE_CONFLICT',
            userMessage:
              'Page structure has been updated. Reload and try again.',
            developerMessage: error.message,
            extra: {
              currentStructureVersion: error.currentStructureVersion,
              expectedStructureVersion: error.expectedStructureVersion,
            },
          })
        );
      }

      request.log.error(
        { err: error, page },
        '[FastifyAPI][content-pages] failed to save admin content structure'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'ADMIN_CONTENT_PAGE_SAVE_FAILED',
          userMessage: 'Failed to save admin content page',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown admin content save error',
        })
      );
    }
  });

  app.put<{
    Params: { page: string; locale: string };
    Body: {
      content?: unknown;
      basedOnStructureVersion?: number;
    };
  }>(
    '/api/admin/content/pages/:page/locales/:locale',
    async (request, reply) => {
      const page = (request.params.page || '').trim();
      const locale = (request.params.locale || '').trim();
      if (!isValidPageName(page)) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'CONTENT_PAGE_INVALID',
            userMessage: 'Invalid content page',
          })
        );
      }

      if (!isValidLocale(locale)) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'CONTENT_LOCALE_INVALID',
            userMessage: 'Invalid locale',
          })
        );
      }

      if (locale === 'en-US') {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'ADMIN_CONTENT_LOCALE_SAVE_ENGLISH_UNSUPPORTED',
            userMessage:
              'Use the structure save route for en-US content updates',
          })
        );
      }

      const auth = await requireAdmin(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      if (
        request.body?.content === undefined ||
        typeof request.body?.basedOnStructureVersion !== 'number'
      ) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            code: 'ADMIN_CONTENT_SAVE_PAYLOAD_INVALID',
            userMessage:
              'Missing locale content payload or basedOnStructureVersion',
          })
        );
      }

      try {
        const result = await savePageLocale({
          page,
          locale,
          mergedPageContent: request.body.content,
          basedOnStructureVersion: request.body.basedOnStructureVersion,
        });

        return reply.send({
          success: true,
          page,
          sourceLocale: result.sourceLocale,
          structureVersion: result.structureVersion,
          updatedAt: result.updatedAt,
          translations: result.translations,
        });
      } catch (error) {
        if (error instanceof ContentPageStructureConflictError) {
          return reply.status(409).send(
            buildRouteErrorPayload({
              request,
              statusCode: 409,
              code: 'ADMIN_CONTENT_STRUCTURE_CONFLICT',
              userMessage:
                'Page structure has been updated. Reload and try again.',
              developerMessage: error.message,
              extra: {
                currentStructureVersion: error.currentStructureVersion,
                expectedStructureVersion: error.expectedStructureVersion,
              },
            })
          );
        }

        request.log.error(
          { err: error, page, locale },
          '[FastifyAPI][content-pages] failed to save admin content locale'
        );
        return reply.status(500).send(
          buildRouteErrorPayload({
            request,
            statusCode: 500,
            code: 'ADMIN_CONTENT_PAGE_SAVE_FAILED',
            userMessage: 'Failed to save admin content page',
            developerMessage:
              error instanceof Error
                ? error.message
                : 'Unknown admin content save error',
          })
        );
      }
    }
  );

  app.post<{
    Params: { page: string };
    Body: {
      sourceLocale?: string;
      sourceData?: unknown;
      basedOnStructureVersion?: number;
      mode?: string;
    };
  }>('/api/admin/content/pages/:page/translate-all', async (request, reply) => {
    const page = (request.params.page || '').trim();
    if (!isValidPageName(page)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'CONTENT_PAGE_INVALID',
          userMessage: 'Invalid content page',
        })
      );
    }

    const auth = await requireAdmin(request, options.config);
    if (!auth.ok) {
      return reply.status(auth.statusCode).send(auth.payload);
    }

    const sourceLocale =
      typeof request.body?.sourceLocale === 'string'
        ? request.body.sourceLocale
        : '';
    const sourceData = request.body?.sourceData;
    const basedOnStructureVersion = request.body?.basedOnStructureVersion;
    const mode =
      typeof request.body?.mode === 'string' ? request.body.mode : '';

    if (!isValidLocale(sourceLocale)) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'TRANSLATION_SOURCE_LOCALE_UNSUPPORTED',
          userMessage: `Unsupported locale: ${sourceLocale || '<missing>'}`,
        })
      );
    }

    if (
      sourceData === undefined ||
      typeof basedOnStructureVersion !== 'number'
    ) {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'ADMIN_CONTENT_TRANSLATE_PAYLOAD_INVALID',
          userMessage: 'Missing source data or basedOnStructureVersion',
        })
      );
    }

    if (mode && mode !== 'overwrite') {
      return reply.status(400).send(
        buildRouteErrorPayload({
          request,
          statusCode: 400,
          code: 'ADMIN_CONTENT_TRANSLATE_MODE_UNSUPPORTED',
          userMessage: `Unsupported translate-all mode: ${mode}`,
        })
      );
    }

    try {
      const { structureVersion } = await getPageStructureInfo(page);
      if (structureVersion !== basedOnStructureVersion) {
        throw new ContentPageStructureConflictError({
          currentStructureVersion: structureVersion,
          expectedStructureVersion: basedOnStructureVersion,
        });
      }

      const targetLocales = getSupportedLocales().filter(
        locale => locale !== sourceLocale
      );
      const settledResults = await Promise.all(
        targetLocales.map(async locale => {
          try {
            const translatedLocaleMap = await buildTranslatedLocaleMap({
              sourceData: sourceData as Parameters<
                typeof buildTranslatedLocaleMap
              >[0]['sourceData'],
              sourceLocale,
              targetLocales: [locale],
            });

            const translatedContent = translatedLocaleMap[locale];
            if (translatedContent === undefined) {
              throw new Error(`Missing translated content for ${locale}`);
            }

            await saveTranslatedLocale({
              page,
              locale,
              mergedPageContent: translatedContent,
              basedOnStructureVersion,
            });

            return {
              locale,
              status: 'success' as const,
            };
          } catch (error) {
            return {
              locale,
              status: 'failed' as const,
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown translate-all error',
            };
          }
        })
      );

      const translations = await getAllMergedPageTranslations(page);
      const successCount = settledResults.filter(
        result => result.status === 'success'
      ).length;

      return reply.send({
        success: successCount > 0,
        page,
        sourceLocale,
        structureVersion,
        translatedAt: new Date().toISOString(),
        results: settledResults,
        translations,
      });
    } catch (error) {
      if (error instanceof ContentPageStructureConflictError) {
        return reply.status(409).send(
          buildRouteErrorPayload({
            request,
            statusCode: 409,
            code: 'ADMIN_CONTENT_STRUCTURE_CONFLICT',
            userMessage:
              'Page structure has been updated. Reload and try again.',
            developerMessage: error.message,
            extra: {
              currentStructureVersion: error.currentStructureVersion,
              expectedStructureVersion: error.expectedStructureVersion,
            },
          })
        );
      }

      request.log.error(
        { err: error, page },
        '[FastifyAPI][content-pages] failed to translate all locales'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          code: 'ADMIN_CONTENT_TRANSLATE_ALL_FAILED',
          userMessage: 'Failed to translate all locales',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown translate-all content error',
        })
      );
    }
  });
};
