import { render, screen } from '@testing-library/react';

import { ChatTextInput } from './text-input';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('ChatTextInput placeholder', () => {
  it.each([
    [undefined, 'input.placeholder'],
    ['Custom prompt', 'Custom prompt'],
    ['', ''],
  ])(
    'honors placeholder %p without removing its accessible name',
    (placeholder, expected) => {
      render(
        <ChatTextInput
          value=""
          onChange={jest.fn()}
          placeholder={placeholder}
        />
      );

      const input = screen.getByRole('textbox', { name: 'input.placeholder' });
      expect(input).toHaveAttribute('placeholder', expected);
      expect(input).toHaveAttribute('name', 'message');
      expect(input.id).not.toBe('');
    }
  );
});
