import { FilePreviewCanvas } from '@components/file-preview/file-preview-canvas';
import { PreviewShell } from '@components/file-preview/preview-shell';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { useState } from 'react';

let mockMediaChange: () => void;
const mockClose = jest.fn();
const mockDownload = jest.fn();
const mockOpen = jest.fn();
const mockFile = { name: 'legacy.txt', app_id: 'dify-app' };
const mockState = {
  isPreviewOpen: false,
  currentPreviewFile: mockFile,
  closePreview: mockClose,
  previewContent: {} as Blob,
  contentHeaders: { contentType: 'text/plain' },
  isLoading: false,
  error: null as string | null,
  downloadFile: mockDownload,
  openPreview: mockOpen,
  clearError: jest.fn(),
};

jest.mock('@lib/stores/ui/file-preview-store', () => ({
  useFilePreviewStore: () => mockState,
}));
jest.mock('@components/file-preview/previews/text-preview', () => ({
  TextPreview: ({ onDownload }: { onDownload: () => void }) => (
    <button onClick={onDownload}>Legacy text download</button>
  ),
}));
jest.mock('@components/file-preview/previews/markdown-preview', () => ({
  MarkdownPreview: () => null,
}));
jest.mock('@components/file-preview/previews/pdf-preview', () => ({
  PDFPreview: () => null,
}));
jest.mock('@components/file-preview/previews/image-preview', () => ({
  ImagePreview: () => null,
}));
jest.mock('@components/file-preview/previews/audio-preview', () => ({
  AudioPreview: () => null,
}));
jest.mock('@components/file-preview/previews/video-preview', () => ({
  VideoPreview: () => null,
}));

async function tick() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  });
  window.matchMedia = jest.fn().mockImplementation(media => ({
    media,
    matches: window.innerWidth < 768,
    addEventListener: (_event: string, listener: () => void) => {
      mockMediaChange = listener;
    },
    removeEventListener: jest.fn(),
  }));
  mockState.isPreviewOpen = false;
  mockState.error = null;
});

it.each([1024, 390])(
  'keeps the legacy Dify loader, renderer, download and Escape callbacks at width %i',
  async width => {
    window.innerWidth = width;
    const view = render(<FilePreviewCanvas />);
    mockState.isPreviewOpen = true;
    view.rerender(<FilePreviewCanvas />);
    await tick();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('legacy.txt');
    fireEvent.click(
      screen.getByRole('button', { name: 'Legacy text download' })
    );
    expect(mockDownload).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mockClose).toHaveBeenCalledTimes(1);
    mockState.isPreviewOpen = false;
    view.rerender(<FilePreviewCanvas />);
    await tick();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

it('keeps the legacy retry on its original Dify app/file loader', async () => {
  const view = render(<FilePreviewCanvas />);
  mockState.isPreviewOpen = true;
  mockState.error = 'Temporary error';
  view.rerender(<FilePreviewCanvas />);
  await tick();
  fireEvent.click(
    screen.getByRole('button', { name: 'filePreview.retryButton' })
  );
  expect(mockOpen).toHaveBeenCalledWith(mockFile, 'dify-app');
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Legacy trigger</button>
      <input aria-label="Chat message" />
      <PreviewShell open={open} title="Preview" onClose={() => setOpen(false)}>
        <button>Last action</button>
      </PreviewShell>
    </>
  );
}

it('keeps desktop chat interactive without dismissing or hiding it', async () => {
  const view = render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Legacy trigger' });
  trigger.focus();
  fireEvent.click(trigger);
  await tick();
  const chat = screen.getByRole('textbox', { name: 'Chat message' });
  expect(view.container).not.toHaveAttribute('aria-hidden', 'true');
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(document.body).not.toHaveAttribute('data-scroll-locked');
  expect(
    document.querySelector('[data-state="open"].bg-black\\/30')
  ).toBeNull();
  fireEvent.pointerDown(chat);
  act(() => chat.focus());
  fireEvent.change(chat, { target: { value: 'Continue chatting' } });
  await tick();
  expect(chat).toHaveFocus();
  expect(chat).toHaveValue('Continue chatting');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(chat, { key: 'Escape' });
  await tick();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('traps mobile focus, blocks background interaction and restores the trigger', async () => {
  window.innerWidth = 390;
  const view = render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Legacy trigger' });
  trigger.focus();
  fireEvent.click(trigger);
  await tick();
  expect(view.container).toHaveAttribute('aria-hidden', 'true');
  expect(document.body.style.pointerEvents).toBe('none');
  expect(document.body).toHaveAttribute('data-scroll-locked');
  expect(
    document.querySelector('[data-state="open"].bg-black\\/30')
  ).not.toBeNull();
  const close = screen.getByRole('button', { name: 'filePreview.closeButton' });
  const last = screen.getByRole('button', { name: 'Last action' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  act(() => screen.getByRole('textbox', { hidden: true }).focus());
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Escape' });
  await tick();
  expect(trigger).toHaveFocus();
});

it('dismisses mobile previews through the backdrop', async () => {
  window.innerWidth = 390;
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Legacy trigger' });
  trigger.focus();
  fireEvent.click(trigger);
  await tick();
  const backdrop = document.querySelector('[data-state="open"].bg-black\\/30')!;
  fireEvent.pointerDown(backdrop);
  await tick();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.pointerEvents).not.toBe('none');
});

it('preserves the original trigger across desktop/mobile breakpoint changes', async () => {
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Legacy trigger' });
  trigger.focus();
  fireEvent.click(trigger);
  await tick();
  act(() => {
    window.innerWidth = 390;
    mockMediaChange();
  });
  await tick();
  expect(document.body.style.pointerEvents).toBe('none');
  act(() => {
    window.innerWidth = 1024;
    mockMediaChange();
  });
  await tick();
  expect(
    screen.getByRole('textbox', { name: 'Chat message' })
  ).toBeInTheDocument();
  expect(document.body.style.pointerEvents).not.toBe('none');
  fireEvent.click(
    screen.getByRole('button', { name: 'filePreview.closeButton' })
  );
  await tick();
  expect(trigger).toHaveFocus();
});

it('restores a mobile legacy trigger without depending on a store', async () => {
  window.innerWidth = 390;
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Legacy trigger</button>
        <PreviewShell
          open={open}
          title="Preview"
          onClose={() => setOpen(false)}
        >
          <button>Last action</button>
        </PreviewShell>
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'Legacy trigger' });
  trigger.focus();
  fireEvent.click(trigger);
  await tick();
  const close = screen.getByRole('button', { name: 'filePreview.closeButton' });
  const last = screen.getByRole('button', { name: 'Last action' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: 'Escape' });
  await tick();
  expect(trigger).toHaveFocus();
});
