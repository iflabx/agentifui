import { MarkdownPreview } from '@components/file-preview/previews/markdown-preview';
import { act, render, screen } from '@testing-library/react';
import type ReactMarkdown from 'react-markdown';

import type { ComponentProps } from 'react';

const mockMarkdown = jest.fn((props: ComponentProps<typeof ReactMarkdown>) => (
  <div data-testid="markdown">{props.children}</div>
));
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof ReactMarkdown>) => mockMarkdown(props),
}));
jest.mock('remark-gfm', () => ({}));

it('disables raw HTML and result images without installing unsafe URL transforms or plugins', async () => {
  const content = {
    text: async () =>
      '# Report\n![tracking](https://external.invalid/image)\n<script>alert(1)</script>\n[link](javascript:alert(1))',
  } as Blob;
  render(
    <MarkdownPreview
      content={content}
      filename="report.md"
      onDownload={jest.fn()}
      allowImages={false}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  const props = mockMarkdown.mock.calls.at(-1)![0];
  expect(props.skipHtml).toBe(true);
  expect(props.rehypePlugins).toBeUndefined();
  expect(props.urlTransform).toBeUndefined();
  expect(props.components?.img).toBeDefined();
  expect((props.components!.img as () => null)()).toBeNull();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('ignores a late text read when the blob changes', async () => {
  let finish!: (value: string) => void;
  const old = {
    text: () =>
      new Promise<string>(resolve => {
        finish = resolve;
      }),
  } as Blob;
  const current = { text: async () => 'Current report' } as Blob;
  const view = render(
    <MarkdownPreview content={old} filename="old.md" onDownload={jest.fn()} />
  );
  view.rerender(
    <MarkdownPreview
      content={current}
      filename="report.md"
      onDownload={jest.fn()}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => finish('Stale report'));
  expect(screen.getByTestId('markdown')).toHaveTextContent('Current report');
  expect(screen.queryByText('Stale report')).not.toBeInTheDocument();
});

it('shows a localized preview error without hiding the independent download action on the card', async () => {
  const content = {
    text: async () => {
      throw new Error('private upstream text');
    },
  } as unknown as Blob;
  render(
    <MarkdownPreview
      content={content}
      filename="report.md"
      onDownload={jest.fn()}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'filePreview.markdownPreview.loadFailed'
  );
  expect(screen.queryByText('private upstream text')).not.toBeInTheDocument();
});
