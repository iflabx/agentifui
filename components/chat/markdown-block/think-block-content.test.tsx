import { render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { ThinkBlockContent } from './think-block-content';

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

jest.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      initial,
      animate,
      variants,
      ...props
    }: {
      children: ReactNode;
      [key: string]: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

describe('ThinkBlockContent', () => {
  beforeEach(() => {
    reactMarkdownMock.mockClear();
  });

  it('does not pass rehypeRaw to ReactMarkdown', () => {
    render(
      <ThinkBlockContent
        markdownContent={"unsafe <div style='position:fixed'>content</div>"}
        isOpen={true}
      />
    );

    expect(screen.getByTestId('react-markdown')).toHaveAttribute(
      'data-rehype-plugin-count',
      '1'
    );
  });
});
