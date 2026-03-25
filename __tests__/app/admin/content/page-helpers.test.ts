/** @jest-environment node */
import {
  collectAllSections,
  convertAboutTranslationsToHomeTranslations,
  convertHomeTranslationsToAboutTranslations,
  createPageContentFromAboutTranslation,
  createPageContentFromHomeTranslation,
  transformToHomePreviewConfig,
} from '@/admin/content/page-helpers';

describe('admin content page helpers', () => {
  it('normalizes dynamic about/home translations into page content', () => {
    expect(
      createPageContentFromAboutTranslation({
        title: 'About',
        sections: [{ id: 's1', type: 'hero', props: {} }],
      } as never)
    ).toMatchObject({
      sections: [{ id: 's1', type: 'hero', props: {} }],
    });

    expect(
      createPageContentFromHomeTranslation({
        title: 'Home',
        sections: [{ id: 'h1', type: 'feature-grid', props: {} }],
      } as never)
    ).toMatchObject({
      sections: [{ id: 'h1', type: 'feature-grid', props: {} }],
    });
  });

  it('collects sections and converts between about/home editor formats', () => {
    const homeTranslations = {
      'en-US': {
        title: 'Home',
        sections: [{ id: 'h1', type: 'hero', props: {} }],
      },
    } as never;

    expect(collectAllSections(homeTranslations, true)).toEqual([
      { id: 'h1', type: 'hero', props: {} },
    ]);

    const converted =
      convertHomeTranslationsToAboutTranslations(homeTranslations);
    expect(converted?.['en-US']).toMatchObject({ title: 'Home' });
    expect(
      convertAboutTranslationsToHomeTranslations(converted as never)
    ).toMatchObject(homeTranslations);
  });

  it('builds home preview config with string fallbacks', () => {
    expect(
      transformToHomePreviewConfig(
        {
          'zh-CN': {
            title: '首页',
            subtitle: null,
            getStarted: '开始',
            learnMore: undefined,
            features: [{ title: 'A', description: 'B' }],
            copyright: {
              prefix: '©',
              linkText: 'AgentifUI',
              suffix: 'all rights reserved',
            },
          },
        } as never,
        'zh-CN' as never
      )
    ).toEqual({
      title: '首页',
      subtitle: '',
      getStarted: '开始',
      learnMore: '',
      features: [{ title: 'A', description: 'B' }],
      copyright: {
        prefix: '©',
        linkText: 'AgentifUI',
        suffix: 'all rights reserved',
      },
    });
  });
});
