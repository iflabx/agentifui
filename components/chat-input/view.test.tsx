import { act, fireEvent, render, screen } from '@testing-library/react';

import { ChatInputView } from './view';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/hooks', () => ({ useMounted: () => true }));
jest.mock('@lib/hooks/use-welcome-layout', () => ({
  useWelcomeLayout: () => ({
    input: { top: '40%', transform: 'translate(-50%, -50%)' },
  }),
}));

describe('ChatInputView', () => {
  it('keeps a long application introduction and suggestions inside a scrollable welcome layout', () => {
    const props = {
      value: 'draft',
      onValueChange: jest.fn(),
      onSubmit: jest.fn(),
      scrollableWelcome: true,
      isWelcomeScreen: true,
      beforeInput: <p>{'Long introduction\n'.repeat(40)}</p>,
      afterInput: <button type="button">Suggestion</button>,
    };
    const view = render(<ChatInputView {...props} />);
    const welcome = view.container.querySelector('[data-chat-welcome]');
    expect(welcome).toHaveClass('overflow-y-auto', 'inset-0');
    const composer = view.container.querySelector(
      '[data-chat-input-container]'
    );
    expect(composer).toHaveClass('relative', 'my-auto', 'shrink-0');
    expect(composer).not.toHaveAttribute('style');
    expect(composer).toContainElement(screen.getByRole('textbox'));
    expect(composer).toContainElement(
      screen.getByRole('button', { name: 'Suggestion' })
    );
    view.rerender(<ChatInputView {...props} isWelcomeScreen={false} />);
    expect(view.container.querySelector('[data-chat-welcome]')).toBeNull();
    expect(
      view.container.querySelector('[data-chat-input-container]')
    ).toHaveClass('absolute');
  });
  it('keeps the default positioned chat layout', () => {
    const view = render(
      <ChatInputView
        value="draft"
        onValueChange={jest.fn()}
        onSubmit={jest.fn()}
      />
    );
    expect(view.container.firstChild).toHaveClass('absolute', 'left-1/2');
    expect(view.container.firstChild).toHaveStyle({
      bottom: '1rem',
      transform: 'translateX(-50%)',
    });
  });

  it('embeds in normal flow without welcome or bottom positioning', () => {
    const props = {
      value: 'draft',
      onValueChange: jest.fn(),
      onSubmit: jest.fn(),
      embedded: true,
    };
    const view = render(<ChatInputView {...props} />);
    const expectEmbedded = () => {
      expect(view.container.firstChild).toHaveClass('relative', 'mx-auto');
      expect(view.container.firstChild).not.toHaveClass('absolute', 'left-1/2');
      expect(view.container.firstChild).not.toHaveAttribute('style');
    };
    expectEmbedded();
    view.rerender(<ChatInputView {...props} isWelcomeScreen />);
    expectEmbedded();
    view.rerender(
      <ChatInputView {...props} embedded={false} isWelcomeScreen />
    );
    expect(view.container.firstChild).toHaveClass('absolute');
    expect(view.container.firstChild).toHaveStyle({
      top: '40%',
      bottom: 'auto',
      transform: 'translate(-50%, -50%)',
    });
  });

  it('supports valid parameter-only tasks without inventing a text message', async () => {
    const submit = jest.fn();
    render(
      <ChatInputView
        value=""
        onValueChange={jest.fn()}
        onSubmit={submit}
        canSubmit
        textDisabled
      />
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button')).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('uses explicit task validity for both keyboard and click submission', async () => {
    const submit = jest.fn();
    render(
      <ChatInputView
        value="valid text, invalid parameters"
        onValueChange={jest.fn()}
        onSubmit={submit}
        canSubmit={false}
      />
    );
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    });
    expect(submit).not.toHaveBeenCalled();
  });
  it('allows stopping a generation while inline editing disables ordinary input', () => {
    const stop = jest.fn();
    render(
      <ChatInputView
        value="preserved draft"
        onValueChange={jest.fn()}
        onSubmit={jest.fn()}
        disabled
        stopDisabled={false}
        isProcessing
        onStop={stop}
      />
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
    const button = screen.getByRole('button', { name: 'input.stopGeneration' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(stop).toHaveBeenCalledTimes(1);
  });
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
