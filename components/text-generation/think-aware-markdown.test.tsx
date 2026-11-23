import { act, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import {
  ThinkAwareMarkdown,
  extractMainTextFromThinkAwareContent,
} from './think-aware-markdown';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
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

  it('deduplicates completed reasoning while preserving legitimate interleaved steps', () => {
    render(
      <ThinkAwareMarkdown
        content="<think>first</think><think>first</think>Answer<think>second</think>Final"
        markdownComponents={markdownComponents}
      />
    );
    expect(screen.getAllByTestId('think-header')).toHaveLength(2);
    expect(
      screen.getAllByTestId('think-content').map(element => element.textContent)
    ).toEqual(['first', 'second']);
  });

  it('passes code examples to Markdown unchanged without false thought blocks', () => {
    const content = 'Example:\n```xml\n<think>sample</think>\n```';
    render(
      <ThinkAwareMarkdown
        content={content}
        markdownComponents={markdownComponents}
      />
    );
    expect(screen.queryByTestId('think-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('react-markdown').textContent).toBe(content);
  });

  it('shows an incomplete answer notice for thought-only finished output', () => {
    render(
      <ThinkAwareMarkdown
        content="<think>Unfinished thought"
        markdownComponents={markdownComponents}
      />
    );
    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-status',
      'completed'
    );
    expect(screen.getByTestId('react-markdown')).toHaveTextContent(
      'pages.chat.messages.incompleteAnswer'
    );
  });

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

  it('keeps apparent answer text inside an open think block while streaming', () => {
    render(
      <ThinkAwareMarkdown
        content={`<think>Here is a thinking process:

1. 先分析用户需求。

2. 再给出方案。

比斯兔建议今晚可以试试二食堂的小火锅。`}
        markdownComponents={markdownComponents}
        isStreaming={true}
      />
    );

    expect(screen.getByTestId('think-content')).toHaveTextContent(
      '比斯兔建议今晚可以试试二食堂的小火锅。'
    );
    expect(screen.queryByTestId('react-markdown')).not.toBeInTheDocument();
  });

  it('keeps completed recovery for apparent answer text in malformed historical think content', () => {
    render(
      <ThinkAwareMarkdown
        content={`<think>Here is a thinking process:

1. 先分析用户需求。

2. 再给出方案。

比斯兔建议今晚可以试试二食堂的小火锅。`}
        markdownComponents={markdownComponents}
        isStreaming={false}
      />
    );

    expect(screen.getByTestId('think-content')).not.toHaveTextContent(
      '比斯兔建议今晚可以试试二食堂的小火锅。'
    );
    expect(screen.getByTestId('react-markdown')).toHaveTextContent(
      '比斯兔建议今晚可以试试二食堂的小火锅。'
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
