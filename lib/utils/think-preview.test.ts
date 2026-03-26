import { buildThinkPreviewText } from './think-preview';

describe('buildThinkPreviewText', () => {
  it('should normalize whitespace and markdown noise into a single-line preview', () => {
    expect(
      buildThinkPreviewText('  first line\n\n```ts\nconst a = 1\n```\n# next  ')
    ).toBe('first line ts const a = 1 next');
  });

  it('should keep image alt text and link text', () => {
    expect(
      buildThinkPreviewText(
        '![diagram](https://example.com/a.png) [doc](https://example.com/doc)'
      )
    ).toBe('diagram doc');
  });

  it('should return undefined for empty content', () => {
    expect(buildThinkPreviewText(' \n\t ` ` ')).toBeUndefined();
  });

  it('should truncate very long previews', () => {
    const preview = buildThinkPreviewText('a'.repeat(140));

    expect(preview).toHaveLength(123);
    expect(preview).toBe(`${'a'.repeat(120)}...`);
  });
});
