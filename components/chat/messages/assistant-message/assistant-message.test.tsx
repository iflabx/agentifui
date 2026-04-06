import { act, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { AssistantMessage } from './assistant-message';

const reactMarkdownMock = jest.fn(
  ({
    children,
    rehypePlugins,
  }: {
    children: ReactNode;
    rehypePlugins?: unknown[];
  }) => (
    <div
      data-testid="react-markdown"
      data-rehype-plugin-count={String(rehypePlugins?.length || 0)}
    >
      {children}
    </div>
  )
);

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: { children: ReactNode; rehypePlugins?: unknown[] }) =>
    reactMarkdownMock(props),
}));

jest.mock('rehype-katex', () => ({}));
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
  beforeEach(() => {
    reactMarkdownMock.mockClear();
  });

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

  it('should throttle the collapsed preview while think content grows', () => {
    jest.useFakeTimers();
    try {
      const baseContent = `<think>${'stable prefix '.repeat(12)}phase one`;
      const { rerender } = render(
        <AssistantMessage
          id="msg-3"
          content={baseContent}
          isStreaming={true}
          wasManuallyStopped={false}
        />
      );

      const initialPreview =
        screen.getByTestId('think-header').getAttribute('data-preview') || '';

      rerender(
        <AssistantMessage
          id="msg-3"
          content={`${baseContent} and now phase two is arriving`}
          isStreaming={true}
          wasManuallyStopped={false}
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

  it('does not pass rehypeRaw to ReactMarkdown', () => {
    render(
      <AssistantMessage
        id="msg-4"
        content="hello <div style='position:fixed'>world</div>"
        isStreaming={false}
        wasManuallyStopped={false}
      />
    );

    expect(screen.getByTestId('react-markdown')).toHaveAttribute(
      'data-rehype-plugin-count',
      '1'
    );
  });

  it('should render repaired reply text for malformed historical think content', () => {
    render(
      <AssistantMessage
        id="msg-5"
        content={'<think>Plan steps\n\n**生成回复**：\nVisible answer'}
        isStreaming={false}
        wasManuallyStopped={false}
      />
    );

    expect(screen.getByTestId('think-content')).toHaveTextContent('Plan steps');
    expect(screen.getByTestId('react-markdown')).toHaveTextContent(
      'Visible answer'
    );
  });

  it('should render a localized fallback when a completed message only contains draft think content', () => {
    render(
      <AssistantMessage
        id="msg-6"
        content={'<think>Plan steps\n\n**生成内容**：\n* bullet'}
        isStreaming={false}
        wasManuallyStopped={false}
      />
    );

    expect(screen.getByTestId('think-content')).toHaveTextContent('Plan steps');
    expect(screen.getByTestId('react-markdown')).toHaveTextContent(
      'pages.chat.messages.incompleteAnswer'
    );
  });

  it('should not inject a fallback after a manually stopped draft-only message', () => {
    render(
      <AssistantMessage
        id="msg-7"
        content={'<think>Plan steps\n\n**生成内容**：\n* bullet'}
        isStreaming={false}
        wasManuallyStopped={true}
      />
    );

    expect(screen.queryByTestId('react-markdown')).not.toBeInTheDocument();
  });

  it('shows stopped status for manually stopped historical think blocks even when the block is closed', () => {
    render(
      <AssistantMessage
        id="msg-8"
        content="<think>Plan steps</think>"
        isStreaming={false}
        wasManuallyStopped={true}
      />
    );

    expect(screen.getByTestId('think-header')).toHaveAttribute(
      'data-status',
      'stopped'
    );
  });
});
