/** @jest-environment node */
import {
  SELECT_FIELD_OPTIONS,
  createDefaultCardItem,
  createDefaultSecondaryButton,
  isValidCssDimension,
  removeListItem,
  shouldUseTextareaEditor,
  updateListItem,
} from '@components/admin/content/context-menu/helpers';

describe('context menu helpers', () => {
  it('validates css dimensions and exposes select options', () => {
    expect(isValidCssDimension(100)).toBe(true);
    expect(isValidCssDimension('50%')).toBe(true);
    expect(isValidCssDimension('calc(100%)')).toBe(false);
    expect(SELECT_FIELD_OPTIONS.variant).toEqual([
      { value: 'solid', label: 'Solid' },
      { value: 'outline', label: 'Outline' },
    ]);
  });

  it('creates and updates repeatable items', () => {
    expect(createDefaultCardItem()).toEqual({
      title: 'New Item',
      description: 'Add description here',
    });
    expect(createDefaultSecondaryButton()).toMatchObject({
      variant: 'outline',
      action: 'link',
    });

    const items = [{ title: 'A', description: 'B' }];
    expect(updateListItem(items, 0, 'title', 'Updated')).toEqual([
      { title: 'Updated', description: 'B' },
    ]);
    expect(removeListItem(items, 0)).toEqual([]);
  });

  it('detects textarea-backed fields', () => {
    expect(
      shouldUseTextareaEditor(
        { type: 'paragraph', props: {} } as never,
        'content'
      )
    ).toBe(true);
    expect(
      shouldUseTextareaEditor({ type: 'button', props: {} } as never, 'content')
    ).toBe(false);
  });
});
