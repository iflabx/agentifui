import { render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { ThinkAwareMarkdown } from './think-aware-markdown';

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
});
