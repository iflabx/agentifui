import type { ComponentInstance } from '@lib/types/about-page-components';

export const SELECT_FIELD_OPTIONS: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  layout: [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
  ],
  thickness: [
    { value: 'thin', label: 'Thin' },
    { value: 'medium', label: 'Medium' },
    { value: 'thick', label: 'Thick' },
  ],
  style: [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
  ],
  alignment: [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ],
  textAlign: [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ],
  action: [
    { value: 'link', label: 'Link' },
    { value: 'submit', label: 'Submit' },
    { value: 'external', label: 'External' },
  ],
  variant: [
    { value: 'solid', label: 'Solid' },
    { value: 'outline', label: 'Outline' },
  ],
  level: [
    { value: '1', label: 'H1' },
    { value: '2', label: 'H2' },
    { value: '3', label: 'H3' },
    { value: '4', label: 'H4' },
    { value: '5', label: 'H5' },
    { value: '6', label: 'H6' },
  ],
};

export function isValidCssDimension(value: string | number): boolean {
  if (typeof value === 'number') {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }

  return /^(\d+(\.\d+)?(px|em|rem|%|vh|vw)?|auto)$/.test(value.trim());
}

export function createDefaultSecondaryButton() {
  return {
    text: 'Secondary Button',
    variant: 'outline',
    action: 'link',
    url: '#',
  };
}

export function createDefaultCardItem() {
  return {
    title: 'New Item',
    description: 'Add description here',
  };
}

export function updateListItem(
  items: Array<Record<string, unknown>>,
  index: number,
  key: string,
  value: unknown
) {
  const nextItems = [...items];
  nextItems[index] = { ...nextItems[index], [key]: value };
  return nextItems;
}

export function removeListItem(
  items: Array<Record<string, unknown>>,
  index: number
) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function shouldUseTextareaEditor(
  component: ComponentInstance,
  key: string
) {
  return (
    key === 'content' &&
    (component.type === 'paragraph' || component.type === 'heading')
  );
}
