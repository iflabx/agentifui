import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChatInputView } from './view';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/hooks', () => ({ useMounted: () => true }));
jest.mock('./container', () => ({
  ChatContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe('ChatInputView', () => {
  it('is controlled and renders only supplied actions', () => {
    const change = jest.fn();
    render(
      <ChatInputView
        value="draft"
        onValueChange={change}
        onSubmit={jest.fn()}
      />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'edited' },
    });
    expect(change).toHaveBeenCalledWith('edited');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('draft');
    expect(screen.getByRole('textbox')).toHaveAttribute('name', 'message');
    expect(screen.getByRole('textbox')).toHaveAttribute('id');
  });

  it('shares Enter and click guards, preserving Shift+Enter and IME', async () => {
    const submit = jest.fn();
    render(
      <ChatInputView
        value="draft"
        onValueChange={jest.fn()}
        onSubmit={submit}
      />
    );
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate submits while pending and does not invent stop capability', async () => {
    let resolve!: () => void;
    const submit = jest.fn(
      () =>
        new Promise<void>(done => {
          resolve = done;
        })
    );
    const props = {
      value: 'draft',
      onValueChange: jest.fn(),
      onSubmit: submit,
    };
    const { rerender } = render(<ChatInputView {...props} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
    const pendingStop = jest.fn();
    rerender(<ChatInputView {...props} isProcessing onStop={pendingStop} />);
    const stopButton = screen.getByRole('button', {
      name: 'input.stopGeneration',
    });
    expect(stopButton.querySelector('.lucide-square')).not.toBeNull();
    expect(stopButton.querySelector('.animate-spin')).toBeNull();
    fireEvent.click(stopButton);
    expect(pendingStop).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
    });
    rerender(<ChatInputView {...props} isProcessing />);
    expect(
      screen.queryByRole('button', { name: 'input.stopGeneration' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
    const stop = jest.fn();
    rerender(<ChatInputView {...props} isProcessing onStop={stop} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'input.stopGeneration' })
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not submit disabled or whitespace-only drafts', () => {
    const submit = jest.fn();
    const { rerender } = render(
      <ChatInputView
        value="draft"
        onValueChange={jest.fn()}
        onSubmit={submit}
        disabled
      />
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    rerender(
      <ChatInputView value=" " onValueChange={jest.fn()} onSubmit={submit} />
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
  });
});
