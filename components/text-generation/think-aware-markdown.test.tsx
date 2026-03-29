import { act, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import {
  ThinkAwareMarkdown,
  extractMainTextFromThinkAwareContent,
} from './think-aware-markdown';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('rehype-katex', () => ({}));
jest.mock('remark-gfm', () => ({}));
jest.mock('remark-math', () => ({}));

jest.mock('@components/chat/markdown-block/think-block-header', () => ({
  ThinkBlockHeader: ({
    status,
    isOpen,
    previewText,
    onToggle,
  }: {
    status: string;
    isOpen: boolean;
    previewText?: string;
    onToggle: () => void;
  }) => (
    <button
      data-testid="think-header"
      data-status={status}
      data-open={String(isOpen)}
      data-preview={previewText || ''}
      onClick={onToggle}
    >
      think-header
    </button>
  ),
}));

jest.mock('@components/chat/markdown-block/think-block-content', () => ({
  ThinkBlockContent: ({
    markdownContent,
    isOpen,
  }: {
    markdownContent: string;
    isOpen: boolean;
  }) => (
    <div data-testid="think-content" data-open={String(isOpen)}>
      {markdownContent}
    </div>
  ),
}));

describe('ThinkAwareMarkdown', () => {
  const markdownComponents = {};

  it('extracts main text from think-aware content', () => {
    expect(
      extractMainTextFromThinkAwareContent(
        '<think>internal reasoning</think>\n\nVisible result'
      )
    ).toBe('Visible result');
  });

  it('should keep think blocks collapsed by default', () => {
    render(
      <ThinkAwareMarkdown
        content="<think>completed reasoning</think>Visible result"
        markdownComponents={markdownComponents}
      />
    );

    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-open',
      'false'
    );
    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-status',
      'completed'
    );
  });

  it('should pass a preview while streaming and collapsed', () => {
    render(
      <ThinkAwareMarkdown
        content={'<think>first line\n```ts\nconst a = 1\n```'}
        markdownComponents={markdownComponents}
        isStreaming={true}
      />
    );

    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-open',
      'false'
    );
    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-status',
      'thinking'
    );
    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-preview',
      'first line ts const a = 1'
    );
  });

  it('should throttle the collapsed preview while think content grows', () => {
    jest.useFakeTimers();
    try {
      const baseContent = `<think>${'stable prefix '.repeat(12)}phase one`;
      const { rerender } = render(
        <ThinkAwareMarkdown
          content={baseContent}
          markdownComponents={markdownComponents}
          isStreaming={true}
        />
      );

      const initialPreview =
        screen.getByTestId('think-header').getAttribute('data-preview') || '';

      rerender(
        <ThinkAwareMarkdown
          content={`${baseContent} and now phase two is arriving`}
          markdownComponents={markdownComponents}
          isStreaming={true}
        />
      );

      const updatedPreview =
        screen.getByTestId('think-header').getAttribute('data-preview') || '';

      expect(updatedPreview).toBe(initialPreview);

      act(() => {
        jest.advanceTimersByTime(700);
      });

      const flushedPreview =
        screen.getByTestId('think-header').getAttribute('data-preview') || '';

      expect(flushedPreview).not.toBe(initialPreview);
      expect(flushedPreview).toContain('phase two is arriving');
    } finally {
      jest.useRealTimers();
    }
  });
});
