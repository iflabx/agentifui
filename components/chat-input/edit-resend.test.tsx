import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';

import { type EditSource, useEditResend } from './edit-resend';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const source = {
  id: 'original',
  text: 'original question',
  hasAttachments: true,
};
function Harness({
  scope = 'actor/app/conversation',
  blocked = false,
  submit = async () => true,
}: {
  scope?: string | null;
  blocked?: boolean;
  submit?: (text: string, selected: EditSource) => Promise<boolean>;
}) {
  const edit = useEditResend({ scope, blocked, onSubmit: submit });
  return (
    <>
      <button
        disabled={edit.controls.disabled}
        onClick={() => edit.controls.start(source)}
      >
        edit
      </button>
      <article data-testid="original-message">
        {edit.controls.editor || source.text}
      </article>
      <textarea
        aria-label="bottom draft"
        defaultValue="unsent draft"
        disabled={edit.active}
      />
    </>
  );
}

describe('inline historical message editing', () => {
  it('edits at the message and preserves the bottom draft on cancel', () => {
    const submit = jest.fn();
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', {
      name: 'editorLabel',
    }) as HTMLTextAreaElement;
    expect(screen.getByTestId('original-message')).toContainElement(editor);
    expect(editor).toHaveValue(source.text);
    expect(editor).toHaveFocus();
    expect(editor.selectionEnd - editor.selectionStart).toBe(
      source.text.length
    );
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toHaveValue(
      'unsent draft'
    );
    expect(
      screen.getByRole('textbox', { name: 'bottom draft' })
    ).toBeDisabled();
    expect(screen.getByText('textOnly')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByTestId('original-message')).toHaveTextContent(
      source.text
    );
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toBeEnabled();
  });

  it('retains rejected changes and closes only after explicit acceptance', async () => {
    const submit = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.change(editor, { target: { value: 'updated question' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(submit).toHaveBeenLastCalledWith('updated question', source);
    expect(editor).toHaveValue('updated question');
    expect(screen.getByRole('alert')).toHaveTextContent('sendFailed');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'bottom draft' })).toHaveValue(
      'unsent draft'
    );
  });

  it('keeps a thrown failure and forbids blank sends', async () => {
    const submit = jest.fn().mockRejectedValue(new Error('offline'));
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.change(editor, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'retryable text' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(editor).toHaveValue('retryable text');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('serializes sends and does not cancel a pending request', async () => {
    let finish!: (accepted: boolean) => void;
    const submit = jest.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        })
    );
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.submit(screen.getByRole('form'));
    fireEvent.submit(screen.getByRole('form'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'editorLabel' }), {
      key: 'Escape',
    });
    expect(screen.getByRole('form')).toBeInTheDocument();
    await act(async () => {
      finish(true);
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('keeps Enter as newline, ignores IME shortcuts and cancels with Escape', () => {
    const submit = jest.fn();
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.keyDown(editor, {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('retains temporarily blocked editing but clears it on navigation', () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox', { name: 'editorLabel' }), {
      target: { value: 'changed' },
    });
    view.rerender(<Harness blocked />);
    expect(screen.getByRole('textbox', { name: 'editorLabel' })).toHaveValue(
      'changed'
    );
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    view.rerender(<Harness scope="other/conversation" />);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('ignores stale callbacks, absent scopes and empty sources', () => {
    const hook = renderHook(
      ({ scope }) =>
        useEditResend({ scope, blocked: false, onSubmit: jest.fn() }),
      { initialProps: { scope: 'A' as string | null } }
    );
    const stale = hook.result.current.controls.start;
    hook.rerender({ scope: 'B' });
    act(() => stale(source));
    act(() =>
      hook.result.current.controls.start({ id: 'blank', text: ' \n ' })
    );
    expect(hook.result.current.active).toBe(false);
    hook.rerender({ scope: null });
    act(() => hook.result.current.controls.start(source));
    expect(hook.result.current.active).toBe(false);
  });

  it('clears an edit after recovery removes its source from the visible history', () => {
    const hook = renderHook(
      ({ sourceIds }) =>
        useEditResend({
          scope: 'same-thread',
          sourceIds,
          blocked: false,
          onSubmit: jest.fn(),
        }),
      { initialProps: { sourceIds: ['original', 'old-answer'] } }
    );
    act(() => hook.result.current.controls.start(source));
    expect(hook.result.current.active).toBe(true);
    hook.rerender({ sourceIds: ['replacement', 'new-answer'] });
    expect(hook.result.current.active).toBe(false);
    expect(hook.result.current.controls.editor).toBeNull();
    expect(hook.result.current.controls.disabled).toBe(false);
  });
});
