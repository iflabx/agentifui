import {
  buildTranslatedLocaleMap,
  translateTextViaMyMemory,
} from './admin-translations-auto-translate';

describe('admin translation auto-translate helpers', () => {
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
        text: 'BistuCopilot',
        sourceLocale: 'zh-CN',
        targetLocale: 'zh-CN',
      })
    ).resolves.toBe('BistuCopilot');
  });
});
