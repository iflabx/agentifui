import { render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { AssistantMessage } from './assistant-message';

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('rehype-katex', () => ({}));
jest.mock('rehype-raw', () => ({}));
jest.mock('remark-gfm', () => ({}));
jest.mock('remark-math', () => ({}));

jest.mock('@components/chat/markdown-block', () => ({
  CodeBlock: ({ children }: { children: ReactNode }) => <pre>{children}</pre>,
  InlineCode: ({ children }: { children: ReactNode }) => (
    <code>{children}</code>
  ),
  MarkdownBlockquote: ({ children }: { children: ReactNode }) => (
    <blockquote>{children}</blockquote>
  ),
  MarkdownTableContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

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

jest.mock('@components/chat/reference-sources', () => ({
  ReferenceSources: () => <div data-testid="reference-sources" />,
}));

jest.mock('@components/chat/message-actions', () => ({
  AssistantMessageActions: () => <div data-testid="assistant-actions" />,
}));

jest.mock('./streaming-markdown', () => ({
  StreamingText: ({
    content,
    children,
  }: {
    content: string;
    children: (content: string) => ReactNode;
  }) => <>{children(content)}</>,
}));

describe('AssistantMessage think block behavior', () => {
  it('should keep think blocks collapsed by default', () => {
    render(
      <AssistantMessage
        id="msg-1"
        content="<think>completed reasoning</think>Visible result"
        isStreaming={false}
        wasManuallyStopped={false}
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
      <AssistantMessage
        id="msg-2"
        content={'<think>first line\n```ts\nconst a = 1\n```'}
        isStreaming={true}
        wasManuallyStopped={false}
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
