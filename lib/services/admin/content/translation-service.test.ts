import { TranslationService } from './translation-service';

describe('TranslationService', () => {
  const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends structure saves to the dedicated structure route', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        page: 'about',
        sourceLocale: 'en-US',
        structureVersion: 4,
        updatedAt: '2026-03-29T12:00:00.000Z',
        translations: {},
      }),
    } as Response);

    await TranslationService.updateAboutPageStructure(
      { sections: [], metadata: { author: 'admin' } },
      3
    );

    expect(mockedFetch).toHaveBeenCalledWith(
      '/api/admin/content/pages/about/structure',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: { sections: [], metadata: { author: 'admin' } },
          expectedStructureVersion: 3,
        }),
      })
    );
  });

  it('sends locale saves to the dedicated locale route', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        page: 'about',
        sourceLocale: 'en-US',
        structureVersion: 3,
        updatedAt: '2026-03-29T12:00:00.000Z',
        translations: {},
      }),
    } as Response);

    await TranslationService.updateAboutPageLocale(
      'zh-CN',
      { sections: [] },
      3
    );

    expect(mockedFetch).toHaveBeenCalledWith(
      '/api/admin/content/pages/about/locales/zh-CN',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: { sections: [] },
          basedOnStructureVersion: 3,
        }),
      })
    );
  });

  it('uses the current language as translate-all source and passes overwrite mode', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        page: 'about',
        sourceLocale: 'zh-CN',
        structureVersion: 3,
        translatedAt: '2026-03-29T12:00:00.000Z',
        results: [{ locale: 'en-US', status: 'success' }],
        translations: {},
      }),
    } as Response);

    await TranslationService.translateAllPageTranslations({
      section: 'pages.about',
      sourceLocale: 'zh-CN',
      sourceData: { sections: [{ id: 'section-hero' }] },
      basedOnStructureVersion: 3,
      mode: 'overwrite',
    });

    expect(mockedFetch).toHaveBeenCalledWith(
      '/api/admin/content/pages/about/translate-all',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceLocale: 'zh-CN',
          sourceData: { sections: [{ id: 'section-hero' }] },
          basedOnStructureVersion: 3,
          mode: 'overwrite',
        }),
      })
    );
  });

  it('throws AppRequestError with app_error detail when the API returns a conflict', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({
        success: false,
        error: 'Page structure has been updated. Reload and try again.',
        app_error: {
          code: 'ADMIN_CONTENT_STRUCTURE_CONFLICT',
          source: 'fastify-api',
          severity: 'error',
          retryable: false,
          userMessage: 'Page structure has been updated. Reload and try again.',
          requestId: 'req-1',
        },
      }),
    } as Response);

    await expect(
      TranslationService.updateAboutPageLocale('zh-CN', { sections: [] }, 2)
    ).rejects.toMatchObject({
      name: 'AppRequestError',
      status: 409,
      detail: expect.objectContaining({
        code: 'ADMIN_CONTENT_STRUCTURE_CONFLICT',
      }),
    });
  });
});
