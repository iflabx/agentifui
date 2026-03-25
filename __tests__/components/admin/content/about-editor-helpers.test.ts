/** @jest-environment node */
import {
  buildPageContent,
  findComponentById,
  getDynamicTranslation,
} from '@components/admin/content/about-editor/helpers';

describe('about editor helpers', () => {
  it('migrates legacy translation and builds page content', () => {
    const translation = getDynamicTranslation(
      {
        'en-US': {
          title: 'About',
          subtitle: 'Intro',
        },
      } as never,
      'en-US' as never
    );

    expect(Array.isArray(translation.sections)).toBe(true);

    const pageContent = buildPageContent(translation);
    expect(pageContent?.sections.length).toBeGreaterThan(0);
    expect(pageContent?.metadata?.version).toBeDefined();
  });

  it('finds components by id within page content', () => {
    const pageContent = {
      sections: [
        {
          id: 's1',
          layout: 'single-column',
          columns: [[{ id: 'c1', type: 'heading', props: { content: 'Hi' } }]],
        },
      ],
    };

    expect(findComponentById(pageContent as never, 'c1')).toEqual({
      id: 'c1',
      type: 'heading',
      props: { content: 'Hi' },
    });
    expect(findComponentById(pageContent as never, 'missing')).toBeNull();
    expect(findComponentById(null, 'c1')).toBeNull();
  });
});
