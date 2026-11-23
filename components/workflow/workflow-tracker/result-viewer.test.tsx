import { PreviewShell } from '@components/file-preview/preview-shell';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type ReactNode, useState } from 'react';

import { ResultViewer } from './result-viewer';

jest.mock('@components/chat/markdown-block', () => ({
  CodeBlock: () => null,
  InlineCode: () => null,
  MarkdownBlockquote: () => null,
  MarkdownTableContainer: () => null,
}));
jest.mock('@components/chat/markdown-block/think-block-content', () => ({
  ThinkBlockContent: ({ markdownContent }: { markdownContent: string }) => (
    <div>{markdownContent}</div>
  ),
}));
jest.mock('@components/chat/markdown-block/think-block-header', () => ({
  ThinkBlockHeader: ({ onToggle }: { onToggle: () => void }) => (
    <button onClick={onToggle}>Toggle reasoning</button>
  ),
}));
jest.mock(
  'react-markdown',
  () =>
    function MockMarkdown({ children }: { children: ReactNode }) {
      return <div data-testid="markdown">{children}</div>;
    }
);
jest.mock('rehype-katex', () => () => null);
jest.mock('remark-gfm', () => () => null);
jest.mock('remark-math', () => () => null);
let mockMobile = false;
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => mockMobile }));

beforeEach(() => {
  mockMobile = false;
});

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

it.each([false, true])(
  'uses the shared responsive panel (mobile=%s)',
  mobile => {
    mockMobile = mobile;
    const onClose = jest.fn();
    render(
      <ResultViewer result="Saved result" execution={{}} onClose={onClose} />
    );
    const panel = screen.getByRole('dialog', {
      name: 'pages.workflow.resultViewer.title',
    });
    expect(panel).toHaveClass('right-0', 'h-dvh', 'w-full');
    expect(panel).not.toHaveClass('max-w-4xl');
    expect(Boolean(document.querySelector('.bg-black\\/30'))).toBe(mobile);
    if (!mobile) expect(document.body.style.pointerEvents).not.toBe('none');
    fireEvent.click(
      screen.getByRole('button', { name: 'filePreview.closeButton' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  }
);

it.each([
  ['Plain text', 'Plain text', false],
  [{ result1: '# Report', result2: 'Not selected' }, '# Report', true],
  [{ text: 'Text output' }, 'Text output', false],
  [{ outputs: { answer: 42 } }, '{\n  "answer": 42\n}', false],
  [{ answer: 'Fallback' }, '{\n  "answer": "Fallback"\n}', false],
])(
  'preserves result parsing and copying for %p',
  async (result, expected, markdown) => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      render(
        <ResultViewer result={result} execution={{}} onClose={jest.fn()} />
      );
      const content = markdown
        ? screen.getByTestId('markdown')
        : screen.getByRole('dialog').querySelector('pre');
      expect(content?.textContent).toBe(expected);
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'pages.workflow.resultViewer.copyButton',
          })
        );
      });
      expect(writeText).toHaveBeenCalledWith(expected);
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  }
);

it('preserves collapsible reasoning and input attachments without changing app context', () => {
  render(
    <ResultViewer
      result={{ result1: '<think>Internal reasoning</think>Final answer' }}
      execution={{
        inputs: {
          source: {
            upload_file_id: 'file-1',
            name: 'source.txt',
            mime_type: 'text/plain',
          },
        },
        service_instance_id: 'app-1',
      }}
      onClose={jest.fn()}
    />
  );
  expect(screen.getByRole('dialog').querySelector('pre')?.textContent).toBe(
    'Final answer'
  );
  expect(screen.queryByText('Internal reasoning')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle reasoning' }));
  expect(screen.getByText('Internal reasoning')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Preview file source.txt' })
  ).toBeInTheDocument();
});

it('retains download content and filename behavior', async () => {
  const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const createObjectURL = jest.fn().mockReturnValue('blob:workflow-result');
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  let filename = '';
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });
  try {
    render(
      <ResultViewer
        result={{ result1: '<think>Private thought</think># Report' }}
        execution={{}}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'pages.workflow.resultViewer.downloadButton',
      })
    );
    expect(filename).toMatch(/^workflow-result-.*\.md$/);
    const text = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(createObjectURL.mock.calls[0][0]);
    });
    expect(text).toBe('# Report');
  } finally {
    click.mockRestore();
    if (original) Object.defineProperty(URL, 'createObjectURL', original);
    else Reflect.deleteProperty(URL, 'createObjectURL');
  }
});

it('shows the existing empty-result notice', () => {
  render(<ResultViewer result={null} execution={{}} onClose={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'pages.workflow.resultViewer.noData'
  );
});

async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
}

function ResultHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>View saved result</button>
      <input aria-label="Chat message" />
      {open && (
        <ResultViewer
          result="Saved result"
          execution={{}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

it.each([false, true])(
  'returns focus to the original action after closing (mobile=%s)',
  async mobile => {
    mockMobile = mobile;
    render(<ResultHarness />);
    const trigger = screen.getByRole('button', { name: 'View saved result' });
    trigger.focus();
    fireEvent.click(trigger);
    await settle();
    fireEvent.click(
      screen.getByRole('button', { name: 'filePreview.closeButton' })
    );
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Chat message' })).toHaveValue(
      ''
    );
  }
);

function NestedPreview() {
  const open = useFilePreviewStore(state => state.isPreviewOpen);
  return (
    <PreviewShell
      open={open}
      title="Input file preview"
      onClose={() => useFilePreviewStore.setState({ isPreviewOpen: false })}
    >
      Synthetic attachment
    </PreviewShell>
  );
}

it.each([false, true])(
  'closes a nested attachment before its result (mobile=%s)',
  async mobile => {
    mockMobile = mobile;
    const onClose = jest.fn();
    render(
      <>
        <ResultViewer result="Saved result" execution={{}} onClose={onClose} />
        <NestedPreview />
      </>
    );
    await settle();
    act(() => useFilePreviewStore.setState({ isPreviewOpen: true }));
    await settle();
    fireEvent.keyDown(
      screen.getByRole('dialog', { name: 'Input file preview' }),
      { key: 'Escape' }
    );
    await settle();
    expect(useFilePreviewStore.getState().isPreviewOpen).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(
      screen.getByRole('dialog', { name: 'pages.workflow.resultViewer.title' }),
      { key: 'Escape' }
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  }
);
