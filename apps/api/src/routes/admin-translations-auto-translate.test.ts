import {
  buildTranslatedLocaleMap,
  translateTextViaMyMemory,
} from './admin-translations-auto-translate';

describe('admin translation auto-translate helpers', () => {
  const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('translates only visible content fields and preserves structure fields', async () => {
    const translated = await buildTranslatedLocaleMap({
      sourceLocale: 'zh-CN',
      targetLocales: ['zh-CN', 'en-US'],
      translatedAt: '2026-03-29T15:00:00.000Z',
      sourceData: {
        sections: [
          {
            id: 'section-home-hero',
            layout: 'single-column',
            columns: [
              [
                {
                  id: 'comp-home-title',
                  type: 'heading',
                  props: {
                    content: '连接智慧与校园 {year}',
                    level: 1,
                    textAlign: 'center',
                  },
                },
                {
                  id: 'comp-home-button-primary',
                  type: 'button',
                  props: {
                    text: '立即开始',
                    variant: 'solid',
                    action: 'link',
                    url: '/chat',
                    secondaryButton: {
                      text: '了解更多',
                      variant: 'outline',
                      action: 'link',
                      url: '/about',
                    },
                  },
                },
                {
                  id: 'comp-home-features',
                  type: 'cards',
                  props: {
                    layout: 'grid',
                    items: [
                      {
                        title: 'SSO',
                        description: '使用校园统一认证',
                      },
                    ],
                  },
                },
              ],
            ],
          },
        ],
        metadata: {
          locale: 'zh-CN',
          lastModified: 'old',
          author: 'admin',
        },
      },
      translateText: async ({ text, targetLocale }) =>
        `${text}__${targetLocale}`,
    });

    expect(
      (translated['zh-CN'] as { metadata?: { locale?: string } }).metadata
        ?.locale
    ).toBe('zh-CN');
    expect(
      (
        translated['en-US'] as {
          sections: Array<{
            layout: string;
            columns: Array<
              Array<{
                type: string;
                props: Record<string, unknown>;
              }>
            >;
            metadata?: { locale?: string };
          }>;
          metadata?: { locale?: string; lastModified?: string };
        }
      ).sections[0].layout
    ).toBe('single-column');

    const heroHeading = (
      translated['en-US'] as {
        sections: Array<{
          columns: Array<Array<{ props: Record<string, unknown> }>>;
        }>;
      }
    ).sections[0].columns[0][0];

    expect(heroHeading.props.content).toBe('连接智慧与校园 {year}__en-US');
    expect(heroHeading.props.level).toBe(1);
    expect(heroHeading.props.textAlign).toBe('center');

    const primaryButton = (
      translated['en-US'] as {
        sections: Array<{
          columns: Array<Array<{ props: Record<string, unknown> }>>;
        }>;
      }
    ).sections[0].columns[0][1];

    expect(primaryButton.props).toMatchObject({
      text: '立即开始__en-US',
      variant: 'solid',
      action: 'link',
      url: '/chat',
      secondaryButton: {
        text: '了解更多__en-US',
        variant: 'outline',
        action: 'link',
        url: '/about',
      },
    });

    const cards = (
      translated['en-US'] as {
        sections: Array<{
          columns: Array<Array<{ props: Record<string, unknown> }>>;
        }>;
      }
    ).sections[0].columns[0][2];

    expect(cards.props).toMatchObject({
      layout: 'grid',
      items: [
        {
          title: 'SSO__en-US',
          description: '使用校园统一认证__en-US',
        },
      ],
    });

    expect(
      (
        translated['en-US'] as {
          metadata?: { locale?: string; lastModified?: string };
        }
      ).metadata
    ).toMatchObject({
      locale: 'en-US',
      lastModified: '2026-03-29T15:00:00.000Z',
    });
  });

  it('returns original text when source and target locales match', async () => {
    await expect(
      translateTextViaMyMemory({
        text: 'AgentifUI',
        sourceLocale: 'zh-CN',
        targetLocale: 'zh-CN',
      })
    ).resolves.toBe('AgentifUI');
  });

  it('restores placeholders and protected terms when the provider drifts token case and spacing', async () => {
    mockedFetch.mockImplementation(async input => {
      const url = new URL(String(input));
      const protectedText = url.searchParams.get('q') || '';
      const translatedText = protectedText
        .replace(/\[\[/g, '[[ ')
        .replace(/\]\]/g, ' ]]')
        .toLowerCase();

      return {
        ok: true,
        json: async () => ({
          responseStatus: 200,
          responseData: {
            translatedText,
          },
        }),
      } as Response;
    });

    await expect(
      translateTextViaMyMemory({
        text: '© {year} AgentifUI',
        sourceLocale: 'zh-CN',
        targetLocale: 'en-US',
      })
    ).resolves.toBe('© {year} AgentifUI');
  });

  it('protects deployment-specific branding during translation', async () => {
    const originalName = process.env.NEXT_PUBLIC_BRAND_NAME;
    const originalDomain = process.env.NEXT_PUBLIC_BRAND_DOMAIN;
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Example Assistant';
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = 'stage.example:18021';
    mockedFetch.mockImplementation(
      async input =>
        ({
          ok: true,
          json: async () => ({
            responseStatus: 200,
            responseData: {
              translatedText: new URL(String(input)).searchParams
                .get('q')
                ?.toLowerCase(),
            },
          }),
        }) as Response
    );

    try {
      await expect(
        translateTextViaMyMemory({
          text: 'Example Assistant on stage.example:18021',
          sourceLocale: 'zh-CN',
          targetLocale: 'en-US',
        })
      ).resolves.toBe('Example Assistant on stage.example:18021');
    } finally {
      if (originalName === undefined) delete process.env.NEXT_PUBLIC_BRAND_NAME;
      else process.env.NEXT_PUBLIC_BRAND_NAME = originalName;
      if (originalDomain === undefined)
        delete process.env.NEXT_PUBLIC_BRAND_DOMAIN;
      else process.env.NEXT_PUBLIC_BRAND_DOMAIN = originalDomain;
    }
  });

  it('rejects untranslated internal tokens before they can be persisted', async () => {
    await expect(
      buildTranslatedLocaleMap({
        sourceLocale: 'zh-CN',
        targetLocales: ['en-US'],
        sourceData: {
          sections: [
            {
              id: 'section-home-footer',
              layout: 'single-column',
              columns: [
                [
                  {
                    id: 'comp-footer',
                    type: 'paragraph',
                    props: {
                      content: '© {year} AgentifUI',
                      textAlign: 'center',
                    },
                  },
                ],
              ],
            },
          ],
        },
        translateText: async () => '© __ placeholder_0 __ __ term_0 __',
      })
    ).rejects.toThrow('protected token');
  });
});
