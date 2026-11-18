import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { fireEvent, render } from '@testing-library/react';

import { ResultViewer } from './result-viewer';

jest.mock('@components/chat/markdown-block', () => ({
  CodeBlock: () => null,
  InlineCode: () => null,
  MarkdownBlockquote: () => null,
  MarkdownTableContainer: () => null,
}));
jest.mock('@components/chat/markdown-block/think-block-content', () => ({
  ThinkBlockContent: () => null,
}));
jest.mock('@components/chat/markdown-block/think-block-header', () => ({
  ThinkBlockHeader: () => null,
}));
jest.mock('react-markdown', () => () => null);
jest.mock('rehype-katex', () => () => null);
jest.mock('remark-gfm', () => () => null);
jest.mock('remark-math', () => () => null);
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => false }));

afterEach(() => {
  useFilePreviewStore.setState({ isPreviewOpen: false });
});

it('keeps the execution result open while Escape belongs to its file preview', () => {
  const onClose = jest.fn();
  render(
    <ResultViewer result="Saved result" execution={{}} onClose={onClose} />
  );
  useFilePreviewStore.setState({ isPreviewOpen: true });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  useFilePreviewStore.setState({ isPreviewOpen: false });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('does not close when a nested preview has already handled Escape', () => {
  const onClose = jest.fn();
  render(
    <ResultViewer result="Saved result" execution={{}} onClose={onClose} />
  );
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true,
  });
  event.preventDefault();
  document.dispatchEvent(event);
  expect(onClose).not.toHaveBeenCalled();
});
