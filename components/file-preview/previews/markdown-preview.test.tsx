import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ReactNode } from 'react';

import { MarkdownPreview } from './markdown-preview';

const reactMarkdownMock = jest.fn(
  ({
    children,
    remarkPlugins,
  }: {
    children: ReactNode;
    remarkPlugins?: unknown[];
  }) => (
    <div
      data-testid="react-markdown"
      data-remark-plugin-count={String(remarkPlugins?.length || 0)}
    >
      {children}
    </div>
  )
);

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: { children: ReactNode; remarkPlugins?: unknown[] }) =>
    reactMarkdownMock(props),
}));

jest.mock('remark-gfm', () => ({}));

describe('MarkdownPreview', () => {
  beforeEach(() => {
    reactMarkdownMock.mockClear();
  });

  it('renders markdown without enabling raw HTML parsing', async () => {
    const content = {
      text: jest
        .fn()
        .mockResolvedValue(
          '# Title\n\n**bold**\n\n<img src=x onerror="alert(1)" />'
        ),
    } as unknown as Blob;

    const { container } = render(
      <MarkdownPreview
        content={content}
        filename="unsafe.md"
        onDownload={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });

    expect(screen.getByTestId('react-markdown')).toHaveAttribute(
      'data-remark-plugin-count',
      '1'
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('react-markdown')).toHaveTextContent(
      '<img src=x onerror="alert(1)" />'
    );
  });

  it('keeps raw mode content intact', async () => {
    const rawMarkdown = '# Raw\n<script>alert(1)</script>';
    const content = {
      text: jest.fn().mockResolvedValue(rawMarkdown),
    } as unknown as Blob;

    const { container } = render(
      <MarkdownPreview
        content={content}
        filename="raw.md"
        onDownload={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'filePreview.markdownPreview.rawMode',
      })
    );

    expect(container.querySelector('pre')).toHaveTextContent(
      '# Raw <script>alert(1)</script>'
    );
  });
});
